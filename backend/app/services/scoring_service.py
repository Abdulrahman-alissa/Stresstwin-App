"""
Scoring Service
- Loads per-user Isolation Forest model (.joblib)
- Scores 14-feature behavioral vector
- Runs Intervention Engine (hysteresis + suppression)
"""
import os, joblib, uuid, numpy as np
from datetime import datetime, timedelta
from pathlib import Path
from app.schemas.behavioral import BehavioralFeatures, ScoreResponse

MODEL_DIR = Path("ml_models/isolation_forest")
MODEL_DIR.mkdir(parents=True, exist_ok=True)

# In-memory session state (resets per process — fine for single-server MVP)
# { user_id: {"consecutive": int, "last_intervention": datetime | None, "dismissals": int, "session_bonus": int} }
_session: dict[str, dict] = {}


def _get_session(uid: str) -> dict:
    if uid not in _session:
        _session[uid] = {
            "consecutive": 0,
            "last_intervention": None,
            "dismissals": 0,
            "session_bonus": 0,
        }
    return _session[uid]


def _feature_vector(feats: BehavioralFeatures) -> np.ndarray:
    """Build the 14-dim feature vector, filling None with 0."""
    hour = feats.window_start.hour
    is_weekend = int(feats.window_start.weekday() >= 5)
    vec = [
        feats.keystroke_mean or 0,
        feats.keystroke_std or 0,
        feats.error_rate or 0,
        feats.mouse_velocity or 0,
        feats.mouse_smoothness or 0,
        feats.click_hesitation or 0,
        feats.touch_pressure or 0,
        feats.gyro_variance or 0,
        feats.idle_frequency or 0,
        feats.app_switch_rate or 0,
        min(feats.session_duration / 3600, 1),   # norm 0-1
        np.sin(2 * np.pi * hour / 24),
        np.cos(2 * np.pi * hour / 24),
        float(is_weekend),
    ]
    return np.array(vec, dtype=np.float32).reshape(1, -1)


def _baseline_score(vec: np.ndarray) -> float:
    """Fallback score while model is training: L2 norm scaled to 0-60."""
    return float(np.clip(np.linalg.norm(vec) * 3, 0, 60))


def _select_intervention(consecutive: int, dismissals: int) -> str:
    if dismissals >= 3:
        return "step_away"
    if consecutive >= 4:
        return "focus"
    return "breathing"


async def score_behavioral_window(
    uid: str,
    feats: BehavioralFeatures,
    log_id: str,
    db,
) -> ScoreResponse:
    vec = _feature_vector(feats)
    sess = _get_session(uid)

    # Load model
    model_path = MODEL_DIR / f"{uid}.joblib"
    model_ready = model_path.exists()
    if model_ready:
        clf = joblib.load(str(model_path))
        raw = clf.decision_function(vec)[0]  # negative = anomalous
        score = float(np.clip((-raw + 0.5) * 100, 0, 100))
    else:
        score = _baseline_score(vec)

    # Personalized threshold (with session bonus after 3 dismissals)
    user_row = db.table("users").select("if_threshold").eq("id", uid).execute()
    base_threshold = (user_row.data[0]["if_threshold"] if user_row.data else 70)
    threshold = base_threshold + sess["session_bonus"]
    crossed = score > threshold

    # Hysteresis counter
    if crossed:
        sess["consecutive"] += 1
    else:
        sess["consecutive"] = 0

    # Write score
    score_id = str(uuid.uuid4())
    db.table("if_scores").insert({
        "id": score_id,
        "user_id": uid,
        "log_id": log_id,
        "deviation_score": round(score, 2),
        "threshold_crossed": crossed,
    }).execute()

    # Intervention decision
    intervention_type = None
    if crossed and sess["consecutive"] >= 2:
        last = sess["last_intervention"]
        suppressed = last and (datetime.utcnow() - last) < timedelta(minutes=15)
        if not suppressed:
            intervention_type = _select_intervention(sess["consecutive"], sess["dismissals"])
            sess["last_intervention"] = datetime.utcnow()
            sess["consecutive"] = 0
            db.table("interventions").insert({
                "id": str(uuid.uuid4()),
                "user_id": uid,
                "score_id": score_id,
                "intervention_type": intervention_type,
            }).execute()

    return ScoreResponse(
        deviation_score=round(score, 2),
        threshold_crossed=crossed,
        intervention_type=intervention_type,
        model_ready=model_ready,
        log_id=log_id,
        score_id=score_id,
    )


def record_dismissal(uid: str):
    sess = _get_session(uid)
    sess["dismissals"] += 1
    if sess["dismissals"] >= 3:
        sess["session_bonus"] = 10

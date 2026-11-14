import joblib, numpy as np
from pathlib import Path
from sklearn.ensemble import IsolationForest
from datetime import datetime, timedelta

MODEL_DIR = Path("ml_models/isolation_forest")
MODEL_DIR.mkdir(parents=True, exist_ok=True)

MIN_DAYS = 7
MIN_SAMPLES = 100


def train_user_isolation_forest(uid: str, db) -> bool:
    """
    Fetches last 30 days of behavioral_logs for user, trains IF, saves .joblib.
    Returns True if trained successfully.
    """
    since = (datetime.utcnow() - timedelta(days=30)).isoformat()
    logs = (
        db.table("behavioral_logs")
        .select("*")
        .eq("user_id", uid)
        .gte("window_start", since)
        .execute()
    )
    data = logs.data or []
    if len(data) < MIN_SAMPLES:
        return False

    matrix = []
    for row in data:
        try:
            dt = datetime.fromisoformat(row["window_start"].replace("Z", "+00:00"))
        except Exception:
            dt = datetime.utcnow()
        hour = dt.hour
        vec = [
            row.get("keystroke_mean") or 0,
            row.get("keystroke_std") or 0,
            row.get("error_rate") or 0,
            row.get("mouse_velocity") or 0,
            row.get("mouse_smoothness") or 0,
            row.get("click_hesitation") or 0,
            row.get("touch_pressure") or 0,
            row.get("gyro_variance") or 0,
            row.get("idle_frequency") or 0,
            row.get("app_switch_rate") or 0,
            min((row.get("session_duration") or 30) / 3600, 1),
            np.sin(2 * np.pi * hour / 24),
            np.cos(2 * np.pi * hour / 24),
            float(dt.weekday() >= 5),
        ]
        matrix.append(vec)

    X = np.array(matrix, dtype=np.float32)
    clf = IsolationForest(contamination=0.1, random_state=42, n_estimators=100)
    clf.fit(X)

    path = MODEL_DIR / f"{uid}.joblib"
    joblib.dump(clf, str(path))

    db.table("users").update({
        "if_model_trained_at": datetime.utcnow().isoformat(),
    }).eq("id", uid).execute()

    print(f"  IF model trained for {uid} on {len(matrix)} samples")
    return True

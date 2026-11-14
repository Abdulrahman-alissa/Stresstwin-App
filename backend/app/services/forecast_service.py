"""
Forecast Service
- Builds 14-day behavioral + calendar sequence for LSTM
- Returns 3-day risk predictions or cold-start message
"""
import numpy as np
from pathlib import Path
from datetime import datetime, date, timedelta
from app.schemas.behavioral import ForecastResponse, DayForecast
from app.services.data_days import count_data_days
from app.core.db_retry import run as db_run, TRANSIENT_ERRORS, DatabaseUnavailable
from app.services import global_forecast as gf
import time

MODEL_DIR = Path("ml_models/lstm")
MODEL_DIR.mkdir(parents=True, exist_ok=True)

DAYS_NEEDED = 28
CHECKINS_NEEDED = 20


def _risk_label(risk: float) -> str:
    if risk < 0.35:
        return "low"
    if risk < 0.65:
        return "moderate"
    return "high"


def _recommendation(risk: float, stressor: str | None) -> str:
    if risk < 0.35:
        return "Looking good — maintain your current routine."
    if stressor and "exam" in stressor.lower():
        return "Exam detected. Consider a 15-min break before the session and sleep by 10 PM tonight."
    if risk >= 0.65:
        return "High load predicted. Pre-schedule 2 short breaks and avoid late-night work."
    return "Moderate load ahead. A short walk between tasks will help manage momentum."


_PROFILE_CACHE: dict = {"at": 0.0, "data": {}}
_PROFILE_TTL = 3600


def _tier0_prior() -> dict[int, dict]:
    """Load the trained Tier-0 prior, with its validated values as a fallback."""
    trained_prior = {
        "0": 0.5193,
        "1": 0.4753,
        "2": 0.4365,
        "3": 0.4463,
        "4": 0.4470,
        "5": 0.4125,
        "6": 0.4603,
    }

    try:
        import json
        from pathlib import Path

        f = Path(__file__).resolve().parents[2] / "ml" / "models" / "saved" / "tier0_prior.json"
        if f.is_file():
            loaded = gf.prior_profile(json.loads(f.read_text()))
            if loaded:
                return loaded
    except Exception:
        pass

    return gf.prior_profile(trained_prior)


def _population_profile(db) -> dict[int, dict]:
    """Weekday profile across all users (aggregates only). SQL function first, capped Python fallback second."""
    if time.time() - _PROFILE_CACHE["at"] < _PROFILE_TTL:
        return _PROFILE_CACHE["data"]
    prof: dict[int, dict] = {}
    try:
        rows = db.rpc("global_weekday_profile", {}).execute().data or []
        prof = {int(r["dow"]): {"factor": float(r["factor"]), "users": int(r["users"]), "mean_score": float(r["mean_score"])} for r in rows}
    except Exception:
        try:
            since = (datetime.utcnow() - timedelta(days=60)).isoformat()
            rows, page = [], 1000
            for i in range(20):                                   # ≤ 20k rows: a bounded fallback
                chunk = (db.table("if_scores").select("user_id,deviation_score,created_at")
                         .gte("created_at", since).order("created_at").range(i * page, (i + 1) * page - 1).execute().data or [])
                rows.extend(chunk)
                if len(chunk) < page:
                    break
            prof = gf.profile_from_rows(
                (r["user_id"], datetime.fromisoformat(str(r["created_at"]).replace("Z", "+00:00")), r["deviation_score"]) for r in rows)
        except Exception:
            prof = {}
    prof = gf.merge_prior(prof, _tier0_prior())      # trained StudentLife weekday prior fills thin/empty weekdays
    _PROFILE_CACHE.update(at=time.time(), data=prof)
    return prof


def _global_forecast(uid: str, db, basis: dict, days_left: int) -> ForecastResponse:
    """Starter forecast: everyone's weekday pattern + this user's own level + their calendar."""
    today = date.today()
    try:
        since = (datetime.utcnow() - timedelta(days=7)).isoformat()
        own = db.table("if_scores").select("deviation_score").eq("user_id", uid).gte("created_at", since).limit(1000).execute().data or []
        own_scores = [float(r["deviation_score"]) for r in own]
        wanted = [(today + timedelta(days=i)).isoformat() for i in (1, 2, 3)]
        cal_rows = db.table("calendar_events").select("event_date,exam_flag,meeting_density,total_committed_hours").eq("user_id", uid).in_("event_date", wanted).execute().data or []
        cal = {r["event_date"]: r for r in cal_rows}
        days, cohort = gf.build_days(today, own_scores, _population_profile(db), cal)
    except TRANSIENT_ERRORS as e:                 # database unreachable: say so (503), don't present "not ready" as the truth
        raise DatabaseUnavailable(f"starter forecast reads failed: {type(e).__name__}") from e
    except Exception:
        days, cohort = [], 0
    if not days:
        return ForecastResponse(model_ready=False, days_until_ready=days_left, **basis)
    fcs = [DayForecast(date=d["date"], risk=d["risk"], risk_label=_risk_label(d["risk"]),
                       primary_stressor=d["stressor"], recommendation=_recommendation(d["risk"], d["stressor"])) for d in days]
    return ForecastResponse(model_ready=True, forecasts=fcs, generated_at=datetime.utcnow().isoformat(),
                            days_until_ready=days_left, source="global", personal_ready=False, cohort_size=cohort, **basis)


async def get_forecast_for_user(uid: str, db) -> ForecastResponse:
    # Check cold-start conditions
    # Reads are retried a few times on transient network errors (timeouts, resets). If the database
    # stays unreachable, DatabaseUnavailable propagates and the endpoint answers 503 — no forecast
    # is invented from data we could not read.
    user = db_run(lambda: db.table("users").select("lstm_model_trained_at").eq("id", uid).execute(),
                  what="forecast: user lookup")
    if not user.data:
        return ForecastResponse(model_ready=False, days_until_ready=DAYS_NEEDED)

    model_path = MODEL_DIR / f"{uid}.pt"

    # Count available data (exact — an un-paged select is capped at ~1000 rows ≈ 8 h and under-counts days)
    days_of_data = db_run(lambda: count_data_days(db, uid), what="forecast: data-day count")

    checkins = db_run(lambda: db.table("mood_checkins").select("id", count="exact").eq("user_id", uid).execute(),
                      what="forecast: check-in count")
    checkins_count = checkins.count or 0

    basis = dict(days_of_data=days_of_data, checkins_count=checkins_count,
                 days_needed=DAYS_NEEDED, checkins_needed=CHECKINS_NEEDED)

    if days_of_data < DAYS_NEEDED or checkins_count < CHECKINS_NEEDED or not model_path.exists():
        days_left = max(0, DAYS_NEEDED - days_of_data)
        return _global_forecast(uid, db, basis, days_left)

    # Load LSTM model
    try:
        import torch
        from app.ml.lstm_model import StressLSTM
        model = StressLSTM()
        model.load_state_dict(torch.load(str(model_path), map_location="cpu"))
        model.eval()
    except Exception:
        return _global_forecast(uid, db, basis, 0)

    # Build 14-day sequence
    sequence = _build_sequence(uid, db)
    if sequence is None:
        return _global_forecast(uid, db, basis, 0)

    try:
        with __import__("torch").no_grad():
            inp = __import__("torch").tensor(sequence, dtype=__import__("torch").float32).unsqueeze(0)
            out = model(inp).squeeze().tolist()
            if isinstance(out, float):
                out = [out, out, out]
        if len(out) < 3 or not all(np.isfinite(out[:3])):
            raise ValueError("invalid LSTM output")
    except Exception:                      # a broken personal model must never break the forecast: use the starter forecast
        return _global_forecast(uid, db, basis, 0)

    today = date.today()
    forecasts = []
    for i, risk in enumerate(out[:3]):
        risk = float(np.clip(risk, 0, 1))
        target_date = today + timedelta(days=i + 1)

        # Get calendar stressor for that day
        cal = (
            db.table("calendar_events")
            .select("exam_flag,meeting_density,total_committed_hours")
            .eq("user_id", uid)
            .eq("event_date", target_date.isoformat())
            .execute()
        )
        stressor = None
        if cal.data:
            c = cal.data[0]
            if c.get("exam_flag"):
                stressor = f"Exam / deadline detected"
            elif (c.get("total_committed_hours") or 0) > 5:
                stressor = f"{c['total_committed_hours']:.1f}h committed calendar time"
            elif (c.get("meeting_density") or 0) >= 4:
                stressor = f"{int(c['meeting_density'])} meetings"

        forecasts.append(DayForecast(
            date=target_date.isoformat(),
            risk=round(risk, 3),
            risk_label=_risk_label(risk),
            primary_stressor=stressor,
            recommendation=_recommendation(risk, stressor),
        ))

    # Latest forecast row
    latest = (
        db.table("lstm_forecasts")
        .select("generated_at")
        .eq("user_id", uid)
        .order("generated_at", desc=True)
        .limit(1)
        .execute()
    )
    gen_at = latest.data[0]["generated_at"] if latest.data else datetime.utcnow().isoformat()

    return ForecastResponse(
        model_ready=True,
        forecasts=forecasts,
        generated_at=gen_at,
        source="personal",
        personal_ready=True,
        **basis,
    )


def _build_sequence(uid: str, db) -> np.ndarray | None:
    """Build 14 × 11 input tensor."""
    today = date.today()
    days = [today - timedelta(days=i) for i in range(13, -1, -1)]
    rows = []
    for d in days:
        # Behavioral daily aggregates
        scores = (
            db.table("if_scores")
            .select("deviation_score")
            .eq("user_id", uid)
            .gte("created_at", d.isoformat())
            .lt("created_at", (d + timedelta(days=1)).isoformat())
            .execute()
        )
        vals = [float(r["deviation_score"]) for r in (scores.data or [])]
        mean_score = np.mean(vals) / 100 if vals else 0.0
        std_score = np.std(vals) / 100 if vals else 0.0

        logs = (
            db.table("behavioral_logs")
            .select("error_rate,session_duration")
            .eq("user_id", uid)
            .gte("window_start", d.isoformat())
            .lt("window_start", (d + timedelta(days=1)).isoformat())
            .execute()
        )
        error_rates = [float(r["error_rate"]) for r in (logs.data or []) if r.get("error_rate") is not None]
        sessions = [int(r["session_duration"]) for r in (logs.data or []) if r.get("session_duration")]
        mean_error = np.mean(error_rates) if error_rates else 0.0
        active_hours = sum(sessions) / 3600 / 8 if sessions else 0.0  # norm by 8h

        # Calendar features
        cal = (
            db.table("calendar_events")
            .select("exam_flag,meeting_density,earliest_start_norm,total_committed_hours,consecutive_loaded_days,days_to_next_free")
            .eq("user_id", uid)
            .eq("event_date", d.isoformat())
            .execute()
        )
        if cal.data:
            c = cal.data[0]
            exam = float(c.get("exam_flag") or 0)
            density = min((c.get("meeting_density") or 0) / 10, 1.0)
            earliest = float(c.get("earliest_start_norm") or 0.375)
            committed = min((c.get("total_committed_hours") or 0) / 8, 1.0)
            consec = min((c.get("consecutive_loaded_days") or 0) / 7, 1.0)
            free = 1.0 - min((c.get("days_to_next_free") or 0) / 7, 1.0)
        else:
            exam, density, earliest, committed, consec, free = 0, 0, 0.375, 0, 0, 1.0

        rows.append([mean_score, std_score, 0.0, mean_error, active_hours, exam, density, earliest, committed, consec, free])

    arr = np.array(rows, dtype=np.float32)
    return arr if arr.shape == (14, 11) else None

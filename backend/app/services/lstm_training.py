"""
Automatic personal-LSTM training.

Flow
  scheduler (hourly) / check-in hook -> evaluate_user() -> enqueue_training() -> single background worker
  -> run_training_job(): claim (DB lock) -> build sequences from the user's REAL data -> fit -> validate
  -> save atomically -> update users.* metadata.  The forecast service picks the file up on its next request
  and keeps using the starter (global) forecast whenever no valid personal model exists.

Design rules
  * One training job per user at a time (in-process guard + conditional UPDATE lock in the database, with a stale-lock timeout).
  * A failed or invalid run never touches an existing model file: weights are written to <uid>.pt.tmp, validated, then os.replace()d.
  * Failures are recorded (status='failed', lstm_last_error) and retried only after FAILURE_BACKOFF_H hours.
  * Retraining needs RETRAIN_MIN_NEW_DAYS more days of data AND RETRAIN_MIN_INTERVAL_H hours since the last model.
  * Training target: the user's own mean deviation score of each of the next 3 days (/100), blended with the mood
    check-in (rating 1..5 -> (5-rating)/4) on days that have one.  The model therefore forecasts the user's own
    behavioral deviation; it is not validated against an external stress measure.
"""
from __future__ import annotations

import logging
import math
import os
import shutil
import threading
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import numpy as np

log = logging.getLogger("stresstwin.lstm_training")

# ── policy ────────────────────────────────────────────────────────────────────
MIN_DAYS = 28                    # days with behavioral data
MIN_CHECKINS = 20                # mood check-ins
MIN_SEQUENCES = 10               # valid 14-day training windows
SEQ_LEN, HORIZON, N_FEAT = 14, 3, 11
MIN_ACTIVE_DAYS = 10             # of the 14 input days, at least this many must contain scores
LOOKBACK_DAYS = 60               # history used for training
CHECKIN_WEIGHT = 0.5             # weight of the check-in in the target of a day that has one
EPOCHS = 60
RETRAIN_MIN_NEW_DAYS = 7
RETRAIN_MIN_INTERVAL_H = 24
FAILURE_BACKOFF_H = 6
STALE_LOCK_MIN = 60
MODEL_DIR = Path("ml_models/lstm")
PAGE = 1000


def model_path(uid: str, model_dir: Path | None = None) -> Path:
    return Path(model_dir or MODEL_DIR) / f"{uid}.pt"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _parse(ts) -> datetime | None:
    if not ts:
        return None
    try:
        dt = datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


# ── data loading (real user rows) ─────────────────────────────────────────────
def _fetch_all(db, table: str, cols: str, uid: str, time_col: str, since_iso: str) -> list[dict]:
    rows: list[dict] = []
    for i in range(400):                                   # hard ceiling: 400k rows
        chunk = (db.table(table).select(cols).eq("user_id", uid).gte(time_col, since_iso)
                 .order(time_col).range(i * PAGE, (i + 1) * PAGE - 1).execute().data or [])
        rows.extend(chunk)
        if len(chunk) < PAGE:
            break
    return rows


@dataclass
class History:
    scores: dict = field(default_factory=dict)       # day -> [deviation_score]
    logs: dict = field(default_factory=dict)         # day -> [row]
    calendar: dict = field(default_factory=dict)     # day -> row
    ratings: dict = field(default_factory=dict)      # day -> [rating]


def load_history(db, uid: str, today: date) -> History:
    since = (today - timedelta(days=LOOKBACK_DAYS)).isoformat()
    h = History()
    for r in _fetch_all(db, "if_scores", "deviation_score,created_at", uid, "created_at", since):
        h.scores.setdefault(str(r["created_at"])[:10], []).append(float(r["deviation_score"]))
    for r in _fetch_all(db, "behavioral_logs", "error_rate,session_duration,window_start", uid, "window_start", since):
        h.logs.setdefault(str(r["window_start"])[:10], []).append(r)
    for r in _fetch_all(db, "calendar_events",
                        "event_date,exam_flag,meeting_density,earliest_start_norm,total_committed_hours,"
                        "consecutive_loaded_days,days_to_next_free", uid, "event_date", since):
        h.calendar[str(r["event_date"])[:10]] = r
    for r in _fetch_all(db, "mood_checkins", "rating,created_at", uid, "created_at", since):
        h.ratings.setdefault(str(r["created_at"])[:10], []).append(int(r["rating"]))
    return h


# ── features: identical to forecast_service._build_sequence (verified by a test) ─
def daily_features(day: date, h: History) -> list[float]:
    key = day.isoformat()
    vals = h.scores.get(key, [])
    mean_score = float(np.mean(vals)) / 100 if vals else 0.0
    std_score = float(np.std(vals)) / 100 if vals else 0.0
    lg = h.logs.get(key, [])
    errs = [float(r["error_rate"]) for r in lg if r.get("error_rate") is not None]
    sess = [int(r["session_duration"]) for r in lg if r.get("session_duration")]
    mean_err = float(np.mean(errs)) if errs else 0.0
    active = sum(sess) / 3600 / 8 if sess else 0.0
    c = h.calendar.get(key)
    if c:
        exam = float(c.get("exam_flag") or 0)
        density = min((c.get("meeting_density") or 0) / 10, 1.0)
        earliest = float(c.get("earliest_start_norm") or 0.375)
        committed = min((c.get("total_committed_hours") or 0) / 8, 1.0)
        consec = min((c.get("consecutive_loaded_days") or 0) / 7, 1.0)
        free = 1.0 - min((c.get("days_to_next_free") or 0) / 7, 1.0)
    else:
        exam, density, earliest, committed, consec, free = 0, 0, 0.375, 0, 0, 1.0
    return [mean_score, std_score, 0.0, mean_err, active, exam, density, earliest, committed, consec, free]


def _target(day: date, h: History) -> float | None:
    vals = h.scores.get(day.isoformat())
    if not vals:
        return None
    t = float(np.mean(vals)) / 100
    r = h.ratings.get(day.isoformat())
    if r:
        t = (1 - CHECKIN_WEIGHT) * t + CHECKIN_WEIGHT * ((5 - float(np.mean(r))) / 4)
    return float(min(max(t, 0.0), 1.0))


def build_training_data(h: History, today: date) -> tuple[np.ndarray, np.ndarray]:
    """Sliding 14-day windows ending at day i, target = days i+1..i+3. Only complete days (up to yesterday) are used."""
    last = today - timedelta(days=1)
    days = [last - timedelta(days=i) for i in range(LOOKBACK_DAYS - 1, -1, -1)]
    feats = {d: daily_features(d, h) for d in days}
    has = {d: bool(h.scores.get(d.isoformat())) for d in days}
    X, y = [], []
    for i in range(SEQ_LEN - 1, len(days) - HORIZON):
        window = days[i - SEQ_LEN + 1: i + 1]
        if sum(has[d] for d in window) < MIN_ACTIVE_DAYS:
            continue
        tg = [_target(days[i + k], h) for k in range(1, HORIZON + 1)]
        if any(t is None for t in tg):
            continue
        X.append([feats[d] for d in window]); y.append(tg)
    if not X:
        return np.zeros((0, SEQ_LEN, N_FEAT), np.float32), np.zeros((0, HORIZON), np.float32)
    return np.array(X, dtype=np.float32), np.array(y, dtype=np.float32)


# ── eligibility ───────────────────────────────────────────────────────────────
@dataclass
class Eligibility:
    eligible: bool
    reason: str
    days: int = 0
    checkins: int = 0
    sequences: int = 0


def _counts(db, uid: str) -> tuple[int, int]:
    from app.services.data_days import count_data_days
    days = count_data_days(db, uid)
    res = db.table("mood_checkins").select("id", count="exact").eq("user_id", uid).execute()
    return days, int(res.count or 0)


def check_eligibility(db, uid: str, today: date | None = None, with_sequences: bool = True) -> tuple[Eligibility, tuple | None]:
    """Returns (Eligibility, (X, y) or None).  Sequences are only built when days and check-ins already qualify."""
    today = today or _now().date()
    days, checkins = _counts(db, uid)
    if days < MIN_DAYS:
        return Eligibility(False, "insufficient_days", days, checkins), None
    if checkins < MIN_CHECKINS:
        return Eligibility(False, "insufficient_checkins", days, checkins), None
    if not with_sequences:
        return Eligibility(True, "ok", days, checkins), None
    X, y = build_training_data(load_history(db, uid, today), today)
    if len(X) < MIN_SEQUENCES:
        return Eligibility(False, "insufficient_sequences", days, checkins, len(X)), None
    return Eligibility(True, "ok", days, checkins, len(X)), (X, y)


# ── decision (pure) ───────────────────────────────────────────────────────────
@dataclass
class Decision:
    train: bool
    reason: str
    days: int = 0
    checkins: int = 0


def decide(user: dict, days: int, checkins: int, model_exists: bool, now: datetime) -> Decision:
    """Cheap pre-check (no sequence building): should a training job be queued for this user?"""
    status = user.get("lstm_training_status") or "idle"
    started = _parse(user.get("lstm_training_started_at"))
    if status == "running" and started and now - started < timedelta(minutes=STALE_LOCK_MIN):
        return Decision(False, "already_running", days, checkins)
    if days < MIN_DAYS:
        return Decision(False, "insufficient_days", days, checkins)
    if checkins < MIN_CHECKINS:
        return Decision(False, "insufficient_checkins", days, checkins)
    last_attempt = _parse(user.get("lstm_last_attempt_at"))
    if status == "failed" and last_attempt and now - last_attempt < timedelta(hours=FAILURE_BACKOFF_H):
        return Decision(False, "failure_backoff", days, checkins)
    trained_at = _parse(user.get("lstm_model_trained_at"))
    if not model_exists or trained_at is None:
        return Decision(True, "initial", days, checkins)
    new_days = days - int(user.get("lstm_trained_days") or 0)
    if new_days >= RETRAIN_MIN_NEW_DAYS and now - trained_at >= timedelta(hours=RETRAIN_MIN_INTERVAL_H):
        return Decision(True, "retrain", days, checkins)
    return Decision(False, "up_to_date", days, checkins)


def evaluate_user(db, uid: str, now: datetime | None = None, model_dir: Path | None = None) -> Decision:
    now = now or _now()
    cols = ("lstm_model_trained_at,lstm_training_status,lstm_training_started_at,lstm_last_attempt_at,lstm_trained_days")
    try:
        res = db.table("users").select(cols).eq("id", uid).execute().data
    except Exception:                                   # migration 008 not applied yet: fall back to the original column
        res = db.table("users").select("lstm_model_trained_at").eq("id", uid).execute().data
    if not res:
        return Decision(False, "no_such_user")
    days, checkins = _counts(db, uid)
    return decide(res[0], days, checkins, model_path(uid, model_dir).exists(), now)


# ── locking / duplicate prevention ────────────────────────────────────────────
_inflight: set[str] = set()
_inflight_lock = threading.Lock()


def claim(db, uid: str, now: datetime | None = None) -> bool:
    """True if this caller now owns the training slot for uid. In-process set + conditional UPDATE in the database."""
    now = now or _now()
    with _inflight_lock:
        if uid in _inflight:
            return False
        _inflight.add(uid)
    try:
        stale = (now - timedelta(minutes=STALE_LOCK_MIN)).isoformat()
        # release a lock left behind by a crashed worker
        db.table("users").update({"lstm_training_status": "failed", "lstm_last_error": "stale training lock released"}) \
            .eq("id", uid).eq("lstm_training_status", "running").lt("lstm_training_started_at", stale).execute()
        got = db.table("users").update({"lstm_training_status": "running", "lstm_training_started_at": now.isoformat()}) \
            .eq("id", uid).neq("lstm_training_status", "running").execute().data
        if not got:
            release(uid)
            return False
        return True
    except Exception as e:                              # columns missing (migration 008): single-process guard only
        log.warning("DB training lock unavailable (%s); using in-process guard only", e)
        return True


def release(uid: str) -> None:
    with _inflight_lock:
        _inflight.discard(uid)


# ── model backend (torch is imported lazily so everything above works without it) ─
class TorchBackend:
    def fit(self, X: np.ndarray, y: np.ndarray):
        from app.ml.lstm_model import fit_model
        return fit_model(X, y, epochs=EPOCHS, seed=7)          # -> (model, final_loss)

    def predict(self, model, X: np.ndarray) -> np.ndarray:
        import torch
        with torch.no_grad():
            return model(torch.tensor(X, dtype=torch.float32)).numpy()

    def save(self, model, path: Path) -> None:
        import torch
        torch.save(model.state_dict(), str(path))


@dataclass
class JobResult:
    ok: bool
    reason: str
    sequences: int = 0
    train_mse: float | None = None
    baseline_mse: float | None = None


def _update_user(db, uid: str, fields: dict) -> None:
    try:
        db.table("users").update(fields).eq("id", uid).execute()
    except Exception as e:
        log.warning("could not update training metadata for %s: %s", uid, e)


def run_training_job(uid: str, db=None, backend=None, model_dir: Path | None = None,
                     now: datetime | None = None, already_claimed: bool = False) -> JobResult:
    """Train, validate and atomically publish a personal model for uid. Never raises."""
    if db is None:
        from app.core.database import get_supabase_admin
        db = get_supabase_admin()
    backend = backend or TorchBackend()
    now = now or _now()
    if not already_claimed and not claim(db, uid, now):
        return JobResult(False, "duplicate")
    final = model_path(uid, model_dir)
    tmp = final.with_suffix(".pt.tmp")
    try:
        final.parent.mkdir(parents=True, exist_ok=True)
        elig, data = check_eligibility(db, uid, now.date())
        if not elig.eligible or data is None:
            _update_user(db, uid, {"lstm_training_status": "idle", "lstm_last_attempt_at": now.isoformat()})
            return JobResult(False, elig.reason, elig.sequences)
        X, y = data
        model, loss = backend.fit(X, y)
        if loss is None or not math.isfinite(float(loss)):
            raise ValueError(f"non-finite training loss: {loss}")
        pred = np.asarray(backend.predict(model, X), dtype=float)
        if pred.shape != (len(X), HORIZON) or not np.isfinite(pred).all() or pred.min() < 0 or pred.max() > 1:
            raise ValueError("model produced invalid predictions (shape, NaN or outside [0, 1])")
        train_mse = float(np.mean((pred - y) ** 2))
        baseline_mse = float(np.mean((y - y.mean()) ** 2))
        backend.save(model, tmp)
        if not tmp.exists() or tmp.stat().st_size == 0:
            raise IOError("model file was not written")
        if final.exists():
            shutil.copy2(final, final.with_suffix(".pt.prev"))     # one-step rollback copy
        os.replace(tmp, final)                                    # atomic publish
        _update_user(db, uid, {
            "lstm_model_trained_at": now.isoformat(), "lstm_training_status": "idle", "lstm_last_error": None,
            "lstm_last_attempt_at": now.isoformat(), "lstm_trained_days": elig.days,
            "lstm_trained_sequences": len(X), "lstm_train_mse": round(train_mse, 6), "lstm_baseline_mse": round(baseline_mse, 6)})
        log.info("personal LSTM trained for %s: %d sequences, train_mse=%.4f baseline_mse=%.4f", uid, len(X), train_mse, baseline_mse)
        return JobResult(True, "trained", len(X), train_mse, baseline_mse)
    except Exception as e:
        log.exception("personal LSTM training failed for %s", uid)
        try:
            if tmp.exists():
                tmp.unlink()
        except OSError:
            pass
        _update_user(db, uid, {"lstm_training_status": "failed", "lstm_last_attempt_at": now.isoformat(),
                               "lstm_last_error": str(e)[:500]})
        return JobResult(False, f"error: {e}")
    finally:
        release(uid)


# ── background execution ──────────────────────────────────────────────────────
_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="lstm-train")


def enqueue_training(uid: str, db=None, backend=None, model_dir: Path | None = None, executor=None):
    """Claim the slot and run the job on the single background worker. Returns the Future, or None if a job already exists."""
    if db is None:
        from app.core.database import get_supabase_admin
        db = get_supabase_admin()
    if not claim(db, uid):
        return None
    try:
        return (executor or _executor).submit(run_training_job, uid, db, backend, model_dir, None, True)
    except Exception:
        release(uid)
        raise


def schedule_personal_lstm_training(db=None, backend=None, model_dir: Path | None = None, executor=None) -> dict:
    """Scheduler job: queue training for every user that needs an initial model or a retrain."""
    if db is None:
        from app.core.database import get_supabase_admin
        db = get_supabase_admin()
    queued = skipped = 0
    for u in (db.table("users").select("id").execute().data or []):
        try:
            d = evaluate_user(db, u["id"], model_dir=model_dir)
            if d.train and enqueue_training(u["id"], db, backend, model_dir, executor) is not None:
                queued += 1
            else:
                skipped += 1
        except Exception as e:
            log.warning("eligibility check failed for %s: %s", u["id"], e)
    log.info("personal LSTM scheduling: %d queued, %d skipped", queued, skipped)
    return {"queued": queued, "skipped": skipped}


def request_training_check(uid: str) -> None:
    """Cheap hook for events (e.g. a new check-in): queue training for this user now if eligible."""
    try:
        from app.core.database import get_supabase_admin
        db = get_supabase_admin()
        if evaluate_user(db, uid).train:
            enqueue_training(uid, db)
    except Exception as e:
        log.warning("training check failed for %s: %s", uid, e)

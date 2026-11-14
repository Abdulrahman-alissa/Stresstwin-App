"""
Create a SYNTHETIC test account with 30 days of behavioral data and 20 mood check-ins, then train and
verify the personal LSTM for it.  FOR TESTING ONLY: the data is generated, not collected from a person,
and must never be presented as real participant data or as validation of the model.

The account passes the app's personal-forecast gate (>= 28 days of data, >= 20 check-ins, trained .pt model).

Run from the backend root (needs the same .env as the server and `pip install -r requirements.txt`):

    python scripts/seed_test_account.py                 # create + seed + train + verify
    python scripts/seed_test_account.py --dry-run       # only generate; writes CSVs to scripts/seed_preview/
    python scripts/seed_test_account.py --reset         # delete the existing test account first, then recreate
    python scripts/seed_test_account.py --no-train      # seed data only

Login afterwards with the e-mail / password printed at the end (defaults below).
"""
from __future__ import annotations
import argparse, asyncio, sys, uuid
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

DEFAULT_EMAIL = "lstm.test@stresstwin.test"
DEFAULT_PASSWORD = "StressTwin#Test1"
FULL_NAME = "LSTM Test Account (synthetic data)"
WINDOWS_PER_DAY = 48
SEQ_LEN, N_FEAT, HORIZON = 14, 11, 3


# ───────────────────────── generation (pure, no DB) ─────────────────────────
def generate(uid: str, days: int = 30, checkins: int = 20, seed: int = 7, today: date | None = None) -> dict:
    rng = np.random.default_rng(seed)
    today = today or datetime.now(timezone.utc).date()
    start = today - timedelta(days=days - 1)
    day_list = [start + timedelta(days=i) for i in range(days)]
    future = [today + timedelta(days=i) for i in range(1, HORIZON + 1)]

    # exams: two inside the history, one two days from today (so the forecast shows a stressor)
    exam_days = {day_list[days // 3], day_list[days // 3 + 1], day_list[-6], today + timedelta(days=2)}
    weekday_fx = {0: .05, 1: .03, 2: 0.0, 3: .01, 4: .0, 5: -.06, 6: -.03}

    level, noise = {}, 0.0
    for i, d in enumerate(day_list + future):
        noise = 0.6 * noise + rng.normal(0, 0.05)
        pre_exam = sum(0.07 for k in (1, 2) if (d + timedelta(days=k)) in exam_days)   # stress builds 1-2 days before an exam
        level[d] = float(np.clip(0.38 + weekday_fx[d.weekday()] + (0.16 if d in exam_days else 0) + pre_exam
                                 + 0.04 * np.sin(i / 4.5) + noise, 0.08, 0.92))

    logs, scores = [], []
    for d in day_list:
        plat = "desktop" if (d.weekday() < 5 and rng.random() < 0.65) else "android"
        for k in range(WINDOWS_PER_DAY):
            minute = int(8 * 60 + (k + rng.random()) * (14 * 60 / WINDOWS_PER_DAY))
            ts = datetime(d.year, d.month, d.day, minute // 60, minute % 60, int(rng.integers(0, 60)), tzinfo=timezone.utc)
            L = level[d]
            score = float(np.clip(L * 100 + 6 * np.sin(minute / 140) + rng.normal(0, 7), 0, 100))
            lid = str(uuid.uuid4())
            row = {"id": lid, "user_id": uid, "window_start": ts.isoformat(), "platform": plat,
                   "keystroke_mean": round(float(170 + 130 * L + rng.normal(0, 18)), 2),
                   "keystroke_std": round(float(35 + 70 * L + rng.normal(0, 8)), 2),
                   "error_rate": round(float(np.clip(0.04 + 0.12 * L + rng.normal(0, 0.015), 0, 1)), 4),
                   "idle_frequency": round(float(max(0, 1.0 + 2.2 * L + rng.normal(0, 0.3))), 3),
                   "app_switch_rate": round(float(max(0, 0.3 + 1.5 * L + rng.normal(0, 0.2))), 3),
                   "session_duration": 30}
            if plat == "desktop":
                row.update(mouse_velocity=round(float(400 + 500 * L + rng.normal(0, 60)), 1),
                           mouse_smoothness=round(float(np.clip(0.85 - 0.35 * L + rng.normal(0, 0.04), 0, 1)), 3),
                           click_hesitation=round(float(max(0, 120 + 260 * L + rng.normal(0, 30))), 1))
            else:
                row.update(touch_pressure=round(float(np.clip(0.35 + 0.3 * L + rng.normal(0, 0.04), 0, 1)), 3),
                           gyro_variance=round(float(max(0, 0.05 + 0.4 * L + rng.normal(0, 0.05))), 3))
            logs.append(row)
            scores.append({"user_id": uid, "log_id": lid, "deviation_score": round(score, 2),
                           "threshold_crossed": score >= 70, "created_at": ts.isoformat()})

    # 20 check-ins spread over the period, rating falls as that day's stress rises (1 = worst, 5 = best)
    pick = sorted(rng.choice(days, size=checkins, replace=checkins > days))
    mood = []
    for j, i in enumerate(pick):
        d = day_list[i]
        rating = int(np.clip(round(5 - 4.2 * level[d] + rng.normal(0, 0.5)), 1, 5))
        ts = datetime(d.year, d.month, d.day, 12 + (j % 8), int(rng.integers(0, 60)), tzinfo=timezone.utc)
        mood.append({"user_id": uid, "rating": rating, "note": "synthetic test check-in", "created_at": ts.isoformat()})

    # calendar rows for the history and the next 3 days
    cal, run = [], 0
    for d in day_list + future:
        ex = d in exam_days
        meetings = int(np.clip(round(rng.normal(2.5 + 3 * ex, 1.2)), 0, 9))
        hours = float(np.clip(rng.normal(3.0 + 3 * ex, 1.0), 0, 9))
        run = run + 1 if (hours > 4 or ex) else 0
        nxt = next((k for k in range(1, 8) if (d + timedelta(days=k)).weekday() >= 5), 3)
        cal.append({"user_id": uid, "event_date": d.isoformat(), "exam_flag": ex, "meeting_density": meetings,
                    "earliest_start_norm": round(float(np.clip(rng.normal(0.4, 0.06), 0, 1)), 3),
                    "total_committed_hours": round(hours, 2), "consecutive_loaded_days": run, "days_to_next_free": nxt})

    seqs, labels = build_training_set(day_list, logs, scores, cal)
    return {"logs": logs, "scores": scores, "checkins": mood, "calendar": cal, "sequences": seqs, "labels": labels,
            "days": day_list, "level": level}


def _daily_features(d: date, logs, scores, cal_by_date) -> list[float]:
    """Mirror of forecast_service._build_sequence for one day (11 features) so training and inference agree."""
    key = d.isoformat()
    sc = [float(s["deviation_score"]) for s in scores if s["created_at"][:10] == key]
    lg = [r for r in logs if r["window_start"][:10] == key]
    mean_s = float(np.mean(sc)) / 100 if sc else 0.0
    std_s = float(np.std(sc)) / 100 if sc else 0.0
    errs = [r["error_rate"] for r in lg if r.get("error_rate") is not None]
    sess = [r["session_duration"] for r in lg if r.get("session_duration")]
    mean_e = float(np.mean(errs)) if errs else 0.0
    active = sum(sess) / 3600 / 8 if sess else 0.0
    c = cal_by_date.get(key)
    if c:
        ex, dens = float(c["exam_flag"]), min(c["meeting_density"] / 10, 1.0)
        earl, comm = float(c["earliest_start_norm"] or 0.375), min(c["total_committed_hours"] / 8, 1.0)
        cons, free = min(c["consecutive_loaded_days"] / 7, 1.0), 1.0 - min(c["days_to_next_free"] / 7, 1.0)
    else:
        ex, dens, earl, comm, cons, free = 0, 0, 0.375, 0, 0, 1.0
    return [mean_s, std_s, 0.0, mean_e, active, ex, dens, earl, comm, cons, free]


def build_training_set(day_list, logs, scores, cal):
    cal_by = {c["event_date"]: c for c in cal}
    feats = {d: _daily_features(d, logs, scores, cal_by) for d in day_list}
    X, y = [], []
    for i in range(SEQ_LEN - 1, len(day_list) - HORIZON):
        X.append([feats[day_list[j]] for j in range(i - SEQ_LEN + 1, i + 1)])
        y.append([feats[day_list[i + k]][0] for k in range(1, HORIZON + 1)])      # next-3-day mean score / 100
    return np.array(X, dtype=np.float32), np.clip(np.array(y, dtype=np.float32), 0, 1)


# ───────────────────────── database side ─────────────────────────
def _batched(db, table: str, rows: list[dict], n: int = 400):
    for i in range(0, len(rows), n):
        db.table(table).insert(rows[i:i + n]).execute()


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--email", default=DEFAULT_EMAIL)
    ap.add_argument("--password", default=DEFAULT_PASSWORD)
    ap.add_argument("--days", type=int, default=30)
    ap.add_argument("--checkins", type=int, default=20)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--epochs", type=int, default=60)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--reset", action="store_true")
    ap.add_argument("--no-train", action="store_true")
    a = ap.parse_args()

    uid = str(uuid.uuid4())
    data = generate(uid, a.days, a.checkins, a.seed)
    print(f"Generated {len(data['logs'])} windows over {a.days} days, {len(data['checkins'])} check-ins, "
          f"{len(data['calendar'])} calendar days, {len(data['sequences'])} training sequences (14x11).")

    if a.dry_run:
        import csv
        out = ROOT / "scripts" / "seed_preview"; out.mkdir(exist_ok=True)
        for name in ("logs", "scores", "checkins", "calendar"):
            rows = data[name]
            with open(out / f"{name}.csv", "w", newline="") as f:
                w = csv.DictWriter(f, fieldnames=sorted({k for r in rows for k in r})); w.writeheader(); w.writerows(rows)
        print(f"Dry run: CSVs written to {out}. Nothing was sent to Supabase.")
        return

    from app.core.database import get_supabase_admin
    from app.core.security import hash_password
    db = get_supabase_admin()

    existing = db.table("users").select("id").eq("email", a.email).execute().data
    if existing:
        if not a.reset:
            sys.exit(f"{a.email} already exists. Re-run with --reset to delete and recreate it (cascades to all its rows).")
        db.table("users").delete().eq("email", a.email).execute()
        print("Existing test account deleted.")

    db.table("users").insert({"id": uid, "email": a.email, "password_hash": hash_password(a.password),
                              "full_name": FULL_NAME, "if_threshold": 70}).execute()
    _batched(db, "behavioral_logs", data["logs"])
    _batched(db, "if_scores", data["scores"])
    _batched(db, "mood_checkins", data["checkins"])
    _batched(db, "calendar_events", data["calendar"])
    print("Seeded behavioral_logs, if_scores, mood_checkins, calendar_events.")

    if not a.no_train:
        from app.ml.lstm_model import train_user_lstm
        train_user_lstm(uid, data["sequences"], data["labels"], epochs=a.epochs)
        db.table("users").update({"lstm_model_trained_at": datetime.now(timezone.utc).isoformat()}).eq("id", uid).execute()
        try:
            from app.ml.isolation_forest import train_user_isolation_forest
            train_user_isolation_forest(uid, db)
        except Exception as e:                                   # IF is optional for the LSTM test
            print(f"  (Isolation Forest not trained: {e})")

        from app.services.forecast_service import get_forecast_for_user
        fc = asyncio.run(get_forecast_for_user(uid, db))
        print(f"\nForecast check: source={fc.source} personal_ready={fc.personal_ready} "
              f"days_of_data={fc.days_of_data} checkins={fc.checkins_count}")
        for d in fc.forecasts:
            print(f"  {d.date}  risk={d.risk}  {d.risk_label}  stressor={d.primary_stressor}")
        if fc.forecasts:
            db.table("lstm_forecasts").insert({"user_id": uid, "day1_risk": fc.forecasts[0].risk,
                                               "day2_risk": fc.forecasts[1].risk, "day3_risk": fc.forecasts[2].risk}).execute()
        if fc.source != "personal":
            print("\nWARNING: the personal LSTM was not used. Check the printed counts above (need >= 28 days, >= 20 check-ins).")

    print(f"\nTest account ready.\n  email:    {a.email}\n  password: {a.password}\n  user id:  {uid}")
    print("Data is SYNTHETIC: use it to test the pipeline only, never as evidence of model accuracy.")


if __name__ == "__main__":
    main()

"""
Dataset construction
=====================
Turns raw Supabase rows (behavioral_logs, if_scores, calendar_events,
mood_checkins) into the same 11-feature daily rows used everywhere
(ml/features.py::DAILY_SEQUENCE_FEATURE_NAMES), then slices those daily
rows into (14-day sequence -> 3-day risk label) training pairs.

Used by:
  - ml/training/train_personal.py  (one user's own history)
  - ml/training/train_global_sequence.py (Tier 2 — pooled anonymized real
    StressTwin user data; the export_anonymized_training_frame() function
    at the bottom of this file is what that trainer calls)
"""
from __future__ import annotations
from datetime import date, datetime, timedelta, timezone
from typing import Optional

import numpy as np
import pandas as pd

from ml.features import (
    DAILY_SEQUENCE_FEATURE_NAMES,
    SEQUENCE_LENGTH_DAYS,
    FORECAST_HORIZON_DAYS,
)

N_FEATURES = len(DAILY_SEQUENCE_FEATURE_NAMES)


# ── 1. Build one daily feature row from already-fetched Supabase rows ───────
def _mood_to_risk(ratings: list[int]) -> float:
    """1 (calm) .. 5 (very stressed) -> normalized 0..1 risk. No check-in -> NaN
    (caller decides how to impute; we don't want to invent a value here)."""
    if not ratings:
        return float("nan")
    mean_rating = float(np.mean(ratings))
    return float(np.clip((mean_rating - 1) / 4, 0, 1))


def build_daily_row(
    day: date,
    if_scores: list[float],
    error_rates: list[float],
    session_durations: list[int],
    mood_ratings: list[int],
    calendar_row: Optional[dict],
) -> dict:
    mean_score = float(np.mean(if_scores)) / 100 if if_scores else 0.0
    std_score = float(np.std(if_scores)) / 100 if if_scores else 0.0
    mood_risk = _mood_to_risk(mood_ratings)
    mean_error = float(np.mean(error_rates)) if error_rates else 0.0
    active_hours = (sum(session_durations) / 3600 / 8) if session_durations else 0.0

    if calendar_row:
        exam = float(calendar_row.get("exam_flag") or 0)
        density = min((calendar_row.get("meeting_density") or 0) / 10, 1.0)
        earliest = float(calendar_row.get("earliest_start_norm") or 0.375)
        committed = min((calendar_row.get("total_committed_hours") or 0) / 8, 1.0)
        consec = min((calendar_row.get("consecutive_loaded_days") or 0) / 7, 1.0)
        free = 1.0 - min((calendar_row.get("days_to_next_free") or 0) / 7, 1.0)
    else:
        exam, density, earliest, committed, consec, free = 0.0, 0.0, 0.375, 0.0, 0.0, 1.0

    return {
        "date": day.isoformat(),
        "if_deviation_mean": mean_score,
        "if_deviation_std": std_score,
        "mood_risk": mood_risk,
        "error_rate_mean": mean_error,
        "active_hours_norm": active_hours,
        "calendar_exam_flag": exam,
        "calendar_meeting_density": density,
        "calendar_earliest_start": earliest,
        "calendar_committed_hours": committed,
        "calendar_consecutive_loaded_days": consec,
        "calendar_days_to_next_free": free,
    }


def fetch_daily_rows_for_user(db, uid: str, start: date, end: date) -> pd.DataFrame:
    """
    Pulls behavioral_logs / if_scores / calendar_events / mood_checkins for
    one user between [start, end] (inclusive) and returns one row per day.
    Missing mood check-ins are left as NaN and forward/back-filled by the
    caller (see `finalize_daily_frame`) rather than here, so callers can
    decide their own imputation policy for training vs. inference.
    """
    since_iso = start.isoformat()
    until_iso = (end + timedelta(days=1)).isoformat()

    scores = (
        db.table("if_scores")
        .select("deviation_score,created_at")
        .eq("user_id", uid)
        .gte("created_at", since_iso)
        .lt("created_at", until_iso)
        .execute()
    ).data or []

    logs = (
        db.table("behavioral_logs")
        .select("error_rate,session_duration,window_start")
        .eq("user_id", uid)
        .gte("window_start", since_iso)
        .lt("window_start", until_iso)
        .execute()
    ).data or []

    moods = (
        db.table("mood_checkins")
        .select("rating,created_at")
        .eq("user_id", uid)
        .gte("created_at", since_iso)
        .lt("created_at", until_iso)
        .execute()
    ).data or []

    cal = (
        db.table("calendar_events")
        .select("event_date,exam_flag,meeting_density,earliest_start_norm,"
                 "total_committed_hours,consecutive_loaded_days,days_to_next_free")
        .eq("user_id", uid)
        .gte("event_date", since_iso[:10])
        .lte("event_date", end.isoformat())
        .execute()
    ).data or []
    cal_by_day = {row["event_date"]: row for row in cal}

    def _day_of(iso_str: str) -> str:
        return iso_str[:10]

    scores_by_day: dict[str, list[float]] = {}
    for r in scores:
        scores_by_day.setdefault(_day_of(r["created_at"]), []).append(float(r["deviation_score"]))

    error_by_day: dict[str, list[float]] = {}
    duration_by_day: dict[str, list[int]] = {}
    for r in logs:
        d = _day_of(r["window_start"])
        if r.get("error_rate") is not None:
            error_by_day.setdefault(d, []).append(float(r["error_rate"]))
        if r.get("session_duration"):
            duration_by_day.setdefault(d, []).append(int(r["session_duration"]))

    mood_by_day: dict[str, list[int]] = {}
    for r in moods:
        mood_by_day.setdefault(_day_of(r["created_at"]), []).append(int(r["rating"]))

    rows = []
    d = start
    while d <= end:
        key = d.isoformat()
        rows.append(build_daily_row(
            d,
            scores_by_day.get(key, []),
            error_by_day.get(key, []),
            duration_by_day.get(key, []),
            mood_by_day.get(key, []),
            cal_by_day.get(key),
        ))
        d += timedelta(days=1)

    return pd.DataFrame(rows)


def finalize_daily_frame(df: pd.DataFrame) -> pd.DataFrame:
    """Impute missing mood_risk via forward-fill then back-fill then 0.5 (neutral)."""
    df = df.copy()
    df["mood_risk"] = df["mood_risk"].ffill().bfill().fillna(0.5)
    return df


# ── 2. Slice a daily frame into (X, y) training pairs ───────────────────────
def make_sequences(
    df: pd.DataFrame,
    seq_len: int = SEQUENCE_LENGTH_DAYS,
    horizon: int = FORECAST_HORIZON_DAYS,
    feature_names: list[str] = DAILY_SEQUENCE_FEATURE_NAMES,
) -> tuple[np.ndarray, np.ndarray]:
    """
    df must contain, in order, `feature_names` columns (defaults to the
    Personal LSTM's DAILY_SEQUENCE_FEATURE_NAMES — this is also what
    Tier 2, ml/training/train_global_sequence.py, uses, via
    export_anonymized_training_frame below) plus a 'label_risk' column
    giving the ground-truth risk for the day AFTER the row (used to build
    the horizon-length label window). Rows must be sorted by date
    ascending with no gaps.

    Returns:
      X: (N, seq_len, len(feature_names))
      y: (N, horizon)
    """
    feats = df[feature_names].to_numpy(dtype=np.float32)
    labels = df["label_risk"].to_numpy(dtype=np.float32)

    n = len(df)
    n_features = len(feature_names)
    X, y = [], []
    for start in range(0, n - seq_len - horizon + 1):
        end = start + seq_len
        X.append(feats[start:end])
        y.append(labels[end:end + horizon])
    if not X:
        return np.zeros((0, seq_len, n_features), dtype=np.float32), np.zeros((0, horizon), dtype=np.float32)
    return np.array(X, dtype=np.float32), np.array(y, dtype=np.float32)


def attach_labels(df: pd.DataFrame) -> pd.DataFrame:
    """
    Ground-truth label = mood_risk (self-reported stress) shifted so that
    day t's label is used to supervise the forecast that predicts day t
    from earlier days. This is the same target used for both global
    training and personal fine-tuning, and for offline validation metrics.
    """
    df = df.copy()
    df["label_risk"] = df["mood_risk"]
    return df


def build_user_training_set(db, uid: str, days_back: int = 120) -> tuple[np.ndarray, np.ndarray]:
    """End-to-end: fetch -> finalize -> label -> sequence, for one user."""
    end = date.today() - timedelta(days=1)
    start = end - timedelta(days=days_back)
    df = fetch_daily_rows_for_user(db, uid, start, end)
    df = finalize_daily_frame(df)
    df = attach_labels(df)
    return make_sequences(df)


def build_live_sequence(db, uid: str) -> Optional[np.ndarray]:
    """
    The single most-recent 14-day window, used at inference time (no label
    needed — this is what get_forecast() feeds into the model).
    """
    end = date.today() - timedelta(days=1)
    start = end - timedelta(days=SEQUENCE_LENGTH_DAYS - 1)
    df = fetch_daily_rows_for_user(db, uid, start, end)
    if len(df) != SEQUENCE_LENGTH_DAYS:
        return None
    df = finalize_daily_frame(df)
    return df[DAILY_SEQUENCE_FEATURE_NAMES].to_numpy(dtype=np.float32)


# ── 3. Public / anonymized global datasets ──────────────────────────────────
def load_prepared_csv(path: str, feature_names: list[str] = DAILY_SEQUENCE_FEATURE_NAMES) -> pd.DataFrame:
    """
    Loads a CSV already prepared into the `feature_names` + 'label_risk' +
    'series_id' + 'date' schema (defaults to the Personal LSTM's 11-feature
    schema). `series_id` groups rows into independent time series (one
    user / one participant / one synthetic session) so sequences are
    never built across a series boundary. Tier 1 (StudentLife-derived
    participant-aggregate data) does NOT go through this function — it has no
    sequence structure at all; see ml/training/train_global_baseline.py
    instead.
    """
    df = pd.read_csv(path)
    required = set(feature_names) | {"label_risk", "series_id", "date"}
    missing = required - set(df.columns)
    if missing:
        raise ValueError(f"{path} is missing required columns: {sorted(missing)}")
    return df.sort_values(["series_id", "date"]).reset_index(drop=True)


def sequences_from_prepared_frame(
    df: pd.DataFrame,
    seq_len: int = SEQUENCE_LENGTH_DAYS,
    horizon: int = FORECAST_HORIZON_DAYS,
    feature_names: list[str] = DAILY_SEQUENCE_FEATURE_NAMES,
) -> tuple[np.ndarray, np.ndarray]:
    """Same as make_sequences but respects series_id boundaries."""
    X_all, y_all = [], []
    for _, series_df in df.groupby("series_id"):
        X, y = make_sequences(series_df.reset_index(drop=True), seq_len, horizon, feature_names)
        if len(X):
            X_all.append(X)
            y_all.append(y)
    if not X_all:
        n_features = len(feature_names)
        return np.zeros((0, seq_len, n_features), dtype=np.float32), np.zeros((0, horizon), dtype=np.float32)
    return np.concatenate(X_all), np.concatenate(y_all)


def export_anonymized_training_frame(db, min_days: int = 30) -> pd.DataFrame:
    """
    Builds a pooled, anonymized frame from consenting users' own data, in
    the *Personal* 11-feature schema (ml/features.py). Only users with
    `consent_share_data = true` are included (see
    supabase/migrations/002_ml_model_versioning.sql). The real user_id is
    replaced with a salted hash purely so the exported frame can never be
    joined back to `users` downstream.

    This is what feeds Tier 2 — the Global Sequence LSTM
    (ml/training/train_global_sequence.py) — since it's the only honest
    source for a sequence model in the calendar-aware 11-feature schema
    (no public dataset has both calendar data and PC/phone typing behavior
    together). Requires MIN_USERS consenting users with MIN_DAYS_PER_USER+
    days each before Tier 2 will actually train — see that file.
    """
    import hashlib

    users = (
        db.table("users")
        .select("id,created_at")
        .eq("consent_share_data", True)
        .execute()
    ).data or []

    frames = []
    for u in users:
        uid = u["id"]
        end = date.today() - timedelta(days=1)
        start = end - timedelta(days=min_days + SEQUENCE_LENGTH_DAYS + FORECAST_HORIZON_DAYS)
        df = fetch_daily_rows_for_user(db, uid, start, end)
        if len(df) < min_days:
            continue
        df = finalize_daily_frame(df)
        df = attach_labels(df)
        df["series_id"] = hashlib.sha256(f"stresstwin-salt:{uid}".encode()).hexdigest()[:16]
        frames.append(df)

    if not frames:
        return pd.DataFrame(columns=list(DAILY_SEQUENCE_FEATURE_NAMES) + ["label_risk", "series_id", "date"])
    return pd.concat(frames, ignore_index=True)

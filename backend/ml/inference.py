"""
Inference Service
==================
The ONLY module that runs a model forward pass at request time. Everything
here is read-only with respect to model weights — training/fine-tuning
happens exclusively in ml/training/*.py, invoked by the scheduler or an
offline `scripts/train_global.py` job, never from an API request path.

Two entry points:

  score_window(uid, feats, db)  -> IFScoreResult
      Personal Isolation Forest. Falls back to a deterministic baseline
      heuristic (not a "model", just a bounded L2-norm score) if the user
      has no trained IF yet.

  forecast(uid, db)             -> ForecastPrediction
      3-day risk forecast, resolved through four rungs, each one real
      (never invented) given what data currently exists for this user:

        1. 'personal' — the user's own Personal LSTM (ml/features.py's
           11-feature schema), fed their own real 14-day sequence. Best
           available; requires 28+ days of history (ml/training/train_personal.py).
        2. 'global_sequence' (Tier 2) — the shared Global Sequence LSTM,
           same 11-feature schema, trained on pooled anonymized real
           StressTwin data. Only exists once enough users have opted in
           (ml/training/train_global_sequence.py) — until then this rung
           is simply unavailable and falls through.
        3. 'global_baseline' (Tier 1) — the Global Behavioral Baseline
           (ml/models/global_baseline.py, trained on StudentLife's
           app-usage + calendar data only) scores the user's OWN real
           daily-aggregated app-switching and calendar-load data.
           Available from literally the first day a user has any
           behavioral windows or calendar sync at all — nothing here is
           invented, it's real data run through a population-trained
           scorer. This is a same-day score, not a sequence forecast, so
           it's used as a flat 3-day persistence estimate.
        4. 'global_prior' (Tier 0) — a population weekday prior (a genuine
           statistic from StudentLife's daily Stress EMA, not a model),
           used only when a user has zero behavioral windows and zero
           calendar data yet.

      Returns model_ready=False (never raises) only if none of the four
      rungs have anything to offer — practically, this only happens before
      Tier 0 has ever been trained/published at all.
"""
from __future__ import annotations
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from typing import Optional

import numpy as np
import torch

from ml.features import RAW_WINDOW_FEATURE_NAMES, raw_window_vector, FORECAST_HORIZON_DAYS
from ml.features_global import WINDOW_FEATURE_NAMES
from ml.model_manager import ModelManager
from ml.models.global_baseline import daily_aggregate_to_window_vector
from ml.models.lstm import load_from_state_dict
from ml.training.dataset import build_live_sequence
import pandas as pd


@dataclass
class IFScoreResult:
    deviation_score: float
    model_ready: bool
    model_version: Optional[int] = None


@dataclass
class ForecastPrediction:
    model_ready: bool
    risks: list[float] = field(default_factory=list)     # length FORECAST_HORIZON_DAYS
    source: str = "none"          # 'personal' | 'global_sequence' | 'global_baseline' | 'global_prior' | 'none'
    model_version: Optional[int] = None
    validation_metrics: dict = field(default_factory=dict)


def _baseline_score(vec: np.ndarray) -> float:
    """Deterministic fallback while a user's IF hasn't trained yet."""
    return float(np.clip(np.linalg.norm(vec) * 3, 0, 60))


def score_window(uid: str, feats: dict, window_start, db, manager: Optional[ModelManager] = None) -> IFScoreResult:
    """
    `feats` is a plain dict of the 14 raw behavioral fields (whatever
    BehavioralFeatures.model_dump() produces is fine — extra keys are
    ignored). `window_start` is a datetime.
    """
    manager = manager or ModelManager(db)
    vec = raw_window_vector(feats, window_start)

    model, version_row = manager.load_isolation_forest(uid)
    if model is None:
        return IFScoreResult(deviation_score=_baseline_score(vec), model_ready=False)

    score = model.score(vec)
    return IFScoreResult(
        deviation_score=score,
        model_ready=True,
        model_version=version_row["version"] if version_row else None,
    )


# ── Rung 1: Personal LSTM ────────────────────────────────────────────────────
def _personal_forecast(uid: str, db, manager: ModelManager) -> Optional[ForecastPrediction]:
    state_dict, version_row = manager.load_lstm_state("personal_lstm", uid)
    if state_dict is None:
        return None

    sequence = build_live_sequence(db, uid)  # 11-dim Personal schema, unchanged
    if sequence is None:
        return None

    model = load_from_state_dict(state_dict)  # default input_size=11
    with torch.no_grad():
        inp = torch.tensor(sequence, dtype=torch.float32).unsqueeze(0)
        out = model(inp).squeeze(0).tolist()
    if isinstance(out, float):
        out = [out]

    return ForecastPrediction(
        model_ready=True,
        risks=[float(np.clip(r, 0, 1)) for r in out],
        source="personal",
        model_version=version_row["version"] if version_row else None,
        validation_metrics=(version_row or {}).get("validation_metrics", {}) or {},
    )


# ── Rung 2: Global Sequence LSTM (Tier 2) ───────────────────────────────────
def _global_sequence_forecast(uid: str, db, manager: ModelManager) -> Optional[ForecastPrediction]:
    state_dict, version_row = manager.load_lstm_state("global_lstm")
    if state_dict is None:
        return None  # Tier 2 hasn't been trained yet — see ml/training/train_global_sequence.py

    sequence = build_live_sequence(db, uid)  # same 11-dim schema as Personal
    if sequence is None:
        return None

    model = load_from_state_dict(state_dict)
    with torch.no_grad():
        inp = torch.tensor(sequence, dtype=torch.float32).unsqueeze(0)
        out = model(inp).squeeze(0).tolist()
    if isinstance(out, float):
        out = [out]

    return ForecastPrediction(
        model_ready=True,
        risks=[float(np.clip(r, 0, 1)) for r in out],
        source="global_sequence",
        model_version=version_row["version"] if version_row else None,
        validation_metrics=(version_row or {}).get("validation_metrics", {}) or {},
    )


# ── Rung 3: Global Behavioral Baseline (Tier 1) ─────────────────────────────
def _recent_behavioral_aggregate(db, uid: str, hours: int = 24) -> Optional[dict]:
    """
    Builds today's real aggregate for the user, mapped onto
    ml.features_global.WINDOW_FEATURE_NAMES — 2 fields from their own
    behavioral_logs (app_switch_rate, active_hours_norm) and 4 from their
    own calendar_events row for today (already computed the same way as
    Personal's calendar features — see
    ml/training/dataset.py::build_daily_row). Returns None only if the
    user has neither behavioral windows nor a calendar row for today
    (nothing at all to score yet).
    """
    since = (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()
    logs = (
        db.table("behavioral_logs")
        .select("app_switch_rate,session_duration,window_start")
        .eq("user_id", uid)
        .gte("window_start", since)
        .execute()
    ).data or []

    today = date.today().isoformat()
    cal_rows = (
        db.table("calendar_events")
        .select("meeting_density,earliest_start_norm,consecutive_loaded_days,days_to_next_free")
        .eq("user_id", uid)
        .eq("event_date", today)
        .execute()
    ).data or []
    cal = cal_rows[0] if cal_rows else None

    if not logs and cal is None:
        return None

    def _mean(key, default=0.0):
        vals = [r[key] for r in logs if r.get(key) is not None]
        return float(np.mean(vals)) if vals else default

    # Match StudentLife Tier 1's active_hours_norm definition:
    # elapsed span from the first to last observed behavioral timestamp,
    # normalized by 24 hours. Do not estimate active time by summing session
    # durations because that would be a different feature distribution.
    if logs:
        timestamps = pd.to_datetime(
            [r.get("window_start") for r in logs if r.get("window_start")],
            utc=True,
            errors="coerce",
        ).dropna()

        if len(timestamps) >= 2:
            span_seconds = max(
                (timestamps.max() - timestamps.min()).total_seconds(),
                0.0,
            )
            active_hours_norm = min(span_seconds / 86400.0, 1.0)
        else:
            active_hours_norm = 0.0
    else:
        active_hours_norm = 0.0

    # calendar_events stores raw counts (not yet normalized) — apply the
    # exact same transform ml.training.dataset.build_daily_row uses for
    # Personal's calendar features, so Tier 1 and Personal read the same
    # underlying data identically.
    return {
        "app_switch_rate": _mean("app_switch_rate"),
        "active_hours_norm": active_hours_norm,

        # Never invent calendar values when no calendar row exists.
        # daily_aggregate_to_window_vector() converts these None values
        # to NaN so the trained model's imputer handles the missing data.
        "calendar_meeting_density": (
            min(float(cal.get("meeting_density") or 0) / 10, 1.0)
            if cal is not None
            else None
        ),
        "calendar_earliest_start": (
            float(cal["earliest_start_norm"])
            if cal is not None and cal.get("earliest_start_norm") is not None
            else None
        ),
        "calendar_consecutive_loaded_days": (
            min(float(cal.get("consecutive_loaded_days") or 0) / 7, 1.0)
            if cal is not None
            else None
        ),
        "calendar_days_to_next_free": (
            1.0 - min(float(cal.get("days_to_next_free") or 0) / 7, 1.0)
            if cal is not None
            else None
        ),
    }


def _global_baseline_forecast(uid: str, db, manager: ModelManager) -> Optional[ForecastPrediction]:
    model, version_row = manager.load_global_baseline()
    if model is None:
        return None  # Tier 1 hasn't been trained yet — see ml/training/train_global_baseline.py

    agg = _recent_behavioral_aggregate(db, uid)
    if agg is None:
        return None  # user has zero behavioral windows yet — falls through to Tier 0

    vec = daily_aggregate_to_window_vector(agg)
    today_risk = model.score(vec)  # real data, population-trained scorer — nothing invented

    # This is a same-day score, not a sequence model, so day2/day3 are a flat
    # persistence estimate with mild reversion toward neutral (0.5) — an
    # honest way to say "we only really know about today" rather than
    # pretending days 2-3 are independently forecast.
    risks = [today_risk, today_risk * 0.85 + 0.5 * 0.15, today_risk * 0.7 + 0.5 * 0.3]

    return ForecastPrediction(
        model_ready=True,
        risks=[float(np.clip(r, 0, 1)) for r in risks],
        source="global_baseline",
        model_version=version_row["version"] if version_row else None,
        validation_metrics=(version_row or {}).get("validation_metrics", {}) or {},
    )


# ── Rung 4: Population weekday prior (Tier 0) ───────────────────────────────
def _global_prior_forecast(manager: ModelManager) -> Optional[ForecastPrediction]:
    prior, version_row = manager.get_global_prior()
    if not prior:
        return None

    today = date.today()
    risks = [float(prior.get(str((today + timedelta(days=i + 1)).weekday()), 0.5))
             for i in range(FORECAST_HORIZON_DAYS)]

    return ForecastPrediction(
        model_ready=True,
        risks=risks,
        source="global_prior",
        model_version=version_row["version"] if version_row else None,
        validation_metrics=(version_row or {}).get("validation_metrics", {}) or {},
    )


def forecast(uid: str, db, manager: Optional[ModelManager] = None) -> ForecastPrediction:
    manager = manager or ModelManager(db)

    status = manager.get_user_model_status(uid)
    mode = (status or {}).get("lstm_mode", "global")

    if mode == "personal":
        result = _personal_forecast(uid, db, manager)
        if result is not None:
            return result
        # Personal row missing/evicted or sequence incomplete — fall through.

    for rung in (_global_sequence_forecast, _global_baseline_forecast):
        result = rung(uid, db, manager)
        if result is not None:
            return result

    result = _global_prior_forecast(manager)
    if result is not None:
        return result

    return ForecastPrediction(model_ready=False, source="none")

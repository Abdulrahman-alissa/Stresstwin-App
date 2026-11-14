"""
Shared feature schema
======================
Single source of truth for the two feature vectors used across the project,
so the Isolation Forest, the LSTM, the dataset builders, and the inference
service can never silently drift apart.

1. RAW_WINDOW_FEATURES (14-dim)  — one 15s behavioral collection window.
   Consumed directly by the personal Isolation Forest.

2. DAILY_SEQUENCE_FEATURES (11-dim) — one calendar day, aggregated from
   many raw windows + calendar sync + IF deviation scores. Consumed by the
   LSTM as one timestep of a 14-day sequence.
"""
from __future__ import annotations
import numpy as np
from datetime import datetime

# ── 1. Raw 15s behavioral window → 14-dim vector (Isolation Forest input) ─────
RAW_WINDOW_FEATURE_NAMES = [
    "keystroke_mean",
    "keystroke_std",
    "error_rate",
    "mouse_velocity",
    "mouse_smoothness",
    "click_hesitation",
    "touch_pressure",
    "gyro_variance",
    "idle_frequency",
    "app_switch_rate",
    "session_duration_norm",
    "hour_sin",
    "hour_cos",
    "is_weekend",
]


def raw_window_vector(row: dict, window_start: datetime) -> np.ndarray:
    """
    Build the 14-dim raw-window feature vector from a behavioral_logs row
    (or an equivalent dict, e.g. a live BehavioralFeatures.model_dump()).
    `row` values are expected in their natural units; this function performs
    all normalization so every caller (training + inference) does it once,
    identically.
    """
    hour = window_start.hour
    is_weekend = int(window_start.weekday() >= 5)
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
        float(np.sin(2 * np.pi * hour / 24)),
        float(np.cos(2 * np.pi * hour / 24)),
        float(is_weekend),
    ]
    return np.array(vec, dtype=np.float32)


# ── 2. One aggregated day → 11-dim vector (LSTM sequence timestep) ───────────
DAILY_SEQUENCE_FEATURE_NAMES = [
    "if_deviation_mean",       # mean IF score that day, /100
    "if_deviation_std",        # std of IF score that day, /100
    "mood_risk",               # inverted, normalized mood check-in (0=calm,1=stressed)
    "error_rate_mean",         # mean behavioral error rate that day
    "active_hours_norm",       # total active/session seconds, normalized by 8h
    "calendar_exam_flag",      # 0/1
    "calendar_meeting_density",# meetings/day, /10 clipped
    "calendar_earliest_start", # normalized time-of-day of first event
    "calendar_committed_hours",# committed hours /8 clipped
    "calendar_consecutive_loaded_days",  # /7 clipped
    "calendar_days_to_next_free",        # inverted + /7 clipped
]

SEQUENCE_LENGTH_DAYS = 14   # LSTM input window
FORECAST_HORIZON_DAYS = 3   # LSTM output horizon

# Personal-baseline (Isolation Forest) cold-start thresholds
IF_MIN_DAYS = 7
IF_MIN_SAMPLES = 100
IF_RETRAIN_INTERVAL_DAYS = 7

# LSTM cold-start / personalization thresholds
LSTM_GLOBAL_FALLBACK_MIN_DAYS = 0        # global model works from day 1
LSTM_PERSONALIZATION_MIN_DAYS = 28       # days of behavioral data required
LSTM_PERSONALIZATION_MIN_CHECKINS = 20   # mood check-ins required
LSTM_PERSONALIZATION_MIN_SEQUENCES = 10  # distinct 14-day training windows
LSTM_RETRAIN_INTERVAL_DAYS = 14
LSTM_PERSONAL_MAX_VAL_MSE = 0.12         # promote a personal retrain only if it validates this well

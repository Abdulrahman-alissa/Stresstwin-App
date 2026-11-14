"""
Global training feature schema (v4 — StudentLife-only, daily Stress EMA label)
==================================================================================
SWELL-KW and MobileStress have been dropped per an explicit decision to
use only StudentLife for global training. Tier 1 is built around what's
ACTUALLY derivable from the StudentLife files being used — app usage
(`running_app_u*.csv`) and calendar (`calendar_u*.csv`) — filtered through
the same rule as before: a Global-training feature is only usable if
StressTwin's own collector can produce the same thing for a live user.

See GLOBAL_DATASET_STRATEGY.md for the full column-by-column mapping table
(StudentLife column → derived feature → StressTwin feature → keep/remove →
reason) and ML_TRAINING.md for how to run the pipeline.

  TIER 1 — Global Behavioral Baseline (this file's WINDOW_FEATURE_NAMES)
    Trained on StudentLife app-usage data ONLY (no SWELL-KW,
    no MobileStress). Every feature below is intended to be derivable from StressTwin's own
    live behavioral data.
    Runs on a live user's REAL data from day 1. Label is now the daily
    "Stress" EMA (see STRESS_EMA_CODEBOOK below), giving one training row
    PER PARTICIPANT-DAY rather than one per participant — a real upgrade
    over the PSS-10-only design (PSS-10 is only administered twice per
    participant, which capped Tier 1 at ~40-50 rows total).

  TIER 0 — Population weekday prior
    Also built from the daily "Stress" EMA (a plain statistic — mean
    self-reported risk by day-of-week — not a model). Because the EMA is
    answered many times across many days per participant, this is a real
    weekday-conditioned prior again, not the flat fallback the PSS-10-only
    version had to use. Absolute last-resort fallback for a user with zero
    behavioral windows and zero calendar data yet.

  TIER 2 — Global Sequence LSTM (unchanged)
    Uses ml.features.DAILY_SEQUENCE_FEATURE_NAMES directly (the Personal
    LSTM's own 11-feature schema), trained on pooled, anonymized,
    consenting StressTwin users' own real sequences — StudentLife plays no
    role here, same as before.
"""
from __future__ import annotations

# ── Tier 1: Global Behavioral Baseline — daily-aggregate level ──────────────
# Every feature here is derived ONLY from StudentLife's running_app_u*.csv
# (app usage) and calendar_u*.csv (calendar) — see
# ml/training/prepare_studentlife.py for the exact derivation, and
# GLOBAL_DATASET_STRATEGY.md for the full column mapping table. No mouse,
# keyboard-timing, or motion features remain: StudentLife's raw files used
# here don't contain any (that data lived in SWELL-KW/MobileStress, which
# are no longer used), so keeping those field names would mean training on
# columns that are 100% NaN for the only source left. Better to have an
# honest, smaller schema than a padded one.
WINDOW_FEATURE_NAMES = [
    "app_switch_rate",
    "active_hours_norm",
    "calendar_meeting_density",
    "calendar_earliest_start",
    "calendar_consecutive_loaded_days",
    "calendar_days_to_next_free",
]
WINDOW_INPUT_SIZE = len(WINDOW_FEATURE_NAMES)  # 6

# Dropped from the v2 (SWELL-KW/MobileStress) schema, and why: typing_rhythm_var,
# error_rate, mouse_velocity, mouse_smoothness, motion_variance,
# session_duration_norm — none of these are derivable from StudentLife's
# running_app or calendar files (no keystroke, mouse, or accelerometer data
# in either). They are NOT approximated or substituted; they're simply
# absent from this tier's schema now. A live StressTwin user's Isolation
# Forest still uses the full 14-feature raw schema (ml/features.py) — this
# reduced 6-feature list is Tier 1-specific only.

# Single source now (StudentLife only) — SOURCE_AVAILABILITY from the v2
# multi-dataset design is retired; every WINDOW_FEATURE_NAMES column is
# populated for every StudentLife-derived row (no per-source NaN gaps to
# track), since app-usage and calendar data are both available for any
# participant-day that has running_app/calendar rows at all.

# Label for Tier 1 (and Tier 0) training: probability of "stressed" in
# [0, 1]. PRIMARY source is the daily "Stress" EMA — see STRESS_CODEBOOK
# below and ml/training/prepare_studentlife.py::extract_stress_ema_daily.
# It's answered many times per participant (dozens, not twice), so it
# supports genuine per-day rows and a real weekday prior — unlike PSS-10
# (kept only as a secondary, printed-not-trained-on sanity check; see
# ml/training/prepare_studentlife.py::report_pss_correlation). The
# individual EMA/PSS answers are NEVER used as input features, only the
# resulting score, and only as the label.
WINDOW_LABEL_COLUMN = "label_stress"

# Stress EMA response code -> stress intensity in [0, 1]. VERIFIED against
# EMA_definition.json's actual "Stress" question options — the 5 choices
# are NOT already ordered from calm to stressed: "[1] A little stressed,
# [2] Definitely stressed, [3] Stressed out, [4] Feeling good, [5] Feeling
# great" — 1-3 are increasing stress intensity, 4-5 are positive states
# (5 more positive than 4). This mapping reflects that ordering; do not
# treat the raw 1-5 code as a linear stress scale.
STRESS_EMA_CODEBOOK = {
    1: 0.4,   # "A little stressed"
    2: 0.7,   # "Definitely stressed"
    3: 1.0,   # "Stressed out"
    4: 0.2,   # "Feeling good"
    5: 0.0,   # "Feeling great"
}
# Mean daily Stress-EMA risk (after STRESS_EMA_CODEBOOK mapping, averaged
# over that day's responses) >= this value is treated as "stressed" (1)
# for the binary Tier 1 label. 0.5 cleanly separates {1,4,5} (0.4/0.2/0.0
# — "a little stressed" through "feeling great") from {2,3} (0.7/1.0 —
# "definitely stressed" / "stressed out").
STRESS_EMA_RISK_THRESHOLD = 0.5

# PSS-10 total score (0-40) >= this value is treated as "stressed" (1).
# 14 is the commonly cited boundary between "low" and "moderate-or-higher"
# perceived stress in the PSS-10 literature. Used only for the secondary
# per-participant correlation check (report_pss_correlation), not to train
# either tier — see the module docstring.
PSS_STRESS_THRESHOLD = 14
PSS_MAX_SCORE = 40

# Other StudentLife EMA surveys considered and NOT used — see
# GLOBAL_DATASET_STRATEGY.md for the full reasoning:
#   "Dartmouth now" — reaction to one specific campus event, not general
#                      stress; would bake a one-time confound into a
#                      "global" model.
#   "Mood 1"         — asks the participant to PREDICT tomorrow's mood;
#                      using a self-prediction as ground truth for a model
#                      that predicts near-future mood would be circular.
#   "Mood 2"         — single mutually-exclusive categorical pick
#                      (happy/stressed/tired), not an intensity scale;
#                      not comparable to STRESS_EMA_CODEBOOK's ordering.
#   "Mood"           — not part of the EMA_definition.json schema supplied
#                      (no question text/options available to interpret
#                      "happy"/"sad"/"happyornot"/"sadornot" correctly);
#                      excluded rather than guessed at.

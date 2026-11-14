"""
Global Behavioral Baseline (Tier 1)
=====================================
A population-trained "does this behavior look stressed" scorer, trained
ONLY on StudentLife's app-usage + calendar data (ml/features_global.py's
6-dim WINDOW_FEATURE_NAMES) — SWELL-KW and MobileStress are not used
anywhere in this pipeline (explicit decision). Deliberately a simple,
well-calibrated classifier rather than a deep model. Trained on one row
per (participant, day) — many days per participant — labeled from that
day's mean "Stress" EMA response (STRESS_EMA_CODEBOOK,
ml/features_global.py), not the sparser PSS-10 survey (kept only as a
secondary printed correlation check — see
ml/training/prepare_studentlife.py::report_pss_correlation).

Role in the pipeline: this is the thing that makes a NEW StressTwin user's
cold-start experience real instead of a population lookup table. From the
very first day a user has behavioral windows and/or calendar data at all,
their own daily aggregate can be scored by this model — no invented data,
because StressTwin's collector already produces every field this model
needs (app-switch behavior from the keyboard extension's active-app
signal, calendar-derived load features already computed for Personal
users).

This is intentionally structured like ml/models/isolation_forest.py (same
(de)serialization pattern) since it plays an analogous role — a behavioral
anomaly/deviation scorer — just trained on population data instead of one
user's own history.
"""
from __future__ import annotations
import io
from datetime import datetime, timezone
from typing import Optional

import joblib
import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler
from sklearn.impute import SimpleImputer
from sklearn.pipeline import Pipeline

from ml.features_global import WINDOW_FEATURE_NAMES


class GlobalBehavioralBaseline:
    """Wraps median imputation + standardization + LogisticRegression.

    The model is intentionally simple: validation on StudentLife showed that
    the six behavioral/calendar features provide a modest population-level
    signal, while a simpler linear model was more stable than GradientBoosting.
    """

    def __init__(self, random_state: int = 42):
        self.pipeline = Pipeline([
            ("impute", SimpleImputer(strategy="median")),
            ("scale", StandardScaler()),
            ("clf", LogisticRegression(
                max_iter=2000,
                random_state=random_state,
            )),
        ])
        self.trained_at: Optional[str] = None
        self.n_samples_trained_on: int = 0
        self.source_counts: dict = {}

    def fit(self, X: np.ndarray, y: np.ndarray, source_counts: Optional[dict] = None) -> "GlobalBehavioralBaseline":
        self.pipeline.fit(X, y)
        self.trained_at = datetime.now(timezone.utc).isoformat()
        self.n_samples_trained_on = int(X.shape[0])
        self.source_counts = source_counts or {}
        return self

    def score(self, vec: np.ndarray) -> float:
        """Returns P(stressed) in [0, 1].

        Missing calendar values may be NaN and are handled by the fitted
        median imputer rather than being replaced with invented defaults.
        """
        proba = self.pipeline.predict_proba(vec.reshape(1, -1))[0]
        # class order follows fit(); locate the "1" (stressed) column defensively
        classes = list(self.pipeline.named_steps["clf"].classes_)
        idx = classes.index(1) if 1 in classes else -1
        return float(np.clip(proba[idx], 0, 1))

    def to_bytes(self) -> bytes:
        buf = io.BytesIO()
        joblib.dump(self, buf)
        return buf.getvalue()

    @classmethod
    def from_bytes(cls, data: bytes) -> "GlobalBehavioralBaseline":
        return joblib.load(io.BytesIO(data))


def daily_aggregate_to_window_vector(daily_row: dict) -> np.ndarray:
    """
    Maps one day's worth of a StressTwin user's REAL aggregated behavioral
    + calendar data onto the 6-dim WINDOW_FEATURE_NAMES vector this model
    expects. Used at inference time (ml/inference.py) — every field here
    comes from real behavioral_logs / calendar_events rows for that
    user/day, never invented.
    """
    calendar_keys = [
        "calendar_meeting_density",
        "calendar_earliest_start",
        "calendar_consecutive_loaded_days",
        "calendar_days_to_next_free",
    ]

    def get_calendar_value(key: str) -> float:
        value = daily_row.get(key)
        if value is None:
            return float("nan")
        try:
            value = float(value)
        except (TypeError, ValueError):
            return float("nan")
        return value if np.isfinite(value) else float("nan")

    return np.array([
        float(daily_row.get("app_switch_rate", 0.0) or 0.0),
        float(daily_row.get("active_hours_norm", 0.0) or 0.0),
        *[get_calendar_value(key) for key in calendar_keys],
    ], dtype=np.float32)

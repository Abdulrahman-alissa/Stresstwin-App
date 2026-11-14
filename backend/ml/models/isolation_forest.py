"""
Personal Isolation Forest
=========================
Each user gets their own IsolationForest fit purely on *their own* raw
15s behavioral windows. This is the always-on, per-user anomaly detector
that runs on every submitted window (ml/inference.py calls `score()` here).

Nothing here ever sees another user's data — this file has no notion of
the global LSTM. Training is triggered by ml/training/train_personal.py
(cold start after 7 days, periodic retrain after that).
"""
from __future__ import annotations
import io
from datetime import datetime, timedelta, timezone
from typing import Optional

import joblib
import numpy as np
from sklearn.ensemble import IsolationForest

from ml.features import (
    RAW_WINDOW_FEATURE_NAMES,
    raw_window_vector,
    IF_MIN_DAYS,
    IF_MIN_SAMPLES,
)


class PersonalIsolationForest:
    """Thin, serializable wrapper around sklearn's IsolationForest."""

    def __init__(self, contamination: float = 0.1, n_estimators: int = 100, random_state: int = 42):
        self.contamination = contamination
        self.n_estimators = n_estimators
        self.random_state = random_state
        self.clf: Optional[IsolationForest] = None
        self.trained_at: Optional[str] = None
        self.n_samples_trained_on: int = 0

    def fit(self, X: np.ndarray) -> "PersonalIsolationForest":
        self.clf = IsolationForest(
            contamination=self.contamination,
            n_estimators=self.n_estimators,
            random_state=self.random_state,
        )
        self.clf.fit(X)
        self.trained_at = datetime.now(timezone.utc).isoformat()
        self.n_samples_trained_on = int(X.shape[0])
        return self

    def score(self, vec: np.ndarray) -> float:
        """
        Returns a 0-100 deviation score (higher = more anomalous relative
        to this user's own historical baseline).
        """
        if self.clf is None:
            raise RuntimeError("PersonalIsolationForest.score() called before fit()")
        raw = self.clf.decision_function(vec.reshape(1, -1))[0]  # negative = anomalous
        return float(np.clip((-raw + 0.5) * 100, 0, 100))

    # ── (de)serialization for ModelManager ──────────────────────────────────
    def to_bytes(self) -> bytes:
        buf = io.BytesIO()
        joblib.dump(self, buf)
        return buf.getvalue()

    @classmethod
    def from_bytes(cls, data: bytes) -> "PersonalIsolationForest":
        return joblib.load(io.BytesIO(data))


def build_training_matrix(behavioral_log_rows: list[dict]) -> np.ndarray:
    """
    behavioral_log_rows: rows from `behavioral_logs` (dicts with the raw
    15s-window fields + `window_start` ISO string).
    """
    matrix = []
    for row in behavioral_log_rows:
        try:
            dt = datetime.fromisoformat(row["window_start"].replace("Z", "+00:00"))
        except Exception:
            dt = datetime.now(timezone.utc)
        matrix.append(raw_window_vector(row, dt))
    return np.array(matrix, dtype=np.float32) if matrix else np.zeros((0, len(RAW_WINDOW_FEATURE_NAMES)))


def has_enough_data_for_cold_start(behavioral_log_rows: list[dict], first_log_at: Optional[datetime]) -> bool:
    if len(behavioral_log_rows) < IF_MIN_SAMPLES:
        return False
    if first_log_at is None:
        return False
    days_elapsed = (datetime.now(timezone.utc) - first_log_at).days
    return days_elapsed >= IF_MIN_DAYS


def train_personal_isolation_forest(behavioral_log_rows: list[dict]) -> Optional[PersonalIsolationForest]:
    """
    Pure function: rows in, fitted model out (or None if insufficient data).
    DB reads/writes and versioning live in ml/training/train_personal.py and
    ml/model_manager.py — this file only knows about numpy + sklearn.
    """
    X = build_training_matrix(behavioral_log_rows)
    if X.shape[0] < IF_MIN_SAMPLES:
        return None
    model = PersonalIsolationForest()
    model.fit(X)
    return model

"""
Per-user personalization
=========================
Two independent jobs, both triggered periodically (scheduler_tasks.py) or
on-demand (e.g. right after a user crosses a data threshold):

1. `retrain_personal_isolation_forest(uid, db, manager)`
   Cold start after IF_MIN_DAYS days / IF_MIN_SAMPLES windows, then
   periodic retrain — unchanged behavior from the original single-model
   design, just re-homed under ml/ and version-tracked.

2. `personalize_user_lstm(uid, db, manager)`
   Once a user has enough of their own daily history
   (LSTM_PERSONALIZATION_MIN_*), trains a Personal LSTM **from scratch** on
   that user's own 14-day sequences, using the Personal LSTM's 11-feature
   schema (ml/features.py — completely unchanged; nothing here reads or
   depends on Tier 1 (ml/models/global_baseline.py), which uses an
   unrelated 7-feature window-level schema, ml/features_global.py). It's
   promoted to `personal_lstm` (switching `user_model_status.lstm_mode` to
   "personal") only if it validates below LSTM_PERSONAL_MAX_VAL_MSE on a
   held-out slice of the user's own data. Otherwise the user stays on
   whichever global rung was serving them (see ml/inference.py) and
   personalization is simply retried on the next scheduled cycle once more
   data has accrued.

   NOTE: this trains from scratch rather than fine-tuning from a shared
   checkpoint. Tier 2 (ml/training/train_global_sequence.py) DOES use the
   same 11-feature schema as Personal now, so warm-starting from the
   active Tier 2 checkpoint instead of from scratch is a legitimate future
   optimization — just not implemented yet, since Tier 2 itself isn't
   available until enough users have opted in (see ML_TRAINING.md).
"""
from __future__ import annotations
from datetime import datetime, timedelta, timezone
from typing import Optional

import numpy as np
import torch
import torch.nn as nn
from sklearn.model_selection import train_test_split

from ml.features import (
    IF_MIN_DAYS,
    IF_MIN_SAMPLES,
    LSTM_PERSONALIZATION_MIN_DAYS,
    LSTM_PERSONALIZATION_MIN_CHECKINS,
    LSTM_PERSONALIZATION_MIN_SEQUENCES,
    LSTM_PERSONAL_MAX_VAL_MSE,
)
from ml.models.isolation_forest import train_personal_isolation_forest, PersonalIsolationForest
from ml.models.lstm import StressLSTM
from ml.training.dataset import build_user_training_set
from ml.model_manager import ModelManager


# ── 1. Isolation Forest ──────────────────────────────────────────────────────
def retrain_personal_isolation_forest(uid: str, db, manager: Optional[ModelManager] = None) -> bool:
    manager = manager or ModelManager(db)

    since = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
    logs = (
        db.table("behavioral_logs")
        .select("*")
        .eq("user_id", uid)
        .gte("window_start", since)
        .execute()
    ).data or []

    if len(logs) < IF_MIN_SAMPLES:
        return False

    first_log = (
        db.table("behavioral_logs")
        .select("window_start")
        .eq("user_id", uid)
        .order("window_start")
        .limit(1)
        .execute()
    ).data
    if not first_log:
        return False
    first_at = datetime.fromisoformat(first_log[0]["window_start"].replace("Z", "+00:00"))
    if (datetime.now(timezone.utc) - first_at).days < IF_MIN_DAYS:
        return False

    model = train_personal_isolation_forest(logs)
    if model is None:
        return False

    manager.save_isolation_forest(uid, model, training_samples=model.n_samples_trained_on)
    print(f"  IF model retrained for user {uid} on {model.n_samples_trained_on} samples")
    return True


# ── 2. LSTM personalization (trained from scratch, Personal schema only) ────
def is_eligible_for_personalization(uid: str, db) -> bool:
    logs = db.table("behavioral_logs").select("window_start").eq("user_id", uid).execute().data or []
    days = len({r["window_start"][:10] for r in logs})
    checkins = db.table("mood_checkins").select("id", count="exact").eq("user_id", uid).execute().count or 0
    return days >= LSTM_PERSONALIZATION_MIN_DAYS and checkins >= LSTM_PERSONALIZATION_MIN_CHECKINS


def _train_personal_from_scratch(X: np.ndarray, y: np.ndarray, epochs: int = 40, lr: float = 1e-3):
    """
    Plain from-scratch training of the (unchanged, 11-feature) Personal
    LSTM architecture on one user's own sequences. Small datasets (10-40
    sequences is typical at first personalization) mean full-batch-ish
    training with a modest epoch count works better here than the
    early-stopping loop used for the much larger Global training run.
    """
    model = StressLSTM()  # default input_size=11 (ml/features.py) — unchanged
    optimizer = torch.optim.Adam(model.parameters(), lr=lr)
    criterion = nn.BCELoss()

    X_train, X_val, y_train, y_val = train_test_split(X, y, test_size=0.3, random_state=42)
    train_ds = torch.utils.data.TensorDataset(
        torch.tensor(X_train, dtype=torch.float32), torch.tensor(y_train, dtype=torch.float32)
    )
    loader = torch.utils.data.DataLoader(train_ds, batch_size=min(8, len(train_ds)), shuffle=True)

    model.train()
    for _ in range(epochs):
        for xb, yb in loader:
            optimizer.zero_grad()
            loss = criterion(model(xb), yb)
            loss.backward()
            optimizer.step()

    model.eval()
    with torch.no_grad():
        xb_val = torch.tensor(X_val, dtype=torch.float32)
        yb_val = torch.tensor(y_val, dtype=torch.float32)
        pred = model(xb_val)
        val_mse = float(nn.functional.mse_loss(pred, yb_val).item())
        val_mae = float(nn.functional.l1_loss(pred, yb_val).item())

    return model, {"val_mse": round(val_mse, 5), "val_mae": round(val_mae, 5), "n_val_sequences": len(X_val)}


def personalize_user_lstm(uid: str, db, manager: Optional[ModelManager] = None) -> bool:
    """
    Returns True if a new personal_lstm version was activated for this user.
    Safe to call frequently — it's a no-op until the user has enough data,
    and never promotes a retrain that doesn't validate below
    LSTM_PERSONAL_MAX_VAL_MSE (a fixed sanity bar, not a comparison against
    a global model — see the module docstring for why this stays a
    from-scratch fit for now).
    """
    manager = manager or ModelManager(db)

    if not is_eligible_for_personalization(uid, db):
        return False

    X, y = build_user_training_set(db, uid)  # 11-feature Personal schema, unchanged
    if X.shape[0] < LSTM_PERSONALIZATION_MIN_SEQUENCES:
        return False

    model, metrics = _train_personal_from_scratch(X, y)

    if metrics["val_mse"] > LSTM_PERSONAL_MAX_VAL_MSE:
        print(f"  personalization for {uid} did not validate well enough "
              f"(val_mse={metrics['val_mse']} > {LSTM_PERSONAL_MAX_VAL_MSE}); "
              f"keeping user on the Global cold-start forecast, will retry next cycle")
        return False

    manager.save_personal_lstm(
        uid,
        model,
        training_samples=int(X.shape[0]),
        metrics=metrics,
    )
    print(f"  LSTM personalized for user {uid}: {metrics}")
    return True


def run_personal_training_for_user(uid: str, db, manager: Optional[ModelManager] = None) -> dict:
    """Convenience entry point used by the scheduler: run both jobs for one user."""
    manager = manager or ModelManager(db)
    return {
        "if_retrained": retrain_personal_isolation_forest(uid, db, manager),
        "lstm_personalized": personalize_user_lstm(uid, db, manager),
    }

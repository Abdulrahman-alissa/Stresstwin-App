"""
Tier 2 — Global Sequence LSTM training
=========================================
Trains the 3-day-ahead forecaster in the SAME 11-feature schema as the
Personal LSTM (ml/features.py::DAILY_SEQUENCE_FEATURE_NAMES — behavioral
aggregates + calendar features together). No public dataset has both
calendar data and PC/phone typing behavior in one place, so the only
honest source for a sequence model in this exact feature space is a
pooled, anonymized sample of consenting StressTwin users' own real data —
ml.training.dataset.export_anonymized_training_frame(), which already
exists and already only reads rows for users with
`consent_share_data = true`.

Practical consequence: Tier 2 is NOT available at launch. It needs enough
opted-in users with 30+ days of their own history each to form a
meaningful pool (see MIN_USERS / MIN_DAYS_PER_USER below). Until then,
ml/inference.py's forecast() falls back to Tier 1 (a same-day behavioral
score, real per-user data) or Tier 0 (the weekday prior) — see
ML_TRAINING.md for the exact fallback order and why each rung is there.

Because this uses the exact same architecture and feature space as the
Personal LSTM, a Tier 2 checkpoint CAN legitimately seed personalization
again (unlike the retired v1 design, where Global and Personal used
incompatible feature spaces) — see ml/training/train_personal.py, which
currently still trains from scratch; switching it to warm-start from the
active Tier 2 model once one exists is a natural follow-up, not required
for this pipeline to work.

Run (once you have enough consenting users):
    python -m ml.training.train_global_sequence
"""
from __future__ import annotations
import argparse
from dataclasses import dataclass, field

import numpy as np
import torch
import torch.nn as nn
from sklearn.model_selection import train_test_split

from ml.features import SEQUENCE_LENGTH_DAYS, FORECAST_HORIZON_DAYS
from ml.models.lstm import StressLSTM
from ml.training.dataset import export_anonymized_training_frame, sequences_from_prepared_frame

MIN_USERS = 15
MIN_DAYS_PER_USER = 30


@dataclass
class SequenceTrainResult:
    model: StressLSTM
    metrics: dict = field(default_factory=dict)
    n_train_sequences: int = 0
    n_val_sequences: int = 0
    n_users: int = 0


def check_readiness(db) -> tuple[bool, dict]:
    """Cheap pre-check so scripts/train_global.py --tier 2 fails fast with a
    clear message instead of training on too little data."""
    frame = export_anonymized_training_frame(db, min_days=MIN_DAYS_PER_USER)
    n_users = frame["series_id"].nunique() if len(frame) else 0
    ready = n_users >= MIN_USERS
    return ready, {"n_consenting_users_with_enough_data": n_users, "min_required": MIN_USERS}


def _validate(model: StressLSTM, X_val: np.ndarray, y_val: np.ndarray) -> dict:
    model.eval()
    with torch.no_grad():
        xb = torch.tensor(X_val, dtype=torch.float32)
        yb = torch.tensor(y_val, dtype=torch.float32)
        pred = model(xb)
        mse = float(nn.functional.mse_loss(pred, yb).item())
        mae = float(nn.functional.l1_loss(pred, yb).item())
        acc = float(((pred >= 0.5).float() == (yb >= 0.5).float()).float().mean().item())
    return {"val_mse": round(mse, 5), "val_mae": round(mae, 5), "val_accuracy_at_0.5": round(acc, 4)}


def train_global_sequence(db, epochs: int = 60, batch_size: int = 32, lr: float = 1e-3,
                           val_split: float = 0.2, seed: int = 42) -> SequenceTrainResult:
    frame = export_anonymized_training_frame(db, min_days=MIN_DAYS_PER_USER)
    n_users = frame["series_id"].nunique() if len(frame) else 0
    if n_users < MIN_USERS:
        raise ValueError(
            f"Only {n_users} consenting users have {MIN_DAYS_PER_USER}+ days of data "
            f"(need {MIN_USERS}). Tier 2 isn't ready yet — forecast() will keep using "
            f"Tier 1 / Tier 0 until it is. See ML_TRAINING.md."
        )

    X, y = sequences_from_prepared_frame(frame)  # default feature_names = Personal 11-dim schema
    torch.manual_seed(seed)
    X_train, X_val, y_train, y_val = train_test_split(X, y, test_size=val_split, random_state=seed)

    model = StressLSTM()  # default input_size=11 — same as Personal
    optimizer = torch.optim.Adam(model.parameters(), lr=lr)
    criterion = nn.BCELoss()
    loader = torch.utils.data.DataLoader(
        torch.utils.data.TensorDataset(torch.tensor(X_train, dtype=torch.float32),
                                        torch.tensor(y_train, dtype=torch.float32)),
        batch_size=batch_size, shuffle=True,
    )

    best_val_loss, best_state, patience = float("inf"), None, 8
    for epoch in range(epochs):
        model.train()
        for xb, yb in loader:
            optimizer.zero_grad()
            loss = criterion(model(xb), yb)
            loss.backward()
            optimizer.step()
        val_metrics = _validate(model, X_val, y_val)
        if (epoch + 1) % 5 == 0:
            print(f"  epoch {epoch+1}/{epochs}  val_mse={val_metrics['val_mse']:.4f}")
        if val_metrics["val_mse"] < best_val_loss:
            best_val_loss = val_metrics["val_mse"]
            best_state = {k: v.clone() for k, v in model.state_dict().items()}
            patience = 8
        else:
            patience -= 1
            if patience <= 0:
                break

    if best_state:
        model.load_state_dict(best_state)
    metrics = _validate(model, X_val, y_val)
    metrics.update({"n_train_sequences": len(X_train), "n_val_sequences": len(X_val), "n_users": n_users})

    return SequenceTrainResult(model=model, metrics=metrics, n_train_sequences=len(X_train),
                                n_val_sequences=len(X_val), n_users=n_users)


def _cli():
    import sys
    from pathlib import Path
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))
    from app.core.database import get_supabase_admin

    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--epochs", type=int, default=60)
    args = parser.parse_args()

    db = get_supabase_admin()
    ready, info = check_readiness(db)
    print("Readiness check:", info)
    if not ready:
        print("Not enough data yet — see MIN_USERS/MIN_DAYS_PER_USER at the top of this file.")
        sys.exit(1)

    result = train_global_sequence(db, epochs=args.epochs)
    print("Final metrics:", result.metrics)
    print("To publish: scripts/train_global.py --tier 2")


if __name__ == "__main__":
    _cli()

"""
StressLSTM
==========
Same architecture, same 11-feature schema (ml/features.py), used by two
independently-trained models:
  - the Personal LSTM (ml/training/train_personal.py) — trained from
    scratch on one user's own data.
  - the Tier 2 Global Sequence LSTM (ml/training/train_global_sequence.py)
    — trained offline on pooled, anonymized, consenting StressTwin users'
    own real data (same schema, so it can legitimately warm-start
    personalization later — see that file's docstring).
Not used by Tier 1 (ml/models/global_baseline.py), which is a different,
simpler model over a different 7-feature window-level schema
(ml/features_global.py) — see GLOBAL_DATASET_STRATEGY.md for why.

Input:  (batch, SEQUENCE_LENGTH_DAYS, 11)  — see ml/features.py
Output: (batch, FORECAST_HORIZON_DAYS)     — risk probability per future day
"""
from __future__ import annotations
import io
from typing import Optional

import torch
import torch.nn as nn

from ml.features import DAILY_SEQUENCE_FEATURE_NAMES, FORECAST_HORIZON_DAYS

INPUT_SIZE = len(DAILY_SEQUENCE_FEATURE_NAMES)  # 11


class StressLSTM(nn.Module):
    def __init__(
        self,
        input_size: int = INPUT_SIZE,
        hidden1: int = 128,
        hidden2: int = 64,
        output_size: int = FORECAST_HORIZON_DAYS,
        dropout: float = 0.3,
    ):
        super().__init__()
        self.input_size = input_size
        self.hidden1 = hidden1
        self.hidden2 = hidden2
        self.output_size = output_size
        self.dropout_p = dropout

        self.lstm1 = nn.LSTM(input_size, hidden1, batch_first=True)
        self.drop1 = nn.Dropout(dropout)
        self.lstm2 = nn.LSTM(hidden1, hidden2, batch_first=True)
        self.drop2 = nn.Dropout(dropout)
        self.fc = nn.Linear(hidden2, output_size)
        self.sigmoid = nn.Sigmoid()

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        out, _ = self.lstm1(x)
        out = self.drop1(out)
        out, _ = self.lstm2(out)
        out = self.drop2(out[:, -1, :])
        return self.sigmoid(self.fc(out))

    # ── (de)serialization helpers for ModelManager ──────────────────────────
    def to_bytes(self) -> bytes:
        buf = io.BytesIO()
        torch.save(self.state_dict(), buf)
        return buf.getvalue()

    @classmethod
    def from_bytes(cls, data: bytes, **kwargs) -> "StressLSTM":
        model = cls(**kwargs)
        model.load_state_dict(torch.load(io.BytesIO(data), map_location="cpu"))
        model.eval()
        return model

    def freeze_backbone(self):
        """
        Freeze the first LSTM layer, leaving only the second LSTM layer +
        output head trainable. NOTE: as of the Global/Personal feature-space
        split (ml/features_global.py), the Personal LSTM is trained from
        scratch per user rather than fine-tuned from the Global model's
        weights (their input dimensionalities differ, so weights aren't
        transferable). This method is kept available for a possible future
        "warm-start personal retrain from this same user's own previous
        personal checkpoint" optimization, but nothing calls it today.
        """
        for p in self.lstm1.parameters():
            p.requires_grad = False

    def trainable_parameters(self):
        return (p for p in self.parameters() if p.requires_grad)


def new_model() -> StressLSTM:
    return StressLSTM()


def load_from_state_dict(state_dict: dict, input_size: int = INPUT_SIZE) -> StressLSTM:
    """
    `input_size` must match whatever the checkpoint was trained with.
    The Personal LSTM is always `INPUT_SIZE` (11, ml/features.py) — callers
    on that path never need to pass this. The Global LSTM has its own,
    smaller input size (see ml/features_global.py); callers loading a
    global checkpoint pass that size explicitly (ml/model_manager.py reads
    it back out of the version's stored metadata so callers don't have to
    hardcode it).
    """
    model = StressLSTM(input_size=input_size)
    model.load_state_dict(state_dict)
    model.eval()
    return model

"""
Tier 1 — Global Behavioral Baseline training
===============================================
Pools participant-DAY CSVs produced by ml/training/prepare_studentlife.py
(every *.csv under --data-dir, each already in the shared
WINDOW_FEATURE_NAMES + label_stress schema — ml/features_global.py) and
trains one GlobalBehavioralBaseline (ml/models/global_baseline.py).
StudentLife is the only source — SWELL-KW and MobileStress are not used
anywhere in this pipeline (explicit decision).

Each row is ONE (participant, date)'s behavioral aggregate for that day,
labeled from that day's mean "Stress" EMA response (STRESS_EMA_CODEBOOK in
ml/features_global.py) — not a participant-level aggregate. This is
possible because the Stress EMA is answered many times per participant
across many days, unlike PSS-10 (administered only pre/post), which is
kept as a secondary, printed-only correlation check
(ml/training/prepare_studentlife.py::report_pss_correlation) rather than
the training label. Expect on the order of dozens of rows per
participant, not 1 — a real improvement over the PSS-10-only design's
~40-50 total rows.

The GroupShuffleSplit-by-(source, participant) validation split matters a
lot here: it keeps every day belonging to one participant entirely in
train OR val, never split across both, so the reported accuracy measures
generalizing to a NEW person rather than memorizing one person's own
day-to-day baseline. Raises a clear error if fewer than 5 distinct
participants are present (e.g. testing against a partial raw-dir) rather
than letting the split fail with a cryptic sklearn error.

Run:
    python -m ml.training.train_global_baseline --data-dir ml/data/global_baseline
"""
from __future__ import annotations
import argparse
import glob
import os
from dataclasses import dataclass, field

import numpy as np
import pandas as pd
from sklearn.metrics import roc_auc_score, accuracy_score, precision_score, recall_score
from sklearn.model_selection import GroupShuffleSplit

from ml.features_global import WINDOW_FEATURE_NAMES, WINDOW_LABEL_COLUMN
from ml.models.global_baseline import GlobalBehavioralBaseline


@dataclass
class BaselineTrainResult:
    model: GlobalBehavioralBaseline
    metrics: dict = field(default_factory=dict)
    n_train: int = 0
    n_val: int = 0


def load_pooled(data_dir: str) -> pd.DataFrame:
    paths = sorted(glob.glob(os.path.join(data_dir, "*.csv")))
    frames = []
    for p in paths:
        df = pd.read_csv(p)
        required = set(WINDOW_FEATURE_NAMES) | {WINDOW_LABEL_COLUMN, "source", "participant"}
        missing = required - set(df.columns)
        if missing:
            print(f"  ⚠️  skipping {p}: missing columns {sorted(missing)}")
            continue
        frames.append(df)
    if not frames:
        raise FileNotFoundError(
            f"No usable prepared CSVs found in {data_dir}. Run "
            "ml/training/prepare_studentlife.py first."
        )
    return pd.concat(frames, ignore_index=True)


def train_global_baseline(
    pooled: pd.DataFrame,
    val_split: float = 0.2,
    seed: int = 42,
) -> BaselineTrainResult:
    X = pooled[WINDOW_FEATURE_NAMES].to_numpy(dtype=np.float64)
    y = pooled[WINDOW_LABEL_COLUMN].to_numpy(dtype=int)
    groups = (
        pooled["source"].astype(str)
        + ":"
        + pooled["participant"].astype(str)
    ).to_numpy()
    n_groups = len(set(groups))

    if n_groups < 5:
        raise ValueError(
            f"Only {n_groups} distinct participant(s) in the pooled data — need at least 5 "
            "for a meaningful grouped train/val split (one participant's days should never "
            "leak between train and val). This is expected if you're testing with a partial "
            "raw-dir (e.g. one participant's sample files) — point --data-dir at the full "
            "StudentLife export to train for real."
        )

    splitter = GroupShuffleSplit(
        n_splits=1,
        test_size=val_split,
        random_state=seed,
    )
    train_idx, val_idx = next(splitter.split(X, y, groups))

    source_counts = pooled["source"].value_counts().to_dict()

    # ---------------------------------------------------------------
    # 1. VALIDATION MODEL
    #    Fit ONLY on the training participants.
    # ---------------------------------------------------------------
    validation_model = GlobalBehavioralBaseline(random_state=seed)
    validation_model.fit(
        X[train_idx],
        y[train_idx],
        source_counts=source_counts,
    )

    val_pred_proba = validation_model.pipeline.predict_proba(X[val_idx])
    classes = list(validation_model.pipeline.named_steps["clf"].classes_)
    pos_idx = classes.index(1) if 1 in classes else -1

    if pos_idx == -1:
        val_proba = np.zeros(len(val_idx), dtype=float)
    else:
        val_proba = val_pred_proba[:, pos_idx]

    val_pred = (val_proba >= 0.5).astype(int)

    metrics = {
        "val_accuracy": round(
            float(accuracy_score(y[val_idx], val_pred)), 4
        ),
        "val_precision": round(
            float(precision_score(y[val_idx], val_pred, zero_division=0)), 4
        ),
        "val_recall": round(
            float(recall_score(y[val_idx], val_pred, zero_division=0)), 4
        ),
        "n_train": int(len(train_idx)),
        "n_val": int(len(val_idx)),
        "source_counts": source_counts,
        "model_type": "logistic_regression",
        "features": list(WINDOW_FEATURE_NAMES),
    }

    if len(set(y[val_idx])) > 1:
        metrics["val_auc"] = round(
            float(roc_auc_score(y[val_idx], val_proba)), 4
        )

    # ---------------------------------------------------------------
    # 2. PRODUCTION MODEL
    #    Validation is now complete. Fit the published model on ALL
    #    available participant-days.
    # ---------------------------------------------------------------
    model = GlobalBehavioralBaseline(random_state=seed)
    model.fit(
        X,
        y,
        source_counts=source_counts,
    )

    metrics["validation_train_samples"] = int(len(train_idx))
    metrics["validation_samples"] = int(len(val_idx))
    metrics["production_train_samples"] = int(len(pooled))

    return BaselineTrainResult(
        model=model,
        metrics=metrics,
        n_train=len(pooled),
        n_val=len(val_idx),
    )

def _cli():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--data-dir", default="ml/data/global_baseline")
    parser.add_argument("--val-split", type=float, default=0.2)
    args = parser.parse_args()

    pooled = load_pooled(args.data_dir)
    print(f"Pooled {len(pooled)} window rows from sources: {pooled['source'].value_counts().to_dict()}")
    print("Per-feature NaN rate across the pool:")
    print(pooled[WINDOW_FEATURE_NAMES].isna().mean().round(2))

    result = train_global_baseline(pooled, val_split=args.val_split)
    print("\nValidation metrics:", result.metrics)
    print("\nNOTE: this CLI trains locally only. Publishing is handled separately.")


if __name__ == "__main__":
    _cli()

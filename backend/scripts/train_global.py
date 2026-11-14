#!/usr/bin/env python
"""
scripts/train_global.py
========================
Trains and publishes one of the three global tiers. Run offline / in CI /
in a scheduled job — never from a running API server.

    python scripts/train_global.py --tier 0    # weekday prior (StudentLife daily Stress EMA)
    python scripts/train_global.py --tier 1    # behavioral baseline (StudentLife app-usage + calendar)
    python scripts/train_global.py --tier 2    # sequence LSTM (pooled anonymized real users)

Each tier is independent — publish whichever ones you have data ready for.
See ML_TRAINING.md for the full walkthrough of what each tier needs and
why there are three instead of one.
"""
from __future__ import annotations
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))



def run_tier0(args):
    from ml.training.train_global_prior import compute_weekday_prior
    import glob
    import pandas as pd

    prior = compute_weekday_prior(args.data_dir)
    training_samples = 0

    for csv_path in sorted(glob.glob(str(Path(args.data_dir) / "*.csv"))):
        df = pd.read_csv(csv_path)
        if "label_risk" in df.columns:
            training_samples += len(df)

    print("Weekday prior:", prior)
    print(f"Training samples: {training_samples}")

    if args.dry_run:
        return
    from app.core.database import get_supabase_admin
    from ml.model_manager import ModelManager
    db = get_supabase_admin()
    manager = ModelManager(db)
    row = manager.save_global_prior(prior, training_samples=training_samples)
    print(f"✅  Published global_prior v{row['version']}.")


def run_tier1(args):
    from ml.training.train_global_baseline import load_pooled, train_global_baseline
    pooled = load_pooled(args.data_dir)
    print(f"Pooled {len(pooled)} rows: {pooled['source'].value_counts().to_dict()}")
    result = train_global_baseline(pooled, val_split=args.val_split)
    print("Validation metrics:", result.metrics)

    val_auc = result.metrics.get("val_auc")

    if args.dry_run:
        return

    if not args.force:
        if val_auc is not None and val_auc < args.min_val_auc:
            print(f"❌  val_auc={val_auc} below --min-val-auc={args.min_val_auc}. Not publishing (--force to override).")
            sys.exit(1)

    from app.core.database import get_supabase_admin
    from ml.model_manager import ModelManager
    db = get_supabase_admin()
    manager = ModelManager(db)
    row = manager.save_global_baseline(result.model, training_samples=result.n_train, metrics=result.metrics)
    print(f"✅  Published global_baseline v{row['version']} ({row['storage_path']}).")


def run_tier2(args):
    from ml.training.train_global_sequence import check_readiness, train_global_sequence
    db = get_supabase_admin()
    ready, info = check_readiness(db)
    print("Readiness:", info)
    if not ready:
        print("Not enough consenting users with enough data yet. See MIN_USERS/MIN_DAYS_PER_USER "
              "in ml/training/train_global_sequence.py. Tier 2 stays unpublished; forecast() will "
              "keep using Tier 1 / Tier 0.")
        sys.exit(1)

    result = train_global_sequence(db, epochs=args.epochs)
    print("Validation metrics:", result.metrics)

    if args.dry_run:
        return
    manager = ModelManager(db)
    row = manager.save_global_lstm(result.model, training_samples=result.n_train_sequences, metrics=result.metrics)
    print(f"✅  Published global_lstm (Tier 2) v{row['version']} ({row['storage_path']}).")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--tier", type=int, choices=[0, 1, 2], required=True)
    parser.add_argument("--data-dir", default=None, help="Defaults per tier: ml/data/tier0, ml/data/global_baseline")
    parser.add_argument("--val-split", type=float, default=0.2)
    parser.add_argument(
        "--min-val-accuracy",
        type=float,
        default=None,
        help="Deprecated/optional accuracy gate; not used by default because class imbalance can make accuracy misleading.",
    )
    parser.add_argument("--min-val-auc", type=float, default=0.55)
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--dry-run", action="store_true", help="Train + validate only, don't publish")
    parser.add_argument("--epochs", type=int, default=60, help="Tier 2 only")
    args = parser.parse_args()

    if args.data_dir is None:
        args.data_dir = {0: "ml/data/tier0", 1: "ml/data/global_baseline"}.get(args.tier)

    if args.dry_run:
        print(f"Environment: dry-run  |  Tier {args.tier}")
    else:
        from app.core.config import get_settings
        settings = get_settings()
        print(f"Environment: {settings.environment}  |  Tier {args.tier}")

    {0: run_tier0, 1: run_tier1, 2: run_tier2}[args.tier](args)


if __name__ == "__main__":
    main()

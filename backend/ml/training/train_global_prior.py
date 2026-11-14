"""
Tier 0 — Population weekday prior
====================================
The absolute last-resort cold-start fallback: for a user with ZERO
behavioral windows AND zero calendar data yet (day 0, before Tier 1 has
anything to work with), return the mean historical stress for that
weekday, computed from StudentLife's daily "Stress" EMA responses — a
genuine statistic, not a model. See ml/inference.py for where this is
used.

This is genuinely weekday-conditioned (not flat): the Stress EMA is
answered many times across many days per StudentLife participant, unlike
PSS-10 (only pre/post per participant, which would give no day-of-week
signal at all — see ml/training/prepare_studentlife.py for why PSS-10 is
kept only as a secondary correlation check, not the training label here).

Input: one or more CSVs with `date` and `label_risk` columns (see
ml/training/prepare_studentlife.py's --out-tier0 output: one row per
individual Stress-EMA response, `date, series_id, label_risk`). The
`date`-based weekday grouping below still falls back to a flat mean if a
future data source is fed in without usable dates — kept for robustness,
not because that's the expected case anymore.
"""
from __future__ import annotations
import argparse
import glob
import json
import os

import pandas as pd


def compute_weekday_prior(data_dir: str) -> dict[str, float]:
    paths = sorted(glob.glob(os.path.join(data_dir, "*.csv")))
    frames = []
    has_date = False
    for p in paths:
        df = pd.read_csv(p)
        if "label_risk" not in df.columns:
            print(f"  ⚠️  skipping {p}: missing 'label_risk' column")
            continue
        if "date" in df.columns:
            has_date = True
            frames.append(df[["date", "label_risk"]])
        else:
            frames.append(df[["label_risk"]])

    if not frames:
        raise FileNotFoundError(f"No usable label_risk CSVs found in {data_dir}")

    pooled = pd.concat(frames, ignore_index=True)
    overall_mean = float(pooled["label_risk"].mean())

    if has_date and "date" in pooled.columns and pooled["date"].notna().any():
        dated = pooled.dropna(subset=["date"]).copy()
        dated["date"] = pd.to_datetime(dated["date"])
        dated["weekday"] = dated["date"].dt.weekday
        by_weekday = dated.groupby("weekday")["label_risk"].mean()
        return {str(d): round(float(by_weekday.get(d, overall_mean)), 4) for d in range(7)}

    # No usable date info (current StudentLife/PSS-10 case) — flat prior,
    # same value for every weekday. Documented above; not a bug.
    return {str(d): round(overall_mean, 4) for d in range(7)}


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--data-dir", default="ml/data/tier0")
    parser.add_argument("--out", default="ml/models/saved/tier0_prior.json")
    args = parser.parse_args()

    prior = compute_weekday_prior(args.data_dir)
    print("Population prior:", prior)
    if len(set(prior.values())) == 1:
        print("(flat — no date/weekday resolution in the source data, see module docstring)")

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w") as f:
        json.dump(prior, f, indent=2)
    print(f"Saved to {args.out}.")


if __name__ == "__main__":
    main()

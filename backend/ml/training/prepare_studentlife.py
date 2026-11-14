#!/usr/bin/env python
"""
ml/training/prepare_studentlife.py  (v4 — app usage + calendar + daily Stress EMA)
========================================================================================
Converts StudentLife's app-usage log, calendar log, and daily "Stress" EMA
into training data for Tier 0 and Tier 1 — see GLOBAL_DATASET_STRATEGY.md
for the full column-by-column mapping table (StudentLife column -> derived
feature -> StressTwin feature -> keep/remove -> reason) that this file
implements. SWELL-KW and MobileStress are not used anywhere in this
pipeline (explicit decision).

WHY THE STRESS EMA REPLACED PSS-10 AS THE PRIMARY LABEL: PSS-10 is only
administered twice per participant (pre/post a ~10-week study), which
capped Tier 1 at one aggregate row per participant (~40-50 rows total) and
forced Tier 0 into a flat, non-weekday-varying prior. The daily "Stress"
EMA (`Stress_u*.json`) is answered dozens of times per participant across
many days, so it supports genuine per-day Tier 1 rows and a real
weekday-conditioned Tier 0 prior. PSS-10 is kept as a secondary,
PRINTED-ONLY correlation check (report_pss_correlation) — never trained on
— since it's still a useful per-participant sanity signal even though it's
no longer the primary label.

THE ORIGINAL RAW FILES ARE NEVER MODIFIED. This script only reads them and
writes NEW derived CSVs elsewhere (--out-tier1 / --out-tier0).

Expected input layout — StudentLife's real exported directory layout
(one file per participant, plus one shared PSS file):

    <raw-dir>/
      app_usage/
        running_app_u00.csv, running_app_u01.csv, ...
      calendar/
        calendar_u00.csv, calendar_u01.csv, ...
      EMA/
        response/
          Stress/
            Stress_u00.json, Stress_u01.json, ...
          columns: level ("1".."5", the Stress EMA response code — some
          early-format rows have a "null" key instead of "level" and are
          skipped, never guessed at), location (lat,long or "Unknown" —
          never read), resp_time (unix seconds)
      PerceivedStressScale.csv  (one shared file, all participants;
          secondary validation only — see report_pss_correlation)

WHAT GETS USED, AND WHAT DOESN'T (short version — see
GLOBAL_DATASET_STRATEGY.md for the full table):
  - running_app: ONLY the foreground (topActivity) package identity over
    time, used transiently to detect app-switch events and the time-span
    of observed usage. Package/class strings are never stored as
    features. id, device, task id, numActivities/numRunning are dropped.
  - calendar: ONLY DATE and TIME. ACCOUNT_LABEL, id, device, and the scan
    `timestamp` are dropped. No duration/title field exists in this file,
    so calendar_committed_hours / calendar_exam_flag are not produced.
  - Stress EMA: ONLY `level`, mapped via STRESS_EMA_CODEBOOK (confirmed
    against EMA_definition.json — the 5 response codes are NOT already
    ordered calm-to-stressed). `location` (GPS) is never read.
  - Other StudentLife EMA surveys ("Dartmouth now", "Mood 1", "Mood 2",
    "Mood") were evaluated and are NOT used — see
    ml/features_global.py's bottom comment block for why each one was
    excluded.
  - PSS-10: used only for the secondary correlation check, never as a
    training label and never as input features.

Usage:
    python -m ml.training.prepare_studentlife --raw-dir /path/to/studentlife/dataset \
        --out-tier1 ml/data/global_baseline/studentlife.csv \
        --out-tier0 ml/data/tier0/studentlife_stress_ema.csv
"""
from __future__ import annotations
import argparse
import glob
import json
import os
import re
from pathlib import Path

import numpy as np
import pandas as pd

from ml.features_global import (
    WINDOW_FEATURE_NAMES,
    STRESS_EMA_CODEBOOK,
    STRESS_EMA_RISK_THRESHOLD,
    PSS_STRESS_THRESHOLD,
    PSS_MAX_SCORE,
)

TZ = "US/Eastern"


# ── Stress EMA: level -> daily risk ──────────────────────────────────────
def extract_stress_ema_responses(raw_dir: str, uid: str) -> pd.DataFrame:
    """
    One row per valid Stress-EMA response for this participant:
    date, label_risk (STRESS_EMA_CODEBOOK-mapped, [0,1]). Rows with no
    'level' key (an early-format artifact seen in real files — a few rows
    carry a 'null' key instead) are skipped, never guessed at. `location`
    is read by nothing in this function.
    """
    candidates = [
        os.path.join(raw_dir, f"Stress_{uid}.json"),
        os.path.join(raw_dir, "EMA", "response", "Stress", f"Stress_{uid}.json"),
    ]
    path = next((p for p in candidates if os.path.exists(p)), candidates[-1])
    if not os.path.exists(path):
        return pd.DataFrame(columns=["date", "label_risk"])
    try:
        rows = json.load(open(path))
    except Exception as e:
        print(f"  ⚠️  could not read {path}: {e}")
        return pd.DataFrame(columns=["date", "label_risk"])

    entries = []
    for r in rows:
        level_raw = r.get("level")
        ts = r.get("resp_time")
        if level_raw is None or ts is None:
            continue
        try:
            level = int(level_raw)
        except (TypeError, ValueError):
            continue
        if level not in STRESS_EMA_CODEBOOK:
            continue
        entries.append((ts, STRESS_EMA_CODEBOOK[level]))

    if not entries:
        return pd.DataFrame(columns=["date", "label_risk"])

    df = pd.DataFrame(entries, columns=["ts", "label_risk"])

    # Remove exact duplicate EMA submissions at the same participant timestamp.
    # Multiple responses on the same DATE are legitimate and must NOT be removed.
    # The raw StudentLife files contain 10 duplicate participant+timestamp rows.
    duplicate_ts = df["ts"].duplicated(keep=False)
    if duplicate_ts.any():
        conflicting = (
            df.loc[duplicate_ts]
            .groupby("ts")["label_risk"]
            .nunique()
        )
        if (conflicting > 1).any():
            bad_ts = conflicting[conflicting > 1].index.tolist()
            raise ValueError(
                f"Conflicting Stress-EMA levels at the same timestamp: {bad_ts}"
            )
        df = df.drop_duplicates(subset=["ts"], keep="first").reset_index(drop=True)

    df["date"] = (
        pd.to_datetime(df["ts"], unit="s", utc=True)
        .dt.tz_convert(TZ)
        .dt.date
        .astype(str)
    )
    return df[["date", "label_risk"]]


def daily_stress_ema(responses: pd.DataFrame) -> pd.DataFrame:
    """Mean label_risk per day, from possibly-multiple same-day responses."""
    if responses.empty:
        return pd.DataFrame(columns=["date", "label_risk"])
    return responses.groupby("date", as_index=False)["label_risk"].mean()


# ── PSS-10: secondary correlation check only, never trained on ──────────
LIKERT_MAP = {
    "never": 0, "almost never": 1, "sometime": 2, "sometimes": 2,
    "fairly often": 3, "very often": 4,
}
REVERSE_SCORED_ITEMS = {4, 5, 7, 8}


def _pss_question_columns(df: pd.DataFrame) -> list[str]:
    return [c for c in df.columns if c not in ("uid", "type")]


def score_pss_row(row: pd.Series, q_cols: list[str]) -> float | None:
    total = 0
    for i, col in enumerate(q_cols, start=1):
        raw = row.get(col)
        if pd.isna(raw):
            return None
        key = str(raw).strip().lower()
        if key not in LIKERT_MAP:
            return None
        score = LIKERT_MAP[key]
        if i in REVERSE_SCORED_ITEMS:
            score = 4 - score
        total += score
    return float(total)


def load_pss_scores(pss_csv: str) -> dict[str, dict[str, float]]:
    if not os.path.exists(pss_csv):
        return {}
    df = pd.read_csv(pss_csv)
    q_cols = _pss_question_columns(df)
    if len(q_cols) != 10:
        print(f"  ⚠️  expected 10 PSS columns in {pss_csv}, found {len(q_cols)} — skipping PSS correlation check")
        return {}
    scores: dict[str, dict[str, float]] = {}
    for _, row in df.iterrows():
        uid, ptype = str(row["uid"]), str(row.get("type", "")).strip().lower()
        total = score_pss_row(row, q_cols)
        scores.setdefault(uid, {})[ptype] = total
    return scores


def pss_label_for_participant(scores: dict[str, float]) -> float | None:
    for ptype in ("post", "pre"):
        total = scores.get(ptype)
        if total is not None:
            return float(np.clip(total / PSS_MAX_SCORE, 0, 1))
    return None


def report_pss_correlation(tier1_df: pd.DataFrame, pss_scores: dict[str, dict]) -> None:
    """Prints a per-participant Pearson correlation between mean daily
    Stress-EMA risk and PSS-10 risk — a sanity check, not a training
    signal. Purely informational; never blocks or feeds back into
    training."""
    rows = []
    for uid, g in tier1_df.groupby("participant"):
        pss = pss_label_for_participant(pss_scores.get(uid, {}))
        if pss is None:
            continue
        rows.append((g["label_risk_continuous"].mean(), pss))
    if len(rows) < 3:
        print("\n(Skipping PSS correlation check — fewer than 3 participants have both EMA and PSS data.)")
        return
    ema_means, pss_vals = zip(*rows)
    corr = float(np.corrcoef(ema_means, pss_vals)[0, 1])
    print(f"\nSanity check — Pearson correlation between mean daily Stress-EMA risk and "
          f"PSS-10 risk across {len(rows)} participants: {corr:.3f} (not used for training)")


# ── calendar: DATE/TIME -> daily load features (unchanged from v3) ──────
_TIME_RE_24H = re.compile(r"^(\d{1,2}):(\d{2})$")
_TIME_RE_12H = re.compile(r"^(\d{1,2}):(\d{2})\s*([AP]M)$", re.IGNORECASE)


def _parse_time_to_minutes(t: str) -> float | None:
    t = str(t).strip()
    m = _TIME_RE_24H.match(t)
    if m:
        h, mnt = int(m.group(1)), int(m.group(2))
        return h * 60 + mnt
    m = _TIME_RE_12H.match(t)
    if m:
        h, mnt, ampm = int(m.group(1)), int(m.group(2)), m.group(3).upper()
        if ampm == "PM" and h != 12:
            h += 12
        if ampm == "AM" and h == 12:
            h = 0
        return h * 60 + mnt
    return None


def build_calendar_daily_features(raw_dir: str, uid: str) -> pd.DataFrame:
    """
    Build calendar features only for dates actually observed in the
    participant's StudentLife calendar file.

    Important:
    - Missing calendar file is represented by an empty DataFrame.
    - Missing calendar dates are NOT interpreted as observed free days.
    - This prevents unavailable calendar data from being confused with
      a genuinely empty calendar.
    """
    path = Path(raw_dir) / "calendar" / f"calendar_{uid}.csv"

    if not path.exists():
        return pd.DataFrame(
            columns=[
                "date",
                "event_count",
                "earliest_start_min",
            ]
        )

    df = pd.read_csv(path)

    if "DATE" not in df.columns:
        return pd.DataFrame(
            columns=[
                "date",
                "event_count",
                "earliest_start_min",
            ]
        )

    df["date"] = pd.to_datetime(
        df["DATE"],
        format="mixed",
        errors="coerce",
    )

    df = df.dropna(subset=["date"]).copy()
    df["date"] = df["date"].dt.date.astype(str)

    if df.empty:
        return pd.DataFrame(
            columns=[
                "date",
                "event_count",
                "earliest_start_min",
            ]
        )

    from datetime import datetime

    def parse_time_minutes(value):
        if pd.isna(value):
            return float("nan")

        value = str(value).strip()

        for fmt in (
            "%H:%M:%S",
            "%H:%M",
            "%I:%M:%S %p",
            "%I:%M %p",
        ):
            try:
                t = datetime.strptime(value, fmt)
                return (
                    t.hour * 60
                    + t.minute
                    + t.second / 60.0
                )
            except ValueError:
                continue

        return float("nan")

    time_col = None
    for candidate in [
        "TIME",
        "time",
        "START",
        "start",
        "START_TIME",
        "start_time",
    ]:
        if candidate in df.columns:
            time_col = candidate
            break

    if time_col is not None:
        df["_start_min"] = df[time_col].apply(
            parse_time_minutes
        )
    else:
        df["_start_min"] = float("nan")

    out = (
        df.groupby("date", as_index=False)
        .agg(
            event_count=("date", "size"),
            earliest_start_min=("_start_min", "min"),
        )
    )

    return out

def _add_consecutive_and_free_day_features(daily: pd.DataFrame, all_dates: list[str]) -> pd.DataFrame:
    """
    Build calendar features on the real calendar-day sequence.

    Important:
    - `all_dates` is normalized to actual consecutive calendar dates.
    - A missing calendar row means zero observed events for that day.
    - Consecutive loaded days counts the current day and previous consecutive
      event days, capped at 7 and normalized to [0, 1].
    - days_to_next_free looks strictly AFTER the current day for the first
      zero-event day, capped at 7 and normalized to [0, 1].
    """

    dates = pd.to_datetime(pd.Series(all_dates), errors="coerce").dt.normalize()

    if dates.isna().any():
        raise ValueError("Invalid date found while building calendar features")

    full_dates = pd.date_range(
        start=dates.min(),
        end=dates.max(),
        freq="D",
    )

    by_date = {
        pd.Timestamp(d).normalize(): float(c)
        for d, c in zip(daily["date"], daily["event_count"])
    }

    counts = [by_date.get(d, 0.0) for d in full_dates]

    consecutive = []
    streak = 0

    for c in counts:
        if c > 0:
            streak += 1
        else:
            streak = 0

        consecutive.append(min(streak, 7))

    days_to_free = []

    for i in range(len(counts)):
        distance = 7

        for j in range(i + 1, min(i + 8, len(counts))):
            if counts[j] == 0:
                distance = j - i
                break

        days_to_free.append(distance)

    earliest_by_date = {
        pd.Timestamp(d).normalize(): value
        for d, value in zip(
            daily["date"],
            daily.get("earliest_start_min", pd.Series(dtype=float)),
        )
    }

    result = pd.DataFrame({
        "date": [d.strftime("%Y-%m-%d") for d in full_dates],
        "event_count": counts,
        "earliest_start_min": [
            earliest_by_date.get(d, np.nan)
            for d in full_dates
        ],
        "consecutive_loaded_days": consecutive,
        "days_to_next_free": days_to_free,
    })

    return result[result["date"].isin(set(all_dates))].reset_index(drop=True)


# ── app usage: running_app -> app-switch rate + active-hours proxy (unchanged) ──
def build_app_usage_daily_features(raw_dir: str, uid: str) -> pd.DataFrame:
    candidates = [
        os.path.join(raw_dir, f"running_app_{uid}.csv"),
        os.path.join(raw_dir, "app_usage", f"running_app_{uid}.csv"),
    ]
    path = next((p for p in candidates if os.path.exists(p)), candidates[-1])
    if not os.path.exists(path):
        return pd.DataFrame(columns=["date", "app_switch_rate", "active_hours_norm"])

    df = pd.read_csv(path, encoding="utf-8-sig")
    df = df.dropna(subset=["timestamp", "RUNNING_TASKS_topActivity_mPackage"])
    if df.empty:
        return pd.DataFrame(columns=["date", "app_switch_rate", "active_hours_norm"])

    df["timestamp"] = df["timestamp"].astype(float).astype(int)
    df["dt"] = pd.to_datetime(df["timestamp"], unit="s", utc=True).dt.tz_convert(TZ)
    df["date"] = df["dt"].dt.date.astype(str)

    # Each timestamp contains multiple RUNNING_TASKS rows: one row per
    # running task/package. Do not arbitrarily select the first row.
    #
    # Use the top-activity package as the observation, but resolve duplicate
    # timestamps deterministically by taking the most frequent package at
    # that timestamp. This prevents row ordering from changing the signal.
    per_sample = (
        df.groupby(
            ["timestamp", "date"],
            as_index=False,
        )["RUNNING_TASKS_topActivity_mPackage"]
        .agg(lambda x: x.mode().iloc[0] if not x.mode().empty else x.iloc[0])
    )

    rows = []
    for day, g in per_sample.groupby("date"):
        g = g.sort_values("timestamp")
        pkgs = g["RUNNING_TASKS_topActivity_mPackage"].tolist()
        switches = sum(1 for a, b in zip(pkgs[:-1], pkgs[1:]) if a != b)
        span_seconds = g["timestamp"].iloc[-1] - g["timestamp"].iloc[0]
        span_hours = max(span_seconds / 3600.0, 1 / 60)
        rows.append({
            "date": day,
            "app_switch_rate": switches / span_hours,
            "active_hours_norm": min(span_seconds / 86400.0, 1.0),
        })

    return pd.DataFrame(rows)


# ── combine into daily, per-participant-day rows ─────────────────────────
def build_participant_daily_rows(raw_dir: str, uid: str) -> pd.DataFrame:
    """
    One row per (participant, date) — ONLY for dates that have a Stress-EMA
    response (can't supervise an unlabeled day). Behavioral/calendar
    features for that date come from real data where available, 0
    otherwise (no signal that day, not guessed).
    """
    stress_daily = daily_stress_ema(extract_stress_ema_responses(raw_dir, uid))
    if stress_daily.empty:
        return pd.DataFrame()

    cal_raw = build_calendar_daily_features(raw_dir, uid)
    app = build_app_usage_daily_features(raw_dir, uid)

    # Full date range spans calendar + app-usage + stress-EMA dates so
    # consecutive/free-day features see real gaps.
    all_dates = sorted(set(cal_raw["date"]) | set(app["date"]) | set(stress_daily["date"]))
    calendar_observed_dates = set(cal_raw["date"].astype(str))

    cal = _add_consecutive_and_free_day_features(cal_raw, all_dates)

    cal["calendar_observed"] = cal["date"].astype(str).isin(
        calendar_observed_dates
    ).astype(int)

    cal["calendar_meeting_density"] = (
        cal["event_count"] / 10.0
    ).clip(upper=1.0)

    cal["calendar_earliest_start"] = (
        cal["earliest_start_min"] / 1440.0
    )

    cal["calendar_consecutive_loaded_days"] = (
        cal["consecutive_loaded_days"] / 7.0
    ).clip(upper=1.0)

    cal["calendar_days_to_next_free"] = (
        1.0 - (cal["days_to_next_free"] / 7.0).clip(upper=1.0)
    )

    # Calendar values are missing when the participant/day has no observed
    # calendar record. Do not turn missing calendar data into "free day".
    calendar_features = [
        "calendar_meeting_density",
        "calendar_earliest_start",
        "calendar_consecutive_loaded_days",
        "calendar_days_to_next_free",
    ]

    cal.loc[
        cal["calendar_observed"] == 0,
        calendar_features,
    ] = float("nan")

    merged = pd.DataFrame({"date": all_dates}).merge(
        cal[["date", "calendar_observed",
             "calendar_meeting_density", "calendar_earliest_start",
             "calendar_consecutive_loaded_days", "calendar_days_to_next_free"]],
        on="date", how="left",
    ).merge(app, on="date", how="left").merge(
        stress_daily.rename(columns={"label_risk": "label_risk_continuous"}), on="date", how="inner"  # only labeled days
    )

    merged["app_switch_rate"] = merged["app_switch_rate"].fillna(0.0)
    merged["active_hours_norm"] = merged["active_hours_norm"].fillna(0.0)

    merged["calendar_observed"] = merged["calendar_observed"].fillna(0).astype(int)
    merged["label_stress"] = (merged["label_risk_continuous"] >= STRESS_EMA_RISK_THRESHOLD).astype(int)
    merged["source"] = "studentlife"
    merged["participant"] = uid
    merged["condition"] = ""

    cols = [
        "source",
        "participant",
        "condition",
        "date",
    ] + WINDOW_FEATURE_NAMES + [
        "calendar_observed",
        "label_stress",
        "label_risk_continuous",
    ]
    return merged[cols]


def _participant_ids(raw_dir: str) -> list[str]:
    ids = set()
    patterns = (
        os.path.join(raw_dir, "running_app_u*.csv"),
        os.path.join(raw_dir, "calendar_u*.csv"),
        os.path.join(raw_dir, "Stress_u*.json"),
        os.path.join(raw_dir, "app_usage", "running_app_u*.csv"),
        os.path.join(raw_dir, "calendar", "calendar_u*.csv"),
        os.path.join(raw_dir, "EMA", "response", "Stress", "Stress_u*.json"),
    )

    for pattern in patterns:
        for p in glob.glob(pattern):
            m = re.search(r"_([uU]\d+)\.(csv|json)$", os.path.basename(p))
            if m:
                ids.add(m.group(1))
    return sorted(ids)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--raw-dir", required=True,
                        help="StudentLife dataset root containing app_usage/, calendar/, EMA/response/Stress/, "
                             "and optionally PerceivedStressScale.csv")
    parser.add_argument("--pss-file", default=None, help="Defaults to <raw-dir>/PerceivedStressScale.csv")
    parser.add_argument("--out-tier1", default="ml/data/global_baseline/studentlife.csv")
    parser.add_argument("--out-tier0", default="ml/data/tier0/studentlife_stress_ema.csv")
    args = parser.parse_args()

    uids = _participant_ids(args.raw_dir)
    if not uids:
        raise FileNotFoundError(f"No running_app_u*.csv, calendar_u*.csv, or Stress_u*.json found under {args.raw_dir}")
    print(f"Found {len(uids)} participants")

    all_daily_rows = []
    skipped = 0
    for uid in uids:
        rows = build_participant_daily_rows(args.raw_dir, uid)
        if rows.empty:
            skipped += 1
            continue
        all_daily_rows.append(rows)

    if not all_daily_rows:
        raise ValueError("No participants had any Stress-EMA-labeled days — nothing to write.")

    tier1_df = pd.concat(all_daily_rows, ignore_index=True)
    Path(args.out_tier1).parent.mkdir(parents=True, exist_ok=True)
    tier1_df.to_csv(args.out_tier1, index=False)
    print(f"\nTier 1: wrote {len(tier1_df)} participant-day rows "
          f"({tier1_df['participant'].nunique()} participants, {skipped} skipped — no Stress-EMA data) "
          f"to {args.out_tier1}")
    print(f"label_stress distribution: {tier1_df['label_stress'].value_counts().to_dict()}")
    print(f"rows per participant: mean {tier1_df.groupby('participant').size().mean():.1f}, "
          f"min {tier1_df.groupby('participant').size().min()}, max {tier1_df.groupby('participant').size().max()}")

    # Tier 0: every individual EMA response (not day-averaged), across all
    # participants — more data points for a genuine weekday breakdown.
    tier0_rows = []
    for uid in uids:
        resp = extract_stress_ema_responses(args.raw_dir, uid)
        if resp.empty:
            continue
        resp = resp.copy()
        resp["series_id"] = uid
        tier0_rows.append(resp[["date", "series_id", "label_risk"]])
    tier0_df = pd.concat(tier0_rows, ignore_index=True) if tier0_rows else pd.DataFrame(columns=["date", "series_id", "label_risk"])
    Path(args.out_tier0).parent.mkdir(parents=True, exist_ok=True)
    tier0_df.to_csv(args.out_tier0, index=False)
    print(f"\nTier 0: wrote {len(tier0_df)} individual Stress-EMA responses "
          f"({tier0_df['series_id'].nunique() if len(tier0_df) else 0} participants) to {args.out_tier0}")
    print("This has real dates, so ml.training.train_global_prior now computes a genuine "
          "weekday-conditioned prior (not the flat fallback the PSS-10-only version used).")

    pss_path = args.pss_file or os.path.join(args.raw_dir, "PerceivedStressScale.csv")
    pss_scores = load_pss_scores(pss_path)
    if pss_scores:
        report_pss_correlation(tier1_df, pss_scores)

    print(f"\nNext: python scripts/train_global.py --tier 1")
    print(f"      python scripts/train_global.py --tier 0")


if __name__ == "__main__":
    main()

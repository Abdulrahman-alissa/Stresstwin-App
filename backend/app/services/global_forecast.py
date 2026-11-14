"""
global_forecast.py
───────────────────
"Starter" 3-day forecast used until a user has enough of their own data for the personal LSTM.

What it uses (all aggregates, no individual's rows are exposed):
  • Population weekday profile — across all users, how much higher/lower than their own average
    people score on each weekday (factor ≈ 1.0 = typical). Needs ≥ MIN_COHORT users per weekday,
    otherwise that weekday's factor is 1.0 (flat) rather than a guess.
  • The user's own recent average score (last ~7 days) as the level; the population mean if they have none yet.
  • Their calendar (exam / committed hours / meetings) when connected.

It is an estimate, not a trained model, and the API says so (`source: "global"`).
Pure functions only (no DB access) so they can be tested alone.
"""
from __future__ import annotations
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from typing import Iterable, Optional

MIN_COHORT = 3          # users needed behind a weekday factor before we trust it
MIN_USER_SCORES = 20    # scores a user needs before they count towards the profile
FACTOR_LIMITS = (0.7, 1.3)
MIN_OWN_SCORES = 10     # own scores needed to use the user's own level

# calendar nudges (added to a 0–1 risk)
CAL_EXAM = 0.15
CAL_HEAVY_HOURS = 0.10   # > 5 h committed
CAL_MEETINGS = 0.05      # ≥ 4 meetings


def pg_dow(d: date) -> int:
    """Postgres weekday number: 0 = Sunday … 6 = Saturday."""
    return (d.weekday() + 1) % 7


def profile_from_rows(rows: Iterable[tuple[str, datetime, float]], min_scores: int = MIN_USER_SCORES) -> dict[int, dict]:
    """Python twin of the SQL function (fallback). rows = (user_id, created_at, score)."""
    by_user: dict[str, list[tuple[int, float]]] = defaultdict(list)
    for uid, at, score in rows:
        at = at if at.tzinfo else at.replace(tzinfo=timezone.utc)
        by_user[uid].append((pg_dow(at.astimezone(timezone.utc).date()), float(score)))
    cells: dict[int, list[tuple[float, float]]] = defaultdict(list)   # dow -> [(day mean / own mean, day mean)]
    for uid, items in by_user.items():
        if len(items) < min_scores:
            continue
        u_mean = sum(s for _, s in items) / len(items)
        if u_mean <= 0:
            continue
        per: dict[int, list[float]] = defaultdict(list)
        for dow, s in items:
            per[dow].append(s)
        for dow, vals in per.items():
            m = sum(vals) / len(vals)
            cells[dow].append((m / u_mean, m))
    return {
        dow: {"factor": sum(f for f, _ in v) / len(v), "users": len(v), "mean_score": sum(m for _, m in v) / len(v)}
        for dow, v in cells.items()
    }


def prior_profile(prior: dict) -> dict[int, dict]:
    """
    Turn the trained Tier-0 weekday prior (ml/models/saved/tier0_prior.json, keys "0".."6" = Mon..Sun,
    values = mean risk 0-1 from the StudentLife stress surveys) into the same shape as a cohort profile.
    Entries carry prior=True and users=0: they are trusted for the weekday shape but never counted as a cohort.
    """
    vals = {int(k): float(v) for k, v in (prior or {}).items() if str(k).isdigit() and 0 <= int(k) <= 6}
    if len(vals) < 7:
        return {}
    mean = sum(vals.values()) / 7.0
    if mean <= 0:
        return {}
    return {(k + 1) % 7: {"factor": v / mean, "users": 0, "mean_score": v * 100.0, "prior": True} for k, v in vals.items()}


def merge_prior(profile: dict[int, dict], prior_prof: dict[int, dict]) -> dict[int, dict]:
    """Use real cohort factors where >= MIN_COHORT users back them, the trained prior everywhere else."""
    out = dict(profile)
    for dow, p in prior_prof.items():
        cur = out.get(dow)
        if not cur or cur.get("users", 0) < MIN_COHORT:
            out[dow] = p
    return out


def calendar_nudge(cal: Optional[dict]) -> tuple[float, Optional[str]]:
    """(risk added, label of the main stressor) from one day's calendar row."""
    if not cal:
        return 0.0, None
    hours = float(cal.get("total_committed_hours") or 0)
    meetings = int(cal.get("meeting_density") or 0)
    add, label = 0.0, None
    if cal.get("exam_flag"):
        add += CAL_EXAM; label = "Exam / deadline detected"
    if hours > 5:
        add += CAL_HEAVY_HOURS; label = label or f"{hours:.1f}h committed calendar time"
    if meetings >= 4:
        add += CAL_MEETINGS; label = label or f"{meetings} meetings"
    return add, label


def build_days(
    today: date,
    own_scores: list[float],
    profile: dict[int, dict],
    calendar_by_date: dict[str, dict],
    horizon: int = 3,
) -> tuple[list[dict], int]:
    """
    Returns (days, cohort_size). days = [{date, risk, stressor}]; empty when there is nothing to base it on.
    cohort_size = the smallest number of users behind any weekday factor that was used (0 = none used).
    """
    pop_means = [p["mean_score"] for p in profile.values() if p["users"] >= MIN_COHORT or p.get("prior")]
    if len(own_scores) >= MIN_OWN_SCORES:
        base = sum(own_scores) / len(own_scores)
    elif pop_means:
        base = sum(pop_means) / len(pop_means)
    else:
        return [], 0

    out, cohorts = [], []
    for i in range(1, horizon + 1):
        d = today + timedelta(days=i)
        p = profile.get(pg_dow(d))
        if p and (p["users"] >= MIN_COHORT or p.get("prior")):
            factor = min(max(p["factor"], FACTOR_LIMITS[0]), FACTOR_LIMITS[1])
            if not p.get("prior"):
                cohorts.append(p["users"])
        else:
            factor = 1.0
        add, stressor = calendar_nudge(calendar_by_date.get(d.isoformat()))
        risk = min(max(base / 100.0 * factor + add, 0.0), 1.0)
        out.append({"date": d.isoformat(), "risk": round(risk, 3), "stressor": stressor})
    return out, (min(cohorts) if cohorts else 0)

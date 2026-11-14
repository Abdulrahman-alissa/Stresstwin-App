"""
device_stats.py
────────────────
Summarises the behavioral data each device has contributed, and the average
across all devices that are collecting data.

Pure functions (no database access) so the maths can be tested on its own.

Averaging rule — IMPORTANT: the all-device average is the mean of the
per-device means, taken over the devices that actually reported that metric.
That way a laptop that logged 2,000 windows doesn't drown out a phone that
logged 40; every device counts once. Each metric is only averaged over the
devices that measure it (a phone has no mouse), and `devices_reporting`
says how many that was.

Only numbers are ever read here. There is no text content anywhere in the data.
"""
from __future__ import annotations
from datetime import datetime, timezone
from typing import Any, Iterable, Optional

# (output key, behavioral_logs column, aggregation)
# "mean" → average of the window values; "sum" → total over the period.
METRICS: list[tuple[str, str, str]] = [
    # measured on every platform (keyboard snapshots map onto these columns too)
    ("typing_interval_ms", "keystroke_mean", "mean"),
    ("error_rate", "error_rate", "mean"),
    ("idle_frequency", "idle_frequency", "mean"),
    # mobile keyboard
    ("typing_speed_cps", "typing_speed_cps", "mean"),
    ("backspace_rate", "backspace_rate", "mean"),
    ("pause_frequency", "pause_frequency", "mean"),
    ("typing_bursts", "typing_bursts", "mean"),
    ("typing_interruptions", "typing_interruptions", "mean"),
    ("key_presses", "char_count", "sum"),          # a COUNT — never which keys
    # desktop
    ("mouse_velocity", "mouse_velocity", "mean"),
    ("mouse_smoothness", "mouse_smoothness", "mean"),
    ("click_hesitation", "click_hesitation", "mean"),
    ("app_switch_rate", "app_switch_rate", "mean"),
    # phone sensors
    ("gyro_variance", "gyro_variance", "mean"),
    ("touch_pressure", "touch_pressure", "mean"),
]

LOG_COLUMNS = ["id", "device_id", "window_start", "session_duration"] + sorted({c for _, c, _ in METRICS})

STALE_AFTER_SECONDS = 20 * 60


def _num(v: Any) -> Optional[float]:
    if v is None or isinstance(v, bool):
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if f == f and f not in (float("inf"), float("-inf")) else None  # drop NaN / inf


def _mean(xs: list[float]) -> Optional[float]:
    return sum(xs) / len(xs) if xs else None


def _status(last_snapshot_at: Optional[str], now: datetime) -> str:
    if not last_snapshot_at:
        return "inactive"
    try:
        ts = datetime.fromisoformat(str(last_snapshot_at).replace("Z", "+00:00"))
    except ValueError:
        return "inactive"
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    return "sending" if (now - ts).total_seconds() <= STALE_AFTER_SECONDS else "stale"


def summarise_device(logs: Iterable[dict], scores: list[float]) -> dict:
    """Metrics + totals for ONE device's logs."""
    rows = list(logs)
    metrics: dict[str, Optional[float]] = {}
    for key, col, how in METRICS:
        vals = [v for v in (_num(r.get(col)) for r in rows) if v is not None]
        if not vals:
            metrics[key] = None
        else:
            metrics[key] = sum(vals) if how == "sum" else _mean(vals)
    seconds = sum(v for v in (_num(r.get("session_duration")) for r in rows) if v is not None)
    return {
        "windows": len(rows),
        "active_minutes": round(seconds / 60, 1),
        "mean_score": round(_mean(scores), 1) if scores else None,
        "max_score": round(max(scores), 1) if scores else None,
        "metrics": metrics,
    }


def compute_device_stats(
    devices: list[dict],
    logs: list[dict],
    scores_by_log: dict[str, float],
    hours: int,
    now: Optional[datetime] = None,
) -> dict:
    """
    devices        rows from `devices` (id = pk, device_id = client id, platform, display_name, last_snapshot_at…)
    logs           rows from `behavioral_logs` inside the period (columns = LOG_COLUMNS)
    scores_by_log  {behavioral_logs.id → deviation_score}
    """
    now = now or datetime.now(timezone.utc)
    by_pk: dict[Optional[str], list[dict]] = {}
    for r in logs:
        by_pk.setdefault(r.get("device_id"), []).append(r)

    out_devices: list[dict] = []
    for d in devices:
        rows = by_pk.get(d["id"], [])
        sc = [scores_by_log[r["id"]] for r in rows if r.get("id") in scores_by_log and _num(scores_by_log[r["id"]]) is not None]
        s = summarise_device(rows, sc)
        out_devices.append({
            "device_id": d["device_id"],
            "display_name": d.get("display_name") or "Unknown device",
            "platform": d["platform"],
            "status": _status(d.get("last_snapshot_at"), now),
            "last_snapshot_at": d.get("last_snapshot_at"),
            **s,
        })

    # Older rows saved before devices existed (device_id NULL) — keep them visible, but separate.
    legacy = by_pk.get(None, [])
    if legacy:
        sc = [scores_by_log[r["id"]] for r in legacy if r.get("id") in scores_by_log]
        out_devices.append({
            "device_id": "legacy", "display_name": "Earlier data (no device)", "platform": "desktop",
            "status": "inactive", "last_snapshot_at": None, **summarise_device(legacy, sc),
        })

    contributing = [d for d in out_devices if d["windows"] > 0]
    avg_metrics: dict[str, Optional[float]] = {}
    reporting: dict[str, int] = {}
    for key, _, _ in METRICS:
        vals = [d["metrics"][key] for d in contributing if d["metrics"].get(key) is not None]
        avg_metrics[key] = _mean(vals)
        reporting[key] = len(vals)
    dev_scores = [d["mean_score"] for d in contributing if d["mean_score"] is not None]

    return {
        "hours": hours,
        "generated_at": now.isoformat(),
        "devices": out_devices,
        "average": {
            "devices_counted": len(contributing),
            "windows": sum(d["windows"] for d in contributing),
            "active_minutes": round(sum(d["active_minutes"] for d in contributing), 1),
            "mean_score": round(_mean(dev_scores), 1) if dev_scores else None,
            "metrics": avg_metrics,
            "devices_reporting": reporting,
        },
    }

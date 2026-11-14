"""Number of distinct days a user has behavioral data for (shared by the profile + forecast gate)."""
from __future__ import annotations


from app.core.db_retry import TRANSIENT_ERRORS


def count_data_days(db, uid: str) -> int:
    """
    Preferred: the `count_data_days` SQL function (migration 003) — exact and cheap.
    Fallback (migration not applied yet): page through window_start. PostgREST caps one
    response at ~1000 rows, so a single un-paged select silently under-counts.
    """
    try:
        res = db.rpc("count_data_days", {"p_user": uid}).execute()
        val = res.data
        if isinstance(val, list):
            val = val[0] if val else 0
        if isinstance(val, dict):
            val = next(iter(val.values()), 0)
        return int(val or 0)
    except TRANSIENT_ERRORS:
        raise                                 # let the caller retry / report the outage
    except Exception:
        pass

    days: set[str] = set()
    page, max_pages = 1000, 120          # hard ceiling: 120k rows
    for i in range(max_pages):
        rows = (
            db.table("behavioral_logs").select("window_start").eq("user_id", uid)
            .order("window_start").range(i * page, (i + 1) * page - 1).execute().data or []
        )
        for r in rows:
            ws = r.get("window_start")
            if ws:
                days.add(str(ws)[:10])
        if len(rows) < page:
            break
    return len(days)

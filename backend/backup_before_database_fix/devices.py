from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException, Query
from app.core.security import get_current_user
from app.core.database import get_supabase_admin
from app.schemas.behavioral import DeviceRegisterRequest, DeviceOut, DeviceHeartbeatRequest, DeviceStatsResponse
from app.services.device_stats import compute_device_stats, LOG_COLUMNS

router = APIRouter(prefix="/api/devices", tags=["Devices"])

# A device counts as "sending" if we heard a local snapshot in the last ~20 min
# (comfortably wider than the 15s collection / 10min sync cadence so a couple of
# missed sync cycles don't flip it red), "stale" if longer, "inactive" if never.
STALE_AFTER_SECONDS = 20 * 60


def _status_for(last_snapshot_at: str | None) -> str:
    if not last_snapshot_at:
        return "inactive"
    ts = datetime.fromisoformat(last_snapshot_at.replace("Z", "+00:00"))
    age = (datetime.now(timezone.utc) - ts).total_seconds()
    return "sending" if age <= STALE_AFTER_SECONDS else "stale"


def _to_out(row: dict) -> DeviceOut:
    return DeviceOut(
        id=row["id"],
        device_id=row["device_id"],
        platform=row["platform"],
        display_name=row["display_name"],
        keyboard_active=row.get("keyboard_active", False),
        last_snapshot_at=row.get("last_snapshot_at"),
        last_sync_at=row.get("last_sync_at"),
        status=_status_for(row.get("last_snapshot_at")),
    )


@router.post("/register", response_model=DeviceOut)
async def register_device(body: DeviceRegisterRequest, current: dict = Depends(get_current_user)):
    """Idempotent — safe to call on every app launch. Upserts on (user_id, device_id)."""
    uid = current["sub"]
    db = get_supabase_admin()

    existing = (
        db.table("devices")
        .select("*")
        .eq("user_id", uid)
        .eq("device_id", body.device_id)
        .maybe_single()
        .execute()
    )

    if existing.data:
        row = (
            db.table("devices")
            .update({"platform": body.platform, "display_name": body.display_name})
            .eq("id", existing.data["id"])
            .execute()
        )
        return _to_out(row.data[0])

    row = (
        db.table("devices")
        .insert({
            "user_id": uid,
            "device_id": body.device_id,
            "platform": body.platform,
            "display_name": body.display_name,
        })
        .execute()
    )
    return _to_out(row.data[0])


@router.get("", response_model=list[DeviceOut])
async def list_devices(current: dict = Depends(get_current_user)):
    uid = current["sub"]
    db = get_supabase_admin()
    rows = db.table("devices").select("*").eq("user_id", uid).order("created_at").execute()
    return [_to_out(r) for r in rows.data]


def _fetch_all(build_query, page: int = 1000, max_pages: int = 30) -> list[dict]:
    """PostgREST caps a response (default 1000 rows) — page through it, with a hard ceiling."""
    rows: list[dict] = []
    for i in range(max_pages):
        chunk = build_query().range(i * page, (i + 1) * page - 1).execute().data or []
        rows.extend(chunk)
        if len(chunk) < page:
            break
    return rows


# NOTE: declared BEFORE "/{device_id}/heartbeat" and it is a GET, so it can't be mistaken for a device id.
@router.get("/stats", response_model=DeviceStatsResponse)
async def device_stats(
    hours: int = Query(default=24, ge=1, le=24 * 14),
    current: dict = Depends(get_current_user),
):
    """
    What each of the user's devices has collected in the last `hours`, plus the
    average across every device that sent data. Numbers only — no typed content exists.
    """
    uid = current["sub"]
    db = get_supabase_admin()
    since = (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()

    devices = db.table("devices").select("*").eq("user_id", uid).order("created_at").execute().data or []
    logs = _fetch_all(lambda: (
        db.table("behavioral_logs").select(",".join(LOG_COLUMNS))
        .eq("user_id", uid).gte("window_start", since).order("window_start")
    ))
    score_rows = _fetch_all(lambda: (
        db.table("if_scores").select("log_id,deviation_score")
        .eq("user_id", uid).gte("created_at", since).order("created_at")
    ))
    scores_by_log = {r["log_id"]: float(r["deviation_score"]) for r in score_rows if r.get("log_id") and r.get("deviation_score") is not None}
    return compute_device_stats(devices, logs, scores_by_log, hours)


@router.post("/{device_id}/heartbeat", response_model=DeviceOut)
async def heartbeat(device_id: str, body: DeviceHeartbeatRequest, current: dict = Depends(get_current_user)):
    """
    Called by the app (not the keyboard extension) whenever it can observe
    whether the StressTwin keyboard is currently the enabled/active IME, so the
    dashboard's "Keyboard Enabled" indicator reflects real OS state.
    """
    uid = current["sub"]
    db = get_supabase_admin()
    existing = (
        db.table("devices")
        .select("id")
        .eq("user_id", uid)
        .eq("device_id", device_id)
        .maybe_single()
        .execute()
    )
    if not existing.data:
        raise HTTPException(status_code=404, detail="Device not registered")

    patch = {}
    if body.keyboard_active is not None:
        patch["keyboard_active"] = body.keyboard_active
    if not patch:
        row = db.table("devices").select("*").eq("id", existing.data["id"]).single().execute()
        return _to_out(row.data)

    row = db.table("devices").update(patch).eq("id", existing.data["id"]).execute()
    return _to_out(row.data[0])

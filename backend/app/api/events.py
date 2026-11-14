from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from app.core.security import get_current_user
from app.core.db_retry import first_row
from app.core.database import get_supabase_admin
from app.schemas.behavioral import (
    BatchRequest, ScoreResponse, ScoreHistoryItem,
    BehavioralFeatures, SnapshotBatchUploadRequest, SnapshotBatchUploadResponse,
)
from app.services.scoring_service import score_behavioral_window
import uuid

router = APIRouter(prefix="/api/events", tags=["Events"])


@router.post("/batch", response_model=ScoreResponse)
async def submit_batch(body: BatchRequest, current: dict = Depends(get_current_user)):
    uid = current["sub"]
    db = get_supabase_admin()
    feats = body.features

    # Optional device linkage (legacy desktop clients may omit this).
    device_pk = None
    if feats.device_id:
        device_row = first_row(
            db.table("devices").select("id").eq("user_id", uid).eq("device_id", feats.device_id)
        )
        if device_row:
            device_pk = device_row["id"]
            now_iso = datetime.now(timezone.utc).isoformat()
            db.table("devices").update({
                "last_snapshot_at": now_iso, "last_sync_at": now_iso,
            }).eq("id", device_pk).execute()

    # 1. Persist behavioral log
    log_id = str(uuid.uuid4())
    log_row = {
        "id": log_id,
        "user_id": uid,
        "device_id": device_pk,
        "source": "desktop_sensor" if feats.platform == "desktop" else "mobile_sensor",
        "window_start": feats.window_start.isoformat(),
        "platform": feats.platform,
        "keystroke_mean": feats.keystroke_mean,
        "keystroke_std": feats.keystroke_std,
        "error_rate": feats.error_rate,
        "mouse_velocity": feats.mouse_velocity,
        "mouse_smoothness": feats.mouse_smoothness,
        "click_hesitation": feats.click_hesitation,
        "touch_pressure": feats.touch_pressure,
        "gyro_variance": feats.gyro_variance,
        "idle_frequency": feats.idle_frequency,
        "app_switch_rate": feats.app_switch_rate,
        "session_duration": feats.session_duration,
    }
    db.table("behavioral_logs").insert(log_row).execute()

    # 2. Score via Isolation Forest service
    result = await score_behavioral_window(uid, feats, log_id, db)
    return result


def _keyboard_snapshot_to_features(snap, platform: str) -> BehavioralFeatures:
    """
    Maps a KeyboardSnapshot (behavioral-only, no content) onto the existing
    BehavioralFeatures vector so it flows through the same Isolation Forest /
    intervention pipeline as desktop keystroke/mouse data. No new ML model is
    needed for the keyboard data source.
    """
    idle_freq = None
    if snap.pause_frequency is not None:
        # normalize pauses/min into a rough 0-1 "idleness" signal, capped
        idle_freq = min(snap.pause_frequency / 10, 1.0)

    return BehavioralFeatures(
        platform=platform,
        window_start=snap.window_start,
        keystroke_mean=snap.inter_key_interval_ms,
        keystroke_std=None,
        error_rate=snap.correction_rate,
        idle_frequency=idle_freq,
        session_duration=snap.session_duration,
    )


@router.post("/batch-upload", response_model=SnapshotBatchUploadResponse)
async def submit_snapshot_batch(body: SnapshotBatchUploadRequest, current: dict = Depends(get_current_user)):
    """
    Receives a ~10-minute batch of locally-buffered 15s feature snapshots from
    a device (mobile keyboard extension, mobile sensors, or desktop). Each
    snapshot carries a client-generated `client_snapshot_id` so retried/repeat
    uploads (e.g. after a dropped connection) are de-duplicated server-side
    rather than double counted or double-scored.
    """
    uid = current["sub"]
    db = get_supabase_admin()

    device_row = first_row(
        db.table("devices").select("id").eq("user_id", uid).eq("device_id", body.device_id)
    )
    if not device_row:
        raise HTTPException(status_code=404, detail="Device not registered — call /api/devices/register first")
    device_pk = device_row["id"]

    accepted, duplicates = 0, 0
    latest_window = None

    for snap in body.snapshots:
        row = {
            "id": str(uuid.uuid4()),
            "user_id": uid,
            "device_id": device_pk,
            "source": body.source,
            "client_snapshot_id": snap.client_snapshot_id,
            "window_start": snap.window_start.isoformat(),
            "platform": body.platform,
            "session_duration": snap.session_duration,
            "typing_speed_cps": snap.typing_speed_cps,
            "inter_key_interval_ms": snap.inter_key_interval_ms,
            "backspace_rate": snap.backspace_rate,
            "correction_rate": snap.correction_rate,
            "pause_frequency": snap.pause_frequency,
            "typing_bursts": snap.typing_bursts,
            "typing_interruptions": snap.typing_interruptions,
            "char_count": snap.char_count,
            # Reuse the existing generic columns too, so scoring can read from
            # either the keyboard-specific or legacy columns uniformly.
            "keystroke_mean": snap.inter_key_interval_ms,
            "error_rate": snap.correction_rate,
        }
        try:
            inserted = db.table("behavioral_logs").insert(row).execute()
        except Exception as e:
            # Unique (device_id, client_snapshot_id) violation == already uploaded.
            if "duplicate key" in str(e).lower() or "unique" in str(e).lower():
                duplicates += 1
                continue
            raise

        accepted += 1
        log_id = inserted.data[0]["id"]
        if latest_window is None or snap.window_start > latest_window:
            latest_window = snap.window_start

        # Score each accepted snapshot through the same pipeline desktop uses.
        feats = _keyboard_snapshot_to_features(snap, body.platform)
        await score_behavioral_window(uid, feats, log_id, db)

    now_iso = datetime.now(timezone.utc).isoformat()
    db.table("devices").update({
        "last_sync_at": now_iso,
        **({"last_snapshot_at": latest_window.isoformat()} if latest_window else {}),
    }).eq("id", device_pk).execute()

    return SnapshotBatchUploadResponse(
        accepted=accepted, duplicates=duplicates, device_id=body.device_id, last_sync_at=now_iso,
    )

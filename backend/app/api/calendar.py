from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from app.core.security import get_current_user
from app.core.database import get_supabase_admin
from app.core.config import get_settings
from app.services.calendar_service import (
    get_google_auth_url,
    exchange_google_code,
    sync_google_calendar,
    get_outlook_auth_url,
    exchange_outlook_code,
    sync_outlook_calendar,
)

router = APIRouter(prefix="/api/calendar", tags=["Calendar"])
settings = get_settings()


# ── Google ────────────────────────────────────────────────────────────────────

@router.get("/google/connect")
async def google_connect(current: dict = Depends(get_current_user)):
    """Returns the Google OAuth URL the client should open."""
    url = get_google_auth_url(state=current["sub"])
    return {"auth_url": url}


@router.get("/google/callback")
async def google_callback(code: str, state: str, request: Request):
    """OAuth redirect endpoint — exchanges code for tokens, stores them, redirects."""
    db = get_supabase_admin()
    try:
        tokens = await exchange_google_code(code)
        # Encrypt tokens before storing (simplified — use Fernet in production)
        db.table("users").update({
            "google_token": tokens["access_token"],
            "google_refresh_token": tokens.get("refresh_token", ""),
        }).eq("id", state).execute()

        # Immediate sync
        await sync_google_calendar(state, tokens["access_token"], db)
    except Exception as e:
        return RedirectResponse(
            url=f"stressTwin://calendar?provider=google&status=error&msg={str(e)}"
        )
    return RedirectResponse(url="stressTwin://calendar?provider=google&status=connected")


@router.post("/google/sync", status_code=200)
async def google_sync(current: dict = Depends(get_current_user)):
    db = get_supabase_admin()
    uid = current["sub"]
    user = db.table("users").select("google_token").eq("id", uid).execute()
    if not user.data or not user.data[0].get("google_token"):
        raise HTTPException(status_code=400, detail="Google Calendar not connected")
    await sync_google_calendar(uid, user.data[0]["google_token"], db)
    return {"synced": True}


@router.delete("/google/disconnect", status_code=200)
async def google_disconnect(current: dict = Depends(get_current_user)):
    db = get_supabase_admin()
    db.table("users").update({"google_token": None, "google_refresh_token": None}).eq("id", current["sub"]).execute()
    return {"disconnected": True}


# ── Outlook ───────────────────────────────────────────────────────────────────

@router.get("/outlook/connect")
async def outlook_connect(current: dict = Depends(get_current_user)):
    url = get_outlook_auth_url(state=current["sub"])
    return {"auth_url": url}


@router.get("/outlook/callback")
async def outlook_callback(code: str, state: str, request: Request):
    db = get_supabase_admin()
    try:
        tokens = await exchange_outlook_code(code)
        db.table("users").update({
            "outlook_token": tokens["access_token"],
            "outlook_refresh_token": tokens.get("refresh_token", ""),
        }).eq("id", state).execute()
        await sync_outlook_calendar(state, tokens["access_token"], db)
    except Exception as e:
        return RedirectResponse(
            url=f"stressTwin://calendar?provider=outlook&status=error&msg={str(e)}"
        )
    return RedirectResponse(url="stressTwin://calendar?provider=outlook&status=connected")


@router.post("/outlook/sync", status_code=200)
async def outlook_sync(current: dict = Depends(get_current_user)):
    db = get_supabase_admin()
    uid = current["sub"]
    user = db.table("users").select("outlook_token").eq("id", uid).execute()
    if not user.data or not user.data[0].get("outlook_token"):
        raise HTTPException(status_code=400, detail="Outlook Calendar not connected")
    await sync_outlook_calendar(uid, user.data[0]["outlook_token"], db)
    return {"synced": True}


@router.delete("/outlook/disconnect", status_code=200)
async def outlook_disconnect(current: dict = Depends(get_current_user)):
    db = get_supabase_admin()
    db.table("users").update({"outlook_token": None, "outlook_refresh_token": None}).eq("id", current["sub"]).execute()
    return {"disconnected": True}


@router.get("/status")
async def calendar_status(current: dict = Depends(get_current_user)):
    db = get_supabase_admin()
    user = db.table("users").select("google_token,outlook_token").eq("id", current["sub"]).execute()
    if not user.data:
        raise HTTPException(status_code=404, detail="User not found")
    u = user.data[0]
    return {
        "google": bool(u.get("google_token")),
        "outlook": bool(u.get("outlook_token")),
    }

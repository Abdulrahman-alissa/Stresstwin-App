from fastapi import APIRouter, Depends, HTTPException
from app.core.security import get_current_user
from app.core.database import get_supabase_admin
from app.schemas.behavioral import UserProfile, UserUpdateRequest
from datetime import datetime, date, timedelta
from app.services.data_days import count_data_days

router = APIRouter(prefix="/api/users", tags=["Users"])


def _build_profile(user: dict, db) -> UserProfile:
    uid = user["id"]

    # Count days of behavioral data (exact — see services/data_days.py for why this isn't a plain select)
    days_of_data = count_data_days(db, uid)

    # Count mood check-ins
    checkins = db.table("mood_checkins").select("id", count="exact").eq("user_id", uid).execute()

    return UserProfile(
        id=uid,
        email=user["email"],
        full_name=user.get("full_name"),
        if_threshold=user.get("if_threshold", 70),
        google_connected=bool(user.get("google_token")),
        outlook_connected=bool(user.get("outlook_token")),
        if_model_ready=bool(user.get("if_model_trained_at")),
        lstm_model_ready=bool(user.get("lstm_model_trained_at")),
        created_at=user.get("created_at", ""),
        days_of_data=days_of_data,
        mood_checkins_count=checkins.count or 0,
    )


@router.get("/me", response_model=UserProfile)
async def get_profile(current: dict = Depends(get_current_user)):
    db = get_supabase_admin()
    result = db.table("users").select("*").eq("id", current["sub"]).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="User not found")
    return _build_profile(result.data[0], db)


@router.patch("/me", response_model=UserProfile)
async def update_profile(body: UserUpdateRequest, current: dict = Depends(get_current_user)):
    db = get_supabase_admin()
    updates = body.model_dump(exclude_none=True)
    if not updates:
        raise HTTPException(status_code=400, detail="Nothing to update")

    db.table("users").update(updates).eq("id", current["sub"]).execute()
    result = db.table("users").select("*").eq("id", current["sub"]).execute()
    return _build_profile(result.data[0], db)


@router.delete("/me/data", status_code=200)
async def delete_my_data(current: dict = Depends(get_current_user)):
    """GDPR Article 17 — cascade delete all user data."""
    db = get_supabase_admin()
    uid = current["sub"]
    # Cascade ON DELETE handles child tables; deleting users row removes everything.
    db.table("users").delete().eq("id", uid).execute()
    return {"deleted": True, "user_id": uid}

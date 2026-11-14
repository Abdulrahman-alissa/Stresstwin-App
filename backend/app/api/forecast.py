from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from app.core.db_retry import DatabaseUnavailable
from app.core.security import get_current_user
from app.core.database import get_supabase_admin
from app.schemas.behavioral import ForecastResponse, MoodCheckinRequest, DayForecast
from app.services.forecast_service import get_forecast_for_user
from app.services.lstm_training import request_training_check
from datetime import datetime
import uuid

router = APIRouter(prefix="/api/forecast", tags=["Forecast"])


@router.get("/3day", response_model=ForecastResponse)
async def get_3day_forecast(current: dict = Depends(get_current_user)):
    db = get_supabase_admin()
    try:
        return await get_forecast_for_user(current["sub"], db)
    except DatabaseUnavailable:
        # Real outage after retries: tell the client to try again; do not fabricate a forecast.
        raise HTTPException(status_code=503, detail="Forecast temporarily unavailable, please retry shortly",
                            headers={"Retry-After": "5"})


@router.post("/checkin", status_code=201)
async def submit_checkin(body: MoodCheckinRequest, background: BackgroundTasks, current: dict = Depends(get_current_user)):
    db = get_supabase_admin()
    uid = current["sub"]
    row = {
        "id": str(uuid.uuid4()),
        "user_id": uid,
        "rating": body.rating,
        "note": body.note,
    }
    db.table("mood_checkins").insert(row).execute()
    background.add_task(request_training_check, uid)      # may queue personal-LSTM training; never blocks the response
    return {"created": True, "rating": body.rating}

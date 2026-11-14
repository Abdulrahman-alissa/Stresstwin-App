"""
Scheduler Tasks — run via APScheduler in main.py
"""
import asyncio
from datetime import datetime
from app.core.database import get_supabase_admin
from app.ml.isolation_forest import train_user_isolation_forest
from app.services.calendar_service import sync_google_calendar, sync_outlook_calendar
from app.services.forecast_service import get_forecast_for_user


def retrain_all_isolation_forests():
    """Weekly: retrain IF models for all users with enough data."""
    print(f"[{datetime.utcnow().isoformat()}] Retraining Isolation Forest models…")
    db = get_supabase_admin()
    users = db.table("users").select("id").execute()
    success = 0
    for u in (users.data or []):
        try:
            trained = train_user_isolation_forest(u["id"], db)
            if trained:
                success += 1
        except Exception as e:
            print(f"  IF training failed for {u['id']}: {e}")
    print(f"  Done: {success}/{len(users.data or [])} models retrained")


def refresh_all_calendars():
    """Every 6 hours: sync calendars for all users with OAuth tokens."""
    print(f"[{datetime.utcnow().isoformat()}] Refreshing calendars…")
    db = get_supabase_admin()
    users = db.table("users").select("id,google_token,outlook_token").execute()
    for u in (users.data or []):
        if u.get("google_token"):
            try:
                asyncio.run(sync_google_calendar(u["id"], u["google_token"], db))
            except Exception as e:
                print(f"  Google sync failed for {u['id']}: {e}")
        if u.get("outlook_token"):
            try:
                asyncio.run(sync_outlook_calendar(u["id"], u["outlook_token"], db))
            except Exception as e:
                print(f"  Outlook sync failed for {u['id']}: {e}")
    print("  Calendar refresh done")


def refresh_all_forecasts():
    """Every 6 hours: rerun LSTM inference for all users with trained models."""
    print(f"[{datetime.utcnow().isoformat()}] Refreshing LSTM forecasts…")
    db = get_supabase_admin()
    users = db.table("users").select("id,lstm_model_trained_at").execute()
    for u in (users.data or []):
        if u.get("lstm_model_trained_at"):
            try:
                forecast = asyncio.run(get_forecast_for_user(u["id"], db))
                if forecast.model_ready and forecast.forecasts:
                    f = forecast.forecasts
                    db.table("lstm_forecasts").insert({
                        "user_id": u["id"],
                        "day1_risk": f[0].risk if len(f) > 0 else 0,
                        "day2_risk": f[1].risk if len(f) > 1 else 0,
                        "day3_risk": f[2].risk if len(f) > 2 else 0,
                    }).execute()
            except Exception as e:
                print(f"  Forecast refresh failed for {u['id']}: {e}")
    print("  Forecast refresh done")

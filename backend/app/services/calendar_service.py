"""
Calendar Service
- Google Calendar API v3 OAuth helpers
- Microsoft Graph API OAuth helpers
- Feature extraction from raw events → calendar_events table
"""
import httpx, uuid
from datetime import datetime, date, timedelta
from app.core.config import get_settings

settings = get_settings()
EXAM_KEYWORDS = {"exam", "test", "quiz", "assessment", "midterm", "final", "deadline", "submission", "due"}


# ── Google OAuth ──────────────────────────────────────────────────────────────

def get_google_auth_url(state: str) -> str:
    params = {
        "client_id": settings.google_client_id,
        "redirect_uri": settings.google_redirect_uri,
        "response_type": "code",
        "scope": "https://www.googleapis.com/auth/calendar.readonly",
        "access_type": "offline",
        "prompt": "consent",
        "state": state,
    }
    qs = "&".join(f"{k}={v}" for k, v in params.items())
    return f"https://accounts.google.com/o/oauth2/v2/auth?{qs}"


async def exchange_google_code(code: str) -> dict:
    async with httpx.AsyncClient() as client:
        resp = await client.post("https://oauth2.googleapis.com/token", data={
            "client_id": settings.google_client_id,
            "client_secret": settings.google_client_secret,
            "redirect_uri": settings.google_redirect_uri,
            "grant_type": "authorization_code",
            "code": code,
        })
        resp.raise_for_status()
        return resp.json()


async def sync_google_calendar(uid: str, access_token: str, db) -> int:
    today = date.today()
    time_min = datetime.combine(today, datetime.min.time()).isoformat() + "Z"
    time_max = datetime.combine(today + timedelta(days=14), datetime.min.time()).isoformat() + "Z"

    async with httpx.AsyncClient() as client:
        resp = await client.get(
            "https://www.googleapis.com/calendar/v3/calendars/primary/events",
            headers={"Authorization": f"Bearer {access_token}"},
            params={
                "timeMin": time_min,
                "timeMax": time_max,
                "singleEvents": "true",
                "orderBy": "startTime",
                "maxResults": 250,
            },
            timeout=15,
        )
        if resp.status_code == 401:
            db.table("users").update({"google_token": None}).eq("id", uid).execute()
            return 0
        resp.raise_for_status()
        items = resp.json().get("items", [])

    return _upsert_calendar_features(uid, items, db)


# ── Outlook / Microsoft Graph OAuth ──────────────────────────────────────────

def get_outlook_auth_url(state: str) -> str:
    params = {
        "client_id": settings.microsoft_client_id,
        "redirect_uri": settings.microsoft_redirect_uri,
        "response_type": "code",
        "scope": "Calendars.Read offline_access",
        "state": state,
        "response_mode": "query",
    }
    qs = "&".join(f"{k}={v}" for k, v in params.items())
    return f"https://login.microsoftonline.com/{settings.microsoft_tenant_id}/oauth2/v2.0/authorize?{qs}"


async def exchange_outlook_code(code: str) -> dict:
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"https://login.microsoftonline.com/{settings.microsoft_tenant_id}/oauth2/v2.0/token",
            data={
                "client_id": settings.microsoft_client_id,
                "client_secret": settings.microsoft_client_secret,
                "redirect_uri": settings.microsoft_redirect_uri,
                "grant_type": "authorization_code",
                "code": code,
                "scope": "Calendars.Read offline_access",
            },
        )
        resp.raise_for_status()
        return resp.json()


async def sync_outlook_calendar(uid: str, access_token: str, db) -> int:
    today = date.today()
    start = datetime.combine(today, datetime.min.time()).isoformat()
    end = datetime.combine(today + timedelta(days=14), datetime.min.time()).isoformat()

    async with httpx.AsyncClient() as client:
        resp = await client.get(
            "https://graph.microsoft.com/v1.0/me/calendarView",
            headers={"Authorization": f"Bearer {access_token}"},
            params={"startDateTime": start, "endDateTime": end, "$top": 250},
            timeout=15,
        )
        if resp.status_code == 401:
            db.table("users").update({"outlook_token": None}).eq("id", uid).execute()
            return 0
        resp.raise_for_status()
        items = resp.json().get("value", [])

    # Normalize to Google-style dict
    normalized = []
    for ev in items:
        normalized.append({
            "summary": ev.get("subject", ""),
            "start": {"dateTime": ev.get("start", {}).get("dateTime", "")},
            "end": {"dateTime": ev.get("end", {}).get("dateTime", "")},
        })
    return _upsert_calendar_features(uid, normalized, db)


# ── Feature extraction ────────────────────────────────────────────────────────

def _upsert_calendar_features(uid: str, items: list, db) -> int:
    """Extract 6 features per day from raw events and upsert to calendar_events."""
    today = date.today()
    daily: dict[date, dict] = {}

    for ev in items:
        start_str = (ev.get("start") or {}).get("dateTime") or (ev.get("start") or {}).get("date") or ""
        end_str = (ev.get("end") or {}).get("dateTime") or (ev.get("end") or {}).get("date") or ""
        title = (ev.get("summary") or "").lower()

        if not start_str:
            continue
        try:
            start_dt = datetime.fromisoformat(start_str.replace("Z", "+00:00"))
            end_dt = datetime.fromisoformat(end_str.replace("Z", "+00:00")) if end_str else start_dt + timedelta(hours=1)
        except Exception:
            continue

        ev_date = start_dt.date()
        if ev_date < today or ev_date > today + timedelta(days=13):
            continue

        day = daily.setdefault(ev_date, {
            "meetings": 0,
            "hours": 0.0,
            "earliest_hour": None,
            "exam": False,
        })
        day["meetings"] += 1
        day["hours"] += (end_dt - start_dt).total_seconds() / 3600
        h = start_dt.hour + start_dt.minute / 60
        if day["earliest_hour"] is None or h < day["earliest_hour"]:
            day["earliest_hour"] = h
        if any(kw in title for kw in EXAM_KEYWORDS):
            day["exam"] = True

    # Compute cross-day features
    sorted_dates = sorted(daily.keys())
    LOAD_THRESHOLD = 4.0  # hours

    def days_to_next_free(from_date: date) -> int:
        d, count = from_date + timedelta(days=1), 0
        while count < 14:
            if d not in daily or daily[d]["hours"] < LOAD_THRESHOLD:
                return count
            d += timedelta(days=1)
            count += 1
        return count

    def consecutive_loaded(from_date: date) -> int:
        count, d = 0, from_date
        while d in daily and daily[d]["hours"] >= LOAD_THRESHOLD:
            count += 1
            d += timedelta(days=1)
        return count

    upserted = 0
    for d, info in daily.items():
        row = {
            "id": str(uuid.uuid4()),
            "user_id": uid,
            "event_date": d.isoformat(),
            "exam_flag": info["exam"],
            "meeting_density": info["meetings"],
            "earliest_start_norm": round((info["earliest_hour"] or 9) / 24, 4),
            "total_committed_hours": round(info["hours"], 2),
            "consecutive_loaded_days": consecutive_loaded(d),
            "days_to_next_free": days_to_next_free(d),
            "synced_at": datetime.utcnow().isoformat(),
        }
        db.table("calendar_events").upsert(row, on_conflict="user_id,event_date").execute()
        upserted += 1

    return upserted

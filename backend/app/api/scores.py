from fastapi import APIRouter, Depends, Query
from app.core.security import get_current_user
from app.core.database import get_supabase_admin
from app.schemas.behavioral import ScoreHistoryItem
from datetime import datetime, timedelta, date

router = APIRouter(prefix="/api/scores", tags=["Scores"])


@router.get("/current")
async def get_current_score(current: dict = Depends(get_current_user)):
    db = get_supabase_admin()
    uid = current["sub"]

    # Latest score
    latest = (
        db.table("if_scores")
        .select("deviation_score,threshold_crossed,created_at")
        .eq("user_id", uid)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )

    # Last 60-minute trend (120 windows max)
    since = (datetime.utcnow() - timedelta(hours=1)).isoformat()
    trend = (
        db.table("if_scores")
        .select("deviation_score,created_at")
        .eq("user_id", uid)
        .gte("created_at", since)
        .order("created_at")
        .execute()
    )

    current_score = None
    if latest.data:
        current_score = {
            "deviation_score": latest.data[0]["deviation_score"],
            "threshold_crossed": latest.data[0]["threshold_crossed"],
            "recorded_at": latest.data[0]["created_at"],
        }

    return {
        "current": current_score,
        "trend": [
            {"score": r["deviation_score"], "at": r["created_at"]}
            for r in (trend.data or [])
        ],
    }


@router.get("/history")
async def get_score_history(
    days: int = Query(default=30, ge=1, le=90),
    current: dict = Depends(get_current_user),
):
    db = get_supabase_admin()
    uid = current["sub"]
    since = (datetime.utcnow() - timedelta(days=days)).isoformat()

    rows = (
        db.table("if_scores")
        .select("deviation_score,created_at")
        .eq("user_id", uid)
        .gte("created_at", since)
        .order("created_at")
        .execute()
    )

    # Aggregate by day
    daily: dict[str, list[float]] = {}
    for r in (rows.data or []):
        day = r["created_at"][:10]
        daily.setdefault(day, []).append(float(r["deviation_score"]))

    history = [
        ScoreHistoryItem(
            date=day,
            mean_score=round(sum(scores) / len(scores), 1),
            max_score=round(max(scores), 1),
            sample_count=len(scores),
        )
        for day, scores in sorted(daily.items())
    ]

    return {"history": history, "days": days}

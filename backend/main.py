from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from apscheduler.schedulers.background import BackgroundScheduler
from contextlib import asynccontextmanager

from app.core.config import get_settings
from app.api import auth, users, events, scores, forecast, calendar, devices
from app.services.lstm_training import schedule_personal_lstm_training
from app.services.scheduler_tasks import (
    retrain_all_isolation_forests,
    refresh_all_calendars,
    refresh_all_forecasts,
)

settings = get_settings()
scheduler = BackgroundScheduler()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # ── Start background scheduler ──
    scheduler.add_job(refresh_all_calendars,    "interval", hours=6,   id="cal_sync")
    scheduler.add_job(refresh_all_forecasts,    "interval", hours=6,   id="lstm_refresh")
    scheduler.add_job(retrain_all_isolation_forests, "interval", weeks=1, id="if_retrain")
    # queues background training of personal LSTMs for users who became eligible (or need a retrain)
    scheduler.add_job(schedule_personal_lstm_training, "interval", hours=1, id="lstm_autotrain", max_instances=1, coalesce=True)
    scheduler.start()
    print("✅  Scheduler started")
    yield
    scheduler.shutdown()
    print("🛑  Scheduler stopped")


app = FastAPI(
    title="StressTwin API",
    version="1.0.0",
    description="AI-powered behavioral stress detection and calendar-aware prediction.",
    lifespan=lifespan,
)

# ── CORS ──────────────────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routers ───────────────────────────────────────────────────────────────────
app.include_router(auth.router)
app.include_router(users.router)
app.include_router(events.router)
app.include_router(scores.router)
app.include_router(forecast.router)
app.include_router(calendar.router)
app.include_router(devices.router)


# ── Health ────────────────────────────────────────────────────────────────────
@app.get("/")
async def root():
    return {"service": "StressTwin API", "version": "1.0.0", "status": "running"}


@app.get("/health")
async def health():
    return {"status": "ok"}

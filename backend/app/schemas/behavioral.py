from pydantic import BaseModel, Field
from typing import Optional, Literal
from datetime import datetime


# ── Behavioral ────────────────────────────────────────────────────────────────
class BehavioralFeatures(BaseModel):
    platform: Literal["desktop", "android", "ios"]
    window_start: datetime
    device_id: Optional[str] = None    # client-generated device UUID (see /api/devices) — lets legacy desktop batches show up on the device dashboard too
    keystroke_mean: Optional[float] = None
    keystroke_std: Optional[float] = None
    error_rate: Optional[float] = Field(None, ge=0, le=1)
    mouse_velocity: Optional[float] = None
    mouse_smoothness: Optional[float] = Field(None, ge=0, le=1)
    click_hesitation: Optional[float] = None
    touch_pressure: Optional[float] = None
    gyro_variance: Optional[float] = None
    idle_frequency: Optional[float] = None
    app_switch_rate: Optional[float] = None
    session_duration: int = 30


class BatchRequest(BaseModel):
    features: BehavioralFeatures


# ── Devices ───────────────────────────────────────────────────────────────────
class DeviceRegisterRequest(BaseModel):
    device_id: str                      # stable client-generated UUID, persisted on-device
    platform: Literal["desktop", "android", "ios"]
    display_name: str = "Unknown device"


class DeviceOut(BaseModel):
    id: str
    device_id: str
    platform: Literal["desktop", "android", "ios"]
    display_name: str
    keyboard_active: bool
    last_snapshot_at: Optional[str] = None
    last_sync_at: Optional[str] = None
    status: Literal["sending", "stale", "inactive"]


class DeviceHeartbeatRequest(BaseModel):
    keyboard_active: Optional[bool] = None


class DeviceStat(BaseModel):
    device_id: str
    display_name: str
    platform: Literal["desktop", "android", "ios"]
    status: Literal["sending", "stale", "inactive"]
    last_snapshot_at: Optional[str] = None
    windows: int = 0
    active_minutes: float = 0
    mean_score: Optional[float] = None
    max_score: Optional[float] = None
    metrics: dict[str, Optional[float]] = {}


class AverageStat(BaseModel):
    devices_counted: int = 0
    windows: int = 0
    active_minutes: float = 0
    mean_score: Optional[float] = None
    metrics: dict[str, Optional[float]] = {}
    devices_reporting: dict[str, int] = {}


class DeviceStatsResponse(BaseModel):
    hours: int
    generated_at: str
    devices: list[DeviceStat]
    average: AverageStat


# ── Keyboard behavioral snapshots (15s local aggregation) ─────────────────────
class KeyboardSnapshot(BaseModel):
    """
    One 15-second local aggregation window produced by the StressTwin custom
    keyboard (Android InputMethodService / iOS Keyboard Extension).

    IMPORTANT: this model intentionally has no field for typed text/content.
    Only statistical/behavioral features are ever transmitted.
    """
    client_snapshot_id: str             # UUID generated on-device, used for de-duplication
    window_start: datetime
    typing_speed_cps: Optional[float] = None
    inter_key_interval_ms: Optional[float] = None
    backspace_rate: Optional[float] = Field(None, ge=0, le=1)
    correction_rate: Optional[float] = Field(None, ge=0, le=1)
    pause_frequency: Optional[float] = None
    typing_bursts: Optional[int] = None
    typing_interruptions: Optional[int] = None
    char_count: Optional[int] = None    # count only — never the characters themselves
    session_duration: int = 15


class SnapshotBatchUploadRequest(BaseModel):
    """Payload for the ~10-minute batched upload from a device's local buffer."""
    device_id: str
    platform: Literal["android", "ios", "desktop"]
    source: Literal["mobile_keyboard", "mobile_sensor", "desktop_sensor"] = "mobile_keyboard"
    snapshots: list[KeyboardSnapshot]


class SnapshotBatchUploadResponse(BaseModel):
    accepted: int
    duplicates: int
    device_id: str
    last_sync_at: str


class ScoreResponse(BaseModel):
    deviation_score: float
    threshold_crossed: bool
    intervention_type: Optional[str] = None
    model_ready: bool
    log_id: Optional[str] = None
    score_id: Optional[str] = None


class ScoreHistoryItem(BaseModel):
    date: str
    mean_score: float
    max_score: float
    sample_count: int


# ── Forecast ──────────────────────────────────────────────────────────────────
class DayForecast(BaseModel):
    date: str
    risk: float
    risk_label: str
    primary_stressor: Optional[str] = None
    recommendation: Optional[str] = None


class ForecastResponse(BaseModel):
    model_ready: bool
    days_until_ready: Optional[int] = None
    forecasts: list[DayForecast] = []
    generated_at: Optional[str] = None
    # What the forecast is built on (real counts). The old fixed `confidence` number was a
    # constant, not a model output, so it is gone; kept as Optional for older clients.
    confidence: Optional[float] = None
    # "personal" = the user's own LSTM, "global" = starter estimate from everyone's weekday patterns + own level + calendar
    source: Literal["personal", "global", "none"] = "none"
    personal_ready: bool = False
    cohort_size: int = 0
    days_of_data: int = 0
    checkins_count: int = 0
    days_needed: int = 28
    checkins_needed: int = 20


class MoodCheckinRequest(BaseModel):
    rating: int = Field(..., ge=1, le=5)
    note: Optional[str] = None


# ── Calendar ──────────────────────────────────────────────────────────────────
class CalendarSyncRequest(BaseModel):
    provider: Literal["google", "outlook"]
    auth_code: str


class CalendarEventOut(BaseModel):
    event_date: str
    exam_flag: bool
    meeting_density: float
    total_committed_hours: float
    days_to_next_free: int


# ── Users ─────────────────────────────────────────────────────────────────────
class UserUpdateRequest(BaseModel):
    full_name: Optional[str] = None
    if_threshold: Optional[int] = Field(None, ge=30, le=95)


class UserProfile(BaseModel):
    id: str
    email: str
    full_name: Optional[str] = None
    if_threshold: int
    google_connected: bool
    outlook_connected: bool
    if_model_ready: bool
    lstm_model_ready: bool
    created_at: str
    days_of_data: int = 0
    mood_checkins_count: int = 0

# app/schemas/__init__.py
#
# NOTE: earlier versions of this file imported from app.schemas.forecast,
# app.schemas.calendar, and app.schemas.users — none of which exist as
# separate modules; every one of those classes actually lives in either
# auth.py or behavioral.py (confirmed against every `from app.schemas.X
# import ...` used across app/api/*.py). That mismatch made importing this
# package raise ModuleNotFoundError, which — since Python always runs a
# package's __init__.py before any of its submodules — broke booting the
# app entirely, even though every individual router imported its schemas
# via a direct submodule path (e.g. `from app.schemas.behavioral import
# ...`) and never actually used this __init__.py's re-exports.
from .auth import RegisterRequest, LoginRequest, TokenResponse, UserOut
from .behavioral import (
    BehavioralFeatures, ScoreResponse, ScoreHistoryItem,
    ForecastResponse, MoodCheckinRequest, DayForecast,
    CalendarSyncRequest, CalendarEventOut,
    UserUpdateRequest, UserProfile,
    DeviceRegisterRequest, DeviceOut, DeviceHeartbeatRequest,
    KeyboardSnapshot, SnapshotBatchUploadRequest, SnapshotBatchUploadResponse,
)

__all__ = [
    "RegisterRequest", "LoginRequest", "TokenResponse", "UserOut",
    "BehavioralFeatures", "ScoreResponse", "ScoreHistoryItem",
    "ForecastResponse", "MoodCheckinRequest", "DayForecast",
    "CalendarSyncRequest", "CalendarEventOut",
    "UserUpdateRequest", "UserProfile",
    "DeviceRegisterRequest", "DeviceOut", "DeviceHeartbeatRequest",
    "KeyboardSnapshot", "SnapshotBatchUploadRequest", "SnapshotBatchUploadResponse",
]

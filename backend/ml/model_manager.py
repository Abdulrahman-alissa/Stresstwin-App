"""
Model Manager
=============
The single place that knows how model *files* get from a training job onto
disk for inference, and how model *versions* get tracked in Postgres.

Storage
-------
Trained model files (.joblib / .pt) are never committed to git and never
shipped in the Docker/Render build. They live in a Supabase Storage bucket
(`ML_STORAGE_BUCKET`, default "ml-models") and are downloaded on first use
into a local on-disk cache (`ML_MODEL_CACHE_DIR`, default
"ml/models/saved/") so repeated requests don't re-download every time.
The cache directory is in .gitignore.

    tier0/prior/v{n}.json                          — population prior (plain JSON, no model weights)
    tier1/baseline/v{n}/model.joblib                — Global Behavioral Baseline
    global/lstm/v{n}/model.pt                       — Tier 2 Global Sequence LSTM
    personal/{user_id}/lstm/v{n}/model.pt
    personal/{user_id}/isolation_forest/v{n}.joblib

Versioning
----------
Every trained model — global or personal — gets a row in `model_versions`
(supabase/migrations/002_ml_model_versioning.sql,
003_global_tiers.sql) recording its storage path, validation metrics,
training sample count, and status. Activating a version archives the
previous active version for that (model_type, user_id) pair, so "the
active model" is always a single, unambiguous row.

Per-user routing (which LSTM a user's forecast actually uses — their own
personalized model, or one of the three global fallback tiers) is tracked
in `user_model_status`, updated by ml/training/train_personal.py, and
resolved at request time by ml/inference.py::forecast().
"""
from __future__ import annotations
import hashlib
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal, Optional

import joblib

from ml.models.isolation_forest import PersonalIsolationForest
from ml.models.global_baseline import GlobalBehavioralBaseline
from ml.models.lstm import StressLSTM

ModelType = Literal["global_prior", "global_baseline", "global_lstm", "personal_lstm", "personal_if"]

LOCAL_CACHE_DIR = Path(os.getenv("ML_MODEL_CACHE_DIR", "ml/models/saved"))
STORAGE_BUCKET = os.getenv("ML_STORAGE_BUCKET", "ml-models")


class ModelManager:
    """
    Wraps a Supabase client (service-role — pass the result of
    `app.core.database.get_supabase_admin()`) plus a local disk cache.
    """

    def __init__(self, db, cache_dir: Path = LOCAL_CACHE_DIR, bucket: str = STORAGE_BUCKET):
        self.db = db
        self.cache_dir = Path(cache_dir)
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.bucket = bucket

    # ── storage path scheme ──────────────────────────────────────────────────
    @staticmethod
    def storage_path(model_type: ModelType, user_id: Optional[str], version: int) -> str:
        if model_type == "global_prior":
            return f"tier0/prior/v{version}.json"
        if model_type == "global_baseline":
            return f"tier1/baseline/v{version}/model.joblib"
        if model_type == "global_lstm":
            return f"global/lstm/v{version}/model.pt"
        if model_type == "personal_lstm":
            return f"personal/{user_id}/lstm/v{version}/model.pt"
        if model_type == "personal_if":
            return f"personal/{user_id}/isolation_forest/v{version}.joblib"
        raise ValueError(f"Unknown model_type: {model_type}")

    def _local_path(self, storage_path: str) -> Path:
        p = self.cache_dir / storage_path
        p.parent.mkdir(parents=True, exist_ok=True)
        return p

    @staticmethod
    def _checksum(data: bytes) -> str:
        return hashlib.sha256(data).hexdigest()

    # ── low-level Supabase Storage I/O ───────────────────────────────────────
    def _download_bytes(self, storage_path: str) -> bytes:
        local = self._local_path(storage_path)
        if local.exists():
            return local.read_bytes()
        data = self.db.storage.from_(self.bucket).download(storage_path)
        local.write_bytes(data)
        return data

    def _upload_bytes(self, storage_path: str, data: bytes) -> None:
        local = self._local_path(storage_path)
        local.write_bytes(data)
        try:
            self.db.storage.from_(self.bucket).upload(
                storage_path,
                data,
                {"content-type": "application/octet-stream", "upsert": "true"},
            )
        except Exception as e:
            # Common on first upload of a brand-new nested path with some
            # supabase-py versions; retry once via update() if upload() fails
            # because the object already exists.
            try:
                self.db.storage.from_(self.bucket).update(
                    storage_path, data, {"content-type": "application/octet-stream"}
                )
            except Exception:
                raise RuntimeError(f"Failed to upload {storage_path} to bucket {self.bucket}: {e}")

    # ── version bookkeeping (model_versions table) ───────────────────────────
    def _next_version(self, model_type: ModelType, user_id: Optional[str]) -> int:
        q = self.db.table("model_versions").select("version").eq("model_type", model_type)
        q = q.is_("user_id", "null") if user_id is None else q.eq("user_id", user_id)
        res = q.order("version", desc=True).limit(1).execute()
        return (res.data[0]["version"] + 1) if res.data else 1

    def _archive_previous_active(self, model_type: ModelType, user_id: Optional[str], keep_id: str) -> None:
        q = (
            self.db.table("model_versions")
            .update({"status": "archived"})
            .eq("model_type", model_type)
            .eq("status", "active")
            .neq("id", keep_id)
        )
        q = q.is_("user_id", "null") if user_id is None else q.eq("user_id", user_id)
        q.execute()

    def register_version(
        self,
        model_type: ModelType,
        data: bytes,
        *,
        user_id: Optional[str] = None,
        training_samples: Optional[int] = None,
        metrics: Optional[dict] = None,
        activate: bool = True,
    ) -> dict:
        version = self._next_version(model_type, user_id)
        path = self.storage_path(model_type, user_id, version)
        self._upload_bytes(path, data)

        row = {
            "model_type": model_type,
            "user_id": user_id,
            "version": version,
            "status": "active" if activate else "validating",
            "storage_bucket": self.bucket,
            "storage_path": path,
            "file_checksum": self._checksum(data),
            "training_samples": training_samples,
            "validation_metrics": metrics or {},
            "training_completed_at": datetime.now(timezone.utc).isoformat(),
        }
        if activate:
            row["activated_at"] = datetime.now(timezone.utc).isoformat()

        inserted = self.db.table("model_versions").insert(row).execute()
        version_row = inserted.data[0]

        if activate:
            self._archive_previous_active(model_type, user_id, keep_id=version_row["id"])
        return version_row

    def get_active_version(self, model_type: ModelType, user_id: Optional[str] = None) -> Optional[dict]:
        q = self.db.table("model_versions").select("*").eq("model_type", model_type).eq("status", "active")
        q = q.is_("user_id", "null") if user_id is None else q.eq("user_id", user_id)
        res = q.order("version", desc=True).limit(1).execute()
        return res.data[0] if res.data else None

    # ── typed save/load helpers ──────────────────────────────────────────────
    def save_isolation_forest(self, uid: str, model: PersonalIsolationForest, *, training_samples: int) -> dict:
        version_row = self.register_version(
            "personal_if",
            model.to_bytes(),
            user_id=uid,
            training_samples=training_samples,
            metrics={"n_samples_trained_on": model.n_samples_trained_on},
        )
        self._upsert_user_model_status(uid, {
            "if_active_version_id": version_row["id"],
            "if_status": "active",
            "if_trained_at": datetime.now(timezone.utc).isoformat(),
            "if_training_samples": training_samples,
        })
        # Back-compat with the original `users.if_model_trained_at` column
        self.db.table("users").update({
            "if_model_trained_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", uid).execute()
        return version_row

    def load_isolation_forest(self, uid: str) -> tuple[Optional[PersonalIsolationForest], Optional[dict]]:
        version_row = self.get_active_version("personal_if", uid)
        if not version_row:
            return None, None
        data = self._download_bytes(version_row["storage_path"])
        return PersonalIsolationForest.from_bytes(data), version_row

    def save_global_lstm(self, model: StressLSTM, *, training_samples: int, metrics: dict) -> dict:
        return self.register_version(
            "global_lstm", model.to_bytes(), user_id=None,
            training_samples=training_samples, metrics=metrics, activate=True,
        )

    def save_personal_lstm(self, uid: str, model: StressLSTM, *, training_samples: int, metrics: dict) -> dict:
        version_row = self.register_version(
            "personal_lstm", model.to_bytes(), user_id=uid,
            training_samples=training_samples, metrics=metrics, activate=True,
        )
        self._upsert_user_model_status(uid, {
            "lstm_active_version_id": version_row["id"],
            "lstm_mode": "personal",
            "lstm_personalized_at": datetime.now(timezone.utc).isoformat(),
            "lstm_training_samples": training_samples,
        })
        self.db.table("users").update({
            "lstm_model_trained_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", uid).execute()
        return version_row

    def load_lstm_state(self, model_type: ModelType, user_id: Optional[str] = None) -> tuple[Optional[dict], Optional[dict]]:
        import torch
        import io

        version_row = self.get_active_version(model_type, user_id)
        if not version_row:
            return None, None
        data = self._download_bytes(version_row["storage_path"])
        state = torch.load(io.BytesIO(data), map_location="cpu")
        return state, version_row

    # ── Tier 0: population prior (plain JSON, no model weights) ─────────────
    def save_global_prior(self, weekday_prior: dict, *, training_samples: int) -> dict:
        data = json.dumps(weekday_prior).encode("utf-8")
        return self.register_version(
            "global_prior", data, user_id=None,
            training_samples=training_samples, metrics={"weekday_prior": weekday_prior}, activate=True,
        )

    def get_global_prior(self) -> tuple[Optional[dict], Optional[dict]]:
        """
        Returns the (weekday -> mean population stress) lookup table — a
        real statistic from StudentLife's daily "Stress" EMA responses
        (ml.training.train_global_prior), not a model prediction. Genuinely
        weekday-varying, since the EMA is answered many times across many
        days per participant (unlike PSS-10, which is only pre/post and
        would force a flat prior — see ml/training/prepare_studentlife.py
        for why PSS-10 was replaced as the primary label here). This is
        Tier 0: the absolute last-resort fallback, used only when a user
        has zero behavioral windows AND zero calendar data yet (see
        ml/inference.py). As soon as any real data exists for a user,
        Tier 1 (get_active_version("global_baseline")) takes over
        instead, since it can score that user's own real data.
        """
        version_row = self.get_active_version("global_prior")
        if not version_row:
            return None, None
        prior = (version_row.get("validation_metrics") or {}).get("weekday_prior")
        return prior, version_row

    # ── Tier 1: Global Behavioral Baseline ──────────────────────────────────
    def save_global_baseline(self, model: GlobalBehavioralBaseline, *, training_samples: int, metrics: dict) -> dict:
        return self.register_version(
            "global_baseline", model.to_bytes(), user_id=None,
            training_samples=training_samples, metrics=metrics, activate=True,
        )

    def load_global_baseline(self) -> tuple[Optional[GlobalBehavioralBaseline], Optional[dict]]:
        version_row = self.get_active_version("global_baseline")
        if not version_row:
            return None, None
        data = self._download_bytes(version_row["storage_path"])
        return GlobalBehavioralBaseline.from_bytes(data), version_row

    # ── Tier 2: Global Sequence LSTM (Personal 11-feature schema) ───────────
    def save_global_lstm(self, model: StressLSTM, *, training_samples: int, metrics: dict) -> dict:
        return self.register_version(
            "global_lstm", model.to_bytes(), user_id=None,
            training_samples=training_samples, metrics=metrics, activate=True,
        )

    def save_personal_lstm(self, uid: str, model: StressLSTM, *, training_samples: int, metrics: dict) -> dict:
        version_row = self.register_version(
            "personal_lstm", model.to_bytes(), user_id=uid,
            training_samples=training_samples, metrics=metrics, activate=True,
        )
        self._upsert_user_model_status(uid, {
            "lstm_active_version_id": version_row["id"],
            "lstm_mode": "personal",
            "lstm_personalized_at": datetime.now(timezone.utc).isoformat(),
            "lstm_training_samples": training_samples,
        })
        self.db.table("users").update({
            "lstm_model_trained_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", uid).execute()
        return version_row

    # ── user_model_status upsert ─────────────────────────────────────────────
    def _upsert_user_model_status(self, uid: str, fields: dict) -> None:
        existing = self.db.table("user_model_status").select("user_id").eq("user_id", uid).execute()
        fields = {**fields, "updated_at": datetime.now(timezone.utc).isoformat()}
        if existing.data:
            self.db.table("user_model_status").update(fields).eq("user_id", uid).execute()
        else:
            self.db.table("user_model_status").insert({"user_id": uid, **fields}).execute()

    def get_user_model_status(self, uid: str) -> Optional[dict]:
        res = self.db.table("user_model_status").select("*").eq("user_id", uid).execute()
        return res.data[0] if res.data else None

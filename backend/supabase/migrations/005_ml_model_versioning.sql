-- ════════════════════════════════════════════════════════════════════════════
-- StressTwin  ·  002_ml_model_versioning.sql
-- Global LSTM + personalization: model versioning, training status,
-- validation metrics, and per-user model assignment.
-- Run this in Supabase SQL Editor AFTER 001_initial_schema.sql.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. model_versions ────────────────────────────────────────────────────────
-- One row per *trained artifact*, whether it's the shared global LSTM, a
-- user's personalized LSTM fine-tune, or a user's personal Isolation Forest.
-- The actual weights file lives in Supabase Storage (bucket/path recorded
-- here); this table is metadata + versioning only.
--
-- NOTE: plain PostgreSQL has no `CREATE TYPE ... IF NOT EXISTS`, so enum
-- creation is wrapped in a guarded DO block to make this migration safely
-- re-runnable (matches the idempotent style of every other statement here).
DO $$ BEGIN
    CREATE TYPE ml_model_type_enum AS ENUM ('global_lstm', 'personal_lstm', 'personal_if');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE ml_model_status_enum AS ENUM (
        'pending', 'training', 'validating', 'active', 'failed', 'archived'
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.model_versions (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    model_type              ml_model_type_enum NOT NULL,
    -- NULL user_id = the global model. Non-null = a personal model owned by that user.
    user_id                 UUID REFERENCES public.users(id) ON DELETE CASCADE,
    version                 INT NOT NULL,
    status                  ml_model_status_enum NOT NULL DEFAULT 'pending',
    storage_bucket          TEXT NOT NULL DEFAULT 'ml-models',
    storage_path            TEXT NOT NULL,
    file_checksum           TEXT,
    training_samples        INT,
    validation_metrics      JSONB NOT NULL DEFAULT '{}'::jsonb,
    training_started_at     TIMESTAMPTZ,
    training_completed_at   TIMESTAMPTZ,
    activated_at            TIMESTAMPTZ,
    notes                   TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (model_type, user_id, version)
);

-- Global rows have user_id IS NULL, and Postgres treats NULLs as distinct for
-- UNIQUE constraints, so the UNIQUE above alone would allow duplicate
-- (model_type, version) global rows. Enforce global uniqueness explicitly:
CREATE UNIQUE INDEX IF NOT EXISTS uq_model_versions_global
    ON public.model_versions (model_type, version)
    WHERE user_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_model_versions_active
    ON public.model_versions (model_type, user_id, status)
    WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_model_versions_user
    ON public.model_versions (user_id, model_type, version DESC);

-- ── 2. user_model_status ─────────────────────────────────────────────────────
-- One row per user: which model versions are currently assigned to them and
-- what state their personal training pipeline is in. This is what
-- ml.model_manager.ModelManager.resolve_lstm_for_user() reads to decide
-- personal-vs-global fallback, and what /api/users/me surfaces to the client.
DO $$ BEGIN
    CREATE TYPE if_training_status_enum AS ENUM (
        'cold_start', 'training', 'active', 'stale', 'failed'
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE lstm_mode_enum AS ENUM ('global', 'personal');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.user_model_status (
    user_id                 UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,

    if_active_version_id    UUID REFERENCES public.model_versions(id) ON DELETE SET NULL,
    if_status               if_training_status_enum NOT NULL DEFAULT 'cold_start',
    if_trained_at           TIMESTAMPTZ,
    if_training_samples     INT,

    lstm_mode               lstm_mode_enum NOT NULL DEFAULT 'global',
    lstm_active_version_id  UUID REFERENCES public.model_versions(id) ON DELETE SET NULL,
    lstm_personalized_at    TIMESTAMPTZ,
    lstm_training_samples   INT,

    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_user_model_status_updated_at
    BEFORE UPDATE ON public.user_model_status
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── 3. Supporting columns on existing tables ────────────────────────────────

-- Consent to include a user's anonymized data in the global LSTM's training
-- pool (ml.training.dataset.export_anonymized_training_frame reads this).
ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS consent_share_data BOOLEAN NOT NULL DEFAULT false;

-- Track which model version produced each score / forecast, for drift
-- monitoring and so a user's history remains interpretable across retrains.
ALTER TABLE public.if_scores
    ADD COLUMN IF NOT EXISTS model_version INT;

ALTER TABLE public.lstm_forecasts
    ADD COLUMN IF NOT EXISTS model_source  TEXT CHECK (model_source IN ('personal', 'global')),
    ADD COLUMN IF NOT EXISTS model_version INT;

-- ═════════════════════════════════════════
-- Row Level Security
-- ═════════════════════════════════════════

ALTER TABLE public.model_versions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_model_status ENABLE ROW LEVEL SECURITY;

-- Users may see their own personal model versions, and the metadata of any
-- *active* global model (so a client could show "forecast powered by global
-- model v3" without needing service-role access). They can never see other
-- users' personal model rows.
CREATE POLICY "model_versions_own_or_global" ON public.model_versions
    FOR SELECT
    USING (
        user_id = auth.uid()
        OR (user_id IS NULL AND status = 'active')
    );

CREATE POLICY "user_model_status_own" ON public.user_model_status
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

-- All writes to both tables happen via the service-role client
-- (get_supabase_admin()) from training jobs / the scheduler, which bypasses
-- RLS by design — no INSERT/UPDATE/DELETE policies are needed for the anon role.

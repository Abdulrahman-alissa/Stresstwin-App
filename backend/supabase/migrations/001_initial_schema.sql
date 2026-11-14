-- ════════════════════════════════════════════════════════════════════════════
-- StressTwin  ·  001_initial_schema.sql
-- Run this in Supabase SQL Editor → New query → Run
-- ════════════════════════════════════════════════════════════════════════════

-- Enable pgcrypto for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── 1. users ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.users (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email                 TEXT UNIQUE NOT NULL,
    password_hash         TEXT NOT NULL,
    full_name             TEXT,
    if_threshold          INT  NOT NULL DEFAULT 70,
    if_model_trained_at   TIMESTAMPTZ,
    lstm_model_trained_at TIMESTAMPTZ,
    google_token          TEXT,          -- AES-256 encrypted at app layer
    outlook_token         TEXT,          -- AES-256 encrypted at app layer
    google_refresh_token  TEXT,
    outlook_refresh_token TEXT,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 2. behavioral_logs ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.behavioral_logs (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    window_start        TIMESTAMPTZ NOT NULL,
    platform            TEXT NOT NULL CHECK (platform IN ('desktop','android','ios')),
    keystroke_mean      NUMERIC,
    keystroke_std       NUMERIC,
    error_rate          NUMERIC CHECK (error_rate IS NULL OR (error_rate >= 0 AND error_rate <= 1)),
    mouse_velocity      NUMERIC,
    mouse_smoothness    NUMERIC CHECK (mouse_smoothness IS NULL OR (mouse_smoothness >= 0 AND mouse_smoothness <= 1)),
    click_hesitation    NUMERIC,
    touch_pressure      NUMERIC,
    gyro_variance       NUMERIC,
    idle_frequency      NUMERIC,
    app_switch_rate     NUMERIC,
    session_duration    INT NOT NULL DEFAULT 30
);
CREATE INDEX IF NOT EXISTS idx_behavioral_logs_user_time
    ON public.behavioral_logs(user_id, window_start DESC);

-- ── 3. if_scores ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.if_scores (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    log_id            UUID REFERENCES public.behavioral_logs(id) ON DELETE SET NULL,
    deviation_score   NUMERIC(5,2) NOT NULL CHECK (deviation_score >= 0 AND deviation_score <= 100),
    threshold_crossed BOOLEAN NOT NULL DEFAULT false,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_if_scores_user_time
    ON public.if_scores(user_id, created_at DESC);

-- ── 4. mood_checkins ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.mood_checkins (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    rating     SMALLINT NOT NULL CHECK (rating >= 1 AND rating <= 5),
    note       TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 5. calendar_events ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.calendar_events (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                  UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    event_date               DATE NOT NULL,
    exam_flag                BOOLEAN NOT NULL DEFAULT false,
    meeting_density          NUMERIC NOT NULL DEFAULT 0,
    earliest_start_norm      NUMERIC CHECK (earliest_start_norm IS NULL OR (earliest_start_norm >= 0 AND earliest_start_norm <= 1)),
    total_committed_hours    NUMERIC NOT NULL DEFAULT 0,
    consecutive_loaded_days  INT NOT NULL DEFAULT 0,
    days_to_next_free        INT NOT NULL DEFAULT 0,
    synced_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, event_date)
);

-- ── 6. lstm_forecasts ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.lstm_forecasts (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    day1_risk    NUMERIC NOT NULL CHECK (day1_risk >= 0 AND day1_risk <= 1),
    day2_risk    NUMERIC NOT NULL CHECK (day2_risk >= 0 AND day2_risk <= 1),
    day3_risk    NUMERIC NOT NULL CHECK (day3_risk >= 0 AND day3_risk <= 1)
);
CREATE INDEX IF NOT EXISTS idx_lstm_forecasts_user_time
    ON public.lstm_forecasts(user_id, generated_at DESC);

-- ── 7. interventions ─────────────────────────────────────────────────────────
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_type
        WHERE typname = 'intervention_type_enum'
    ) THEN
        CREATE TYPE intervention_type_enum AS ENUM (
            'breathing', 'focus', 'step_away', 'prevention', 'reflection'
        );
    END IF;
END
$$;
CREATE TABLE IF NOT EXISTS public.interventions (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    score_id          UUID REFERENCES public.if_scores(id) ON DELETE SET NULL,
    intervention_type intervention_type_enum NOT NULL,
    delivered_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    dismissed_at      TIMESTAMPTZ,
    snoozed_until     TIMESTAMPTZ
);

-- ═════════════════════════════════════════
-- Row Level Security
-- ═════════════════════════════════════════

ALTER TABLE public.users           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.behavioral_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.if_scores       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mood_checkins   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calendar_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lstm_forecasts  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.interventions   ENABLE ROW LEVEL SECURITY;

-- users: see/update only own row
CREATE POLICY "users_own" ON public.users
    USING (id = auth.uid()) WITH CHECK (id = auth.uid());

-- all other tables: filter by user_id
DO $$ DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['behavioral_logs','if_scores','mood_checkins',
                            'calendar_events','lstm_forecasts','interventions'] LOOP
    EXECUTE format(
      'CREATE POLICY "%s_own" ON public.%s USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid())',
      t, t
    );
  END LOOP;
END $$;

-- ═════════════════════════════════════════
-- updated_at trigger for users
-- ═════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON public.users
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

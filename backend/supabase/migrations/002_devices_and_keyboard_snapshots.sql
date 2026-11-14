-- ════════════════════════════════════════════════════════════════════════════
-- StressTwin  ·  002_devices_and_keyboard_snapshots.sql
-- Adds multi-device tracking + keyboard behavioral snapshot support.
-- Run this in Supabase SQL Editor AFTER 001_initial_schema.sql.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. devices ───────────────────────────────────────────────────────────────
-- One row per physical device (laptop, phone) that contributes data to a user's
-- single StressTwin profile.
CREATE TABLE IF NOT EXISTS public.devices (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    device_id         TEXT NOT NULL,                    -- stable client-generated id (UUID persisted on-device)
    platform          TEXT NOT NULL CHECK (platform IN ('desktop', 'android', 'ios')),
    display_name      TEXT NOT NULL DEFAULT 'Unknown device',   -- e.g. "MacBook Air", "iPhone"
    keyboard_active   BOOLEAN NOT NULL DEFAULT false,    -- android/ios only: is StressTwin Keyboard the active IME/extension
    last_snapshot_at  TIMESTAMPTZ,                       -- last local 15s feature snapshot the server heard about
    last_sync_at      TIMESTAMPTZ,                       -- last successful 10-min batch upload
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, device_id)
);
CREATE INDEX IF NOT EXISTS idx_devices_user ON public.devices(user_id);

-- ── 2. behavioral_logs: extend to support keyboard + multi-device ─────────────
ALTER TABLE public.behavioral_logs
    ADD COLUMN IF NOT EXISTS device_id           UUID REFERENCES public.devices(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS source               TEXT NOT NULL DEFAULT 'legacy'
        CHECK (source IN ('legacy', 'desktop_sensor', 'mobile_sensor', 'mobile_keyboard')),
    ADD COLUMN IF NOT EXISTS client_snapshot_id   TEXT,        -- idempotency key generated on-device (uuid)
    -- Keyboard-specific behavioral features (content is NEVER stored — statistics only)
    ADD COLUMN IF NOT EXISTS typing_speed_cps     NUMERIC,     -- characters per second
    ADD COLUMN IF NOT EXISTS inter_key_interval_ms NUMERIC,    -- mean ms between keystrokes
    ADD COLUMN IF NOT EXISTS backspace_rate       NUMERIC CHECK (backspace_rate IS NULL OR (backspace_rate >= 0 AND backspace_rate <= 1)),
    ADD COLUMN IF NOT EXISTS correction_rate      NUMERIC CHECK (correction_rate IS NULL OR (correction_rate >= 0 AND correction_rate <= 1)),
    ADD COLUMN IF NOT EXISTS pause_frequency      NUMERIC,     -- pauses/min above pause threshold
    ADD COLUMN IF NOT EXISTS typing_bursts        INT,         -- count of rapid-typing bursts in window
    ADD COLUMN IF NOT EXISTS typing_interruptions INT,         -- count of typing sessions broken off mid-word
    ADD COLUMN IF NOT EXISTS char_count           INT;         -- total characters typed in window (COUNT ONLY, never the characters themselves)

-- Idempotency: a given device can only upload the same client-generated snapshot id once.
CREATE UNIQUE INDEX IF NOT EXISTS uq_behavioral_logs_device_snapshot
    ON public.behavioral_logs(device_id, client_snapshot_id)
    WHERE client_snapshot_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_behavioral_logs_device_time
    ON public.behavioral_logs(device_id, window_start DESC);

ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "devices_own" ON public.devices
    USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

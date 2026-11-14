-- 008: state for automatic personal-LSTM training (duplicate-job lock, retrain bookkeeping, last error).
-- Safe to re-run. Run in the Supabase SQL editor after 001-007.

ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS lstm_training_status      TEXT NOT NULL DEFAULT 'idle',
    ADD COLUMN IF NOT EXISTS lstm_training_started_at  TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS lstm_last_attempt_at      TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS lstm_last_error           TEXT,
    ADD COLUMN IF NOT EXISTS lstm_trained_days         INT,
    ADD COLUMN IF NOT EXISTS lstm_trained_sequences    INT,
    ADD COLUMN IF NOT EXISTS lstm_train_mse            NUMERIC,
    ADD COLUMN IF NOT EXISTS lstm_baseline_mse         NUMERIC;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_lstm_training_status_chk') THEN
        ALTER TABLE public.users
            ADD CONSTRAINT users_lstm_training_status_chk
            CHECK (lstm_training_status IN ('idle', 'running', 'failed'));
    END IF;
END
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- StressTwin  ·  003_global_tiers.sql
-- Adds the two new global model tiers introduced alongside the corrected
-- dataset strategy (see ML_TRAINING.md):
--   - global_prior     Tier 0, population weekday prior (StudentLife Stress EMA)
--   - global_baseline  Tier 1, behavioral baseline (SWELL-KW + MobileStress)
-- 'global_lstm' (Tier 2, sequence LSTM) and 'personal_lstm' / 'personal_if'
-- already exist from 002_ml_model_versioning.sql and are unchanged.
-- Run this in Supabase SQL Editor AFTER 002_ml_model_versioning.sql.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TYPE ml_model_type_enum ADD VALUE IF NOT EXISTS 'global_prior';
ALTER TYPE ml_model_type_enum ADD VALUE IF NOT EXISTS 'global_baseline';

-- lstm_mode on user_model_status already covers 'global' vs 'personal' at
-- the routing level; which GLOBAL tier actually served a given forecast is
-- recorded per-request instead (not per-user), since it can change from one
-- forecast to the next as tiers become available — see the model_source
-- column added to lstm_forecasts below.
ALTER TABLE public.lstm_forecasts
    DROP CONSTRAINT IF EXISTS lstm_forecasts_model_source_check;

ALTER TABLE public.lstm_forecasts
    ADD CONSTRAINT lstm_forecasts_model_source_check
    CHECK (model_source IN ('personal', 'global_sequence', 'global_baseline', 'global_prior'));

COMMENT ON COLUMN public.lstm_forecasts.model_source IS
    'Which of the 4 forecast rungs actually served this row — see ml/inference.py::forecast(). '
    'personal = Personal LSTM; global_sequence = Tier 2; global_baseline = Tier 1; global_prior = Tier 0.';

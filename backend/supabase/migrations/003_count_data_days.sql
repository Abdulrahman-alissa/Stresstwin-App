-- ════════════════════════════════════════════════════════════════════════════
-- StressTwin  ·  003_count_data_days.sql
-- Counts how many distinct days a user has behavioral data for, inside the
-- database. The API used to download every row and count in Python, but the
-- API returns at most ~1000 rows per request (≈ 8 hours of 30 s windows), so
-- "days of data" was badly under-counted and the 28-day forecast gate could
-- never open. Run this in the Supabase SQL Editor after 002.
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.count_data_days(p_user UUID)
RETURNS INTEGER
LANGUAGE sql STABLE
AS $$
    SELECT COALESCE(COUNT(DISTINCT (window_start AT TIME ZONE 'UTC')::date), 0)::int
    FROM public.behavioral_logs
    WHERE user_id = p_user;
$$;

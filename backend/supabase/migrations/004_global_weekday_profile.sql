-- Population weekday profile used for the "starter" forecast (until a user has their own LSTM).
-- Returns ONLY aggregates: for each weekday, how much higher/lower than their own average people score,
-- averaged across users, plus how many users that is based on. No per-user rows leave the database.
-- dow follows Postgres: 0 = Sunday … 6 = Saturday (UTC day boundaries).
create or replace function public.global_weekday_profile(days_back int default 60, min_scores int default 20)
returns table (dow int, factor numeric, users int, mean_score numeric)
language sql stable security definer set search_path = public as $$
  with recent as (
    select user_id, deviation_score, created_at
    from public.if_scores
    where created_at >= now() - make_interval(days => days_back)
  ),
  per_user as (
    select user_id, avg(deviation_score) as u_mean
    from recent group by user_id having count(*) >= min_scores and avg(deviation_score) > 0
  ),
  per_user_dow as (
    select r.user_id,
           extract(dow from r.created_at at time zone 'UTC')::int as dow,
           avg(r.deviation_score) as d_mean,
           u.u_mean
    from recent r join per_user u using (user_id)
    group by r.user_id, extract(dow from r.created_at at time zone 'UTC')::int, u.u_mean
  )
  select dow, avg(d_mean / u_mean)::numeric as factor, count(*)::int as users, avg(d_mean)::numeric as mean_score
  from per_user_dow group by dow order by dow;
$$;
revoke all on function public.global_weekday_profile(int, int) from public, anon, authenticated;
grant execute on function public.global_weekday_profile(int, int) to service_role;

-- Migration 0004 — Daily funnel: true new-visitor cohort
--
-- Problems fixed:
--  1. A session was labelled "returning" if it was EVER tied to a profile —
--     even when the account was created LATER in that same session. So a
--     genuine new visitor who registered got counted as returning, and the
--     New -> Attempted -> Drop-off funnel never reconciled.
--  2. "Attempted" and "Drop-off" were on mixed bases (attempted counted
--     new+returning; drop-off counted new only), and the KPI totals summed
--     per-day distinct sessions, double-counting sessions that returned on
--     another day.
--
-- New cohort rule (consistent everywhere): a session is RETURNING only if it
-- has a user whose profile existed BEFORE the session started. Everyone else
-- (anonymous, or an account created during/after the visit) is NEW. So:
--   attempted_new       = new sessions that opened /register
--   converted_new       = those that ended up with an account
--   dropoff_new         = those that never created an account   (the real leak)
--   attempted_returning = existing-account users who opened /register (shown
--                         separately, never mixed into the new funnel)
--
-- Note: visitor tracking (traffic_events) began 2026-10-01; accounts go back to
-- 2026-09-25, so the visit/attempt funnel is only meaningful from Oct 1.
-- "Accounts created (all paths)" stays people-based so VSAT/event signups and
-- pre-tracking signups aren't lost.

-- ── 1) funnel_totals: correct whole-range DISTINCT counts for the KPI cards ──
create or replace function public.funnel_totals(p_from date, p_to date)
returns table(
  new_visitors int, returning_visitors int,
  attempted_new int, converted_new int, dropoff_new int, attempted_returning int,
  accounts_created int, registered_partial int, registered_full int,
  bootcamp int, codesprint int
)
language sql stable security definer set search_path to ''
as $function$
  with ses as (
    select te.session_id,
           min(te.created_at) as first_seen,
           (array_agg(te.user_id) filter (where te.user_id is not null))[1] as uid,
           bool_or(te.path ilike '/register%') as hit_register
    from public.traffic_events te
    where te.session_id is not null
      and (te.created_at at time zone 'Asia/Kolkata')::date between p_from and p_to
    group by te.session_id
  ),
  classed as (
    select s.*,
      (s.uid is not null and exists(select 1 from public.profiles p where p.id=s.uid and p.created_at < s.first_seen)) as is_returning
    from ses s
  )
  select
    count(*) filter (where not is_returning)::int,
    count(*) filter (where is_returning)::int,
    count(*) filter (where hit_register and not is_returning)::int,
    count(*) filter (where hit_register and not is_returning and uid is not null)::int,
    count(*) filter (where hit_register and not is_returning and uid is null)::int,
    count(*) filter (where hit_register and is_returning)::int,
    (select count(*) from public.profiles p where (p.created_at at time zone 'Asia/Kolkata')::date between p_from and p_to)::int,
    (select count(*) from public.profiles p where (p.created_at at time zone 'Asia/Kolkata')::date between p_from and p_to and p.mobile_verified and not p.profile_completed)::int,
    (select count(*) from public.profiles p where (p.created_at at time zone 'Asia/Kolkata')::date between p_from and p_to and p.profile_completed)::int,
    (select count(distinct er.user_id) from public.event_registrations er where (er.created_at at time zone 'Asia/Kolkata')::date between p_from and p_to)::int,
    (select count(distinct ce.user_id) from public.cs_enrollments ce where (ce.enrolled_at at time zone 'Asia/Kolkata')::date between p_from and p_to)::int
  from classed
  where public.is_admin();
$function$;

-- ── 2) daily_funnel: per-day trend on the same cohort (new columns) ──
-- return shape changes, so drop the old one first.
drop function if exists public.daily_funnel(date, date);
create or replace function public.daily_funnel(p_from date, p_to date)
returns table(
  day date, new_visitors int, returning_visitors int,
  attempted_new int, converted_new int, dropoff_new int, attempted_returning int,
  partial_reg int, full_reg int,
  bootcamp int, bootcamp_mql int, codesprint int, codesprint_mql int
)
language sql stable security definer set search_path to ''
as $function$
  with days as (select generate_series(p_from, p_to, interval '1 day')::date as day),
  ses as (  -- session-level cohort (account existed before session?)
    select te.session_id,
           min(te.created_at) as first_seen,
           (array_agg(te.user_id) filter (where te.user_id is not null))[1] as uid
    from public.traffic_events te
    where te.session_id is not null
      and (te.created_at at time zone 'Asia/Kolkata')::date between p_from and p_to
    group by te.session_id
  ),
  classed as (
    select s.session_id, s.uid,
      (s.uid is not null and exists(select 1 from public.profiles p where p.id=s.uid and p.created_at < s.first_seen)) as is_returning
    from ses s
  ),
  day_ses as (  -- per day: each session active that day + did it open register that day
    select (te.created_at at time zone 'Asia/Kolkata')::date as day, te.session_id,
           bool_or(te.path ilike '/register%') as hit_register
    from public.traffic_events te
    where te.session_id is not null
      and (te.created_at at time zone 'Asia/Kolkata')::date between p_from and p_to
    group by 1, 2
  ),
  tr as (
    select ds.day,
      count(*) filter (where not c.is_returning) as new_visitors,
      count(*) filter (where c.is_returning) as returning_visitors,
      count(*) filter (where ds.hit_register and not c.is_returning) as attempted_new,
      count(*) filter (where ds.hit_register and not c.is_returning and c.uid is not null) as converted_new,
      count(*) filter (where ds.hit_register and not c.is_returning and c.uid is null) as dropoff_new,
      count(*) filter (where ds.hit_register and c.is_returning) as attempted_returning
    from day_ses ds join classed c on c.session_id = ds.session_id
    group by ds.day
  ),
  pf as (
    select (created_at at time zone 'Asia/Kolkata')::date as day,
           count(*) filter (where mobile_verified and not profile_completed) as partial_reg,
           count(*) filter (where profile_completed) as full_reg
    from public.profiles
    where (created_at at time zone 'Asia/Kolkata')::date between p_from and p_to group by 1
  ),
  bc as (
    select (er.created_at at time zone 'Asia/Kolkata')::date as day,
           count(distinct er.user_id) as bootcamp,
           count(distinct er.user_id) filter (where upper(btrim(p.stream)) in ('PCM','PCMB') and p.grad_year in (2026,2027)) as bootcamp_mql
    from public.event_registrations er left join public.profiles p on p.id = er.user_id
    where (er.created_at at time zone 'Asia/Kolkata')::date between p_from and p_to group by 1
  ),
  cs as (
    select (ce.enrolled_at at time zone 'Asia/Kolkata')::date as day,
           count(distinct ce.user_id) as codesprint,
           count(distinct ce.user_id) filter (where upper(btrim(p.stream)) in ('PCM','PCMB') and p.grad_year in (2026,2027)) as codesprint_mql
    from public.cs_enrollments ce left join public.profiles p on p.id = ce.user_id
    where (ce.enrolled_at at time zone 'Asia/Kolkata')::date between p_from and p_to group by 1
  )
  select d.day,
    coalesce(tr.new_visitors,0)::int, coalesce(tr.returning_visitors,0)::int,
    coalesce(tr.attempted_new,0)::int, coalesce(tr.converted_new,0)::int, coalesce(tr.dropoff_new,0)::int, coalesce(tr.attempted_returning,0)::int,
    coalesce(pf.partial_reg,0)::int, coalesce(pf.full_reg,0)::int,
    coalesce(bc.bootcamp,0)::int, coalesce(bc.bootcamp_mql,0)::int,
    coalesce(cs.codesprint,0)::int, coalesce(cs.codesprint_mql,0)::int
  from days d
  left join tr on tr.day=d.day left join pf on pf.day=d.day left join bc on bc.day=d.day left join cs on cs.day=d.day
  where public.is_admin() order by d.day desc;
$function$;

-- ── 3) funnel_people: drill-downs match the new cohort ──
create or replace function public.funnel_people(p_from date, p_to date, p_kind text)
returns table(full_name text, email text, phone text, extra text, when_at timestamptz)
language plpgsql stable security definer set search_path to ''
as $function$
begin
  if not public.is_admin() then raise exception 'admins only'; end if;

  if p_kind in ('partial','full') then
    return query
      select p.full_name, p.email, p.phone,
             'via ' || coalesce(nullif(p.utm_source,''),'direct') || coalesce(' · ' || nullif(p.landing_path,''),'') as extra, p.created_at
      from public.profiles p
      where (p.created_at at time zone 'Asia/Kolkata')::date between p_from and p_to
        and ((p_kind='partial' and p.mobile_verified and not p.profile_completed)
          or (p_kind='full' and p.profile_completed))
      order by p.created_at desc;

  elsif p_kind = 'codesprint' then
    return query
      select p.full_name, p.email, p.phone, 'via ' || coalesce(nullif(p.utm_source,''),'direct') as extra, ce.enrolled_at
      from public.cs_enrollments ce left join public.profiles p on p.id = ce.user_id
      where (ce.enrolled_at at time zone 'Asia/Kolkata')::date between p_from and p_to
      order by ce.enrolled_at desc;

  elsif p_kind = 'bootcamp' then
    return query
      select p.full_name, p.email, p.phone, e.name as extra, er.created_at
      from public.event_registrations er join public.events e on e.id = er.event_id
      left join public.profiles p on p.id = er.user_id
      where (er.created_at at time zone 'Asia/Kolkata')::date between p_from and p_to
      order by er.created_at desc;

  else
    -- session-cohort kinds: new | returning | attempted | converted | dropoff | attempted_returning
    return query
    with raw as (
      select v.session_id, v.path, v.user_id, v.created_at,
             lag(v.path) over (partition by v.session_id order by v.created_at) as prev,
             first_value(coalesce(nullif(v.utm_source,''),'direct')) over (partition by v.session_id order by v.created_at) as landing_utm
      from public.traffic_events v
      where (v.created_at at time zone 'Asia/Kolkata')::date between p_from and p_to),
    sess as (
      select session_id,
             max(landing_utm) as landing_utm,
             (array_agg(user_id) filter (where user_id is not null))[1] as uid,
             string_agg(path, '  →  ' order by created_at) filter (where path is distinct from prev) as journey,
             bool_or(path ilike '/register%') as hit_register,
             min(created_at) as first_seen
      from raw group by session_id),
    classed as (
      select s.*, (s.uid is not null and exists(select 1 from public.profiles p where p.id=s.uid and p.created_at < s.first_seen)) as is_returning
      from sess s)
    select null::text, null::text, null::text,
           c.landing_utm || ':   ' || coalesce(c.journey,'(single page)') as extra,
           c.first_seen as when_at
    from classed c
    where (p_kind='new'                 and not c.is_returning)
       or (p_kind='returning'           and c.is_returning)
       or (p_kind='attempted'           and c.hit_register and not c.is_returning)
       or (p_kind='converted'           and c.hit_register and not c.is_returning and c.uid is not null)
       or (p_kind='dropoff'             and c.hit_register and not c.is_returning and c.uid is null)
       or (p_kind='attempted_returning' and c.hit_register and c.is_returning)
    order by c.first_seen desc
    limit 2000;
  end if;
end $function$;

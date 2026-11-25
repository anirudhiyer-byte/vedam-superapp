-- 0176 · PeerPath admin "Impact" numbers (read-only)
--
-- One new function, nothing else changes: no table, no existing function (pp_admin_all,
-- pp_book, pp_cleanup_logs …) is touched. Rollback: supabase/rollback/0176_peerpath_admin_insights_down.sql
--
-- public.pp_admin_insights(p jsonb) → jsonb, admins only. Returns counts only (no names, emails,
-- phones or ids) for the last 7, 30 and 90 days in one call, so the admin page can switch ranges
-- without another request.
--
-- Input: {} or {"campus": null | "Pune" | "Gurugram"}. Any other key or value → BAD_VALUE (22023).
-- Not an admin (pp_is_admin) → FORBIDDEN (42501).
--
-- Rules (same as the rest of the repo):
--   · "paid"     = a row in vsat_payments (never payment_stage_*). vsat_payments.lead_id = auth user id.
--   · "enrolled" = application_manager.enrollment_stage = 'approved' (as in 0105).
--   · users are matched by login id only (pp_bookings.applicant_user_id = lead_id), never by email/phone.
--   · a "chat" = a logged-in booking that is completed, or confirmed and already over (the admin page's
--     "done" rule). Cancelled, moved and no-show bookings are not chats. Pre-login bookings have no user
--     and are left out.
--   · campus of an attempt / booking = campus of its senior. Attempts with no senior (signed-out per-IP
--     blocks, invalid requests) only count when no campus is chosen.
--
-- Output:
--   { "mode": <app_flags.peerpath_eligibility>,
--     "ranges": { "7" | "30" | "90": {
--        "demand":  { attempts, people, booked, people_booked,
--                     blocked: { <code>: { attempts, people } } },   -- people: distinct signed-in users,
--                                                                     -- plus each signed-out try as one
--        "outcome": { applicants, paid_before, paid_after, not_paid, enrolled, enrolled_after,
--                     median_days_to_pay, median_days_to_enroll } } } }
--   paid_before / paid_after compare vsat_payments.paid_at with the end of the user's first chat in the
--   range; the medians use only the "after" users (null when there are none).

create or replace function public.pp_admin_insights(p jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $fn$
declare
  k        text;
  v_campus text;
  v_mode   text;
  v_now    timestamptz := now();
  v_out    jsonb;
begin
  if not public.pp_is_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  -- input: an object with at most one key, "campus"
  p := coalesce(p, '{}'::jsonb);
  if jsonb_typeof(p) <> 'object' then
    raise exception 'BAD_VALUE' using errcode = '22023';
  end if;
  for k in select jsonb_object_keys(p) loop
    if k <> 'campus' then
      raise exception 'BAD_VALUE' using errcode = '22023';
    end if;
  end loop;
  if p ? 'campus' and jsonb_typeof(p -> 'campus') <> 'null' then
    if jsonb_typeof(p -> 'campus') <> 'string' or (p ->> 'campus') not in ('Pune', 'Gurugram') then
      raise exception 'BAD_VALUE' using errcode = '22023';
    end if;
    v_campus := p ->> 'campus';
  end if;

  select f.value into v_mode from public.app_flags f where f.key = 'peerpath_eligibility';

  -- One pass over the last 90 days; the 7 and 30 day numbers are subsets of the same rows.
  -- Attempts are first folded to one row per (user, code) with a count per range (hash aggregate,
  -- no big sort), and people are counted from that much smaller set.
  with w(d) as (values (7), (30), (90)),
  -- ── demand: booking attempts (pp_book_attempts_created_idx) ──
  uc as (
    select ba.user_id, ba.code,
           count(*) filter (where ba.created_at >= v_now - interval '7 days')  as n7,
           count(*) filter (where ba.created_at >= v_now - interval '30 days') as n30,
           count(*) as n90
    from public.pp_book_attempts ba
    left join public.pp_seniors s on s.id = ba.senior_id
    where ba.created_at >= v_now - interval '90 days'
      and (v_campus is null or s.campus = v_campus)
    group by ba.user_id, ba.code
  ),
  ucw as (  -- one row per (range, user, code) that has attempts in that range; user null = signed-out tries
    select w.d, uc.user_id, uc.code, x.n
    from uc
    cross join w
    cross join lateral (select case w.d when 7 then uc.n7 when 30 then uc.n30 else uc.n90 end as n) x
    where x.n > 0
  ),
  dem as (
    select ucw.d,
           sum(ucw.n) as attempts,
           count(distinct ucw.user_id) + coalesce(sum(ucw.n) filter (where ucw.user_id is null), 0) as people,
           coalesce(sum(ucw.n) filter (where ucw.code = 'OK'), 0) as booked,
           count(*) filter (where ucw.code = 'OK' and ucw.user_id is not null) as people_booked
    from ucw
    group by ucw.d
  ),
  blk as (
    select x.d, jsonb_object_agg(x.code, jsonb_build_object('attempts', x.attempts, 'people', x.people)) as blocked
    from (select ucw.d, ucw.code, sum(ucw.n) as attempts,
                 count(*) filter (where ucw.user_id is not null) + coalesce(sum(ucw.n) filter (where ucw.user_id is null), 0) as people
          from ucw where ucw.code <> 'OK'
          group by ucw.d, ucw.code) x
    group by x.d
  ),
  -- ── outcome: first chat (in the range) of each logged-in applicant ──
  chats as (
    select b.applicant_user_id as uid,
           min(b.end_at) filter (where b.start_at >= v_now - interval '7 days')  as e7,
           min(b.end_at) filter (where b.start_at >= v_now - interval '30 days') as e30,
           min(b.end_at) as e90
    from public.pp_bookings b
    join public.pp_seniors s on s.id = b.senior_id
    where b.applicant_user_id is not null
      and b.status in ('completed', 'confirmed')
      and b.end_at < v_now
      and b.start_at >= v_now - interval '90 days'
      and (v_campus is null or s.campus = v_campus)
    group by b.applicant_user_id
  ),
  j as (
    select w.d, x.first_end, vp.paid_at, am.enrollment_stage, am.enrollment_paid_at
    from chats c
    cross join w
    cross join lateral (select case w.d when 7 then c.e7 when 30 then c.e30 else c.e90 end as first_end) x
    left join public.vsat_payments vp on vp.lead_id = c.uid
    left join public.application_manager am on am.lead_id = c.uid
    where x.first_end is not null
  ),
  oc as (
    select j.d,
           count(*) as applicants,
           count(*) filter (where j.paid_at is not null and j.paid_at <= j.first_end) as paid_before,
           count(*) filter (where j.paid_at > j.first_end) as paid_after,
           count(*) filter (where j.paid_at is null) as not_paid,
           count(*) filter (where j.enrollment_stage = 'approved') as enrolled,
           count(*) filter (where j.enrollment_stage = 'approved' and j.enrollment_paid_at > j.first_end) as enrolled_after,
           round((percentile_cont(0.5) within group (order by extract(epoch from j.paid_at - j.first_end) / 86400.0)
                  filter (where j.paid_at > j.first_end))::numeric, 1) as median_days_to_pay,
           round((percentile_cont(0.5) within group (order by extract(epoch from j.enrollment_paid_at - j.first_end) / 86400.0)
                  filter (where j.enrollment_stage = 'approved' and j.enrollment_paid_at > j.first_end))::numeric, 1) as median_days_to_enroll
    from j
    group by j.d
  )
  select jsonb_object_agg(w.d::text, jsonb_build_object(
           'demand', jsonb_build_object(
             'attempts',      coalesce(dem.attempts, 0),
             'people',        coalesce(dem.people, 0),
             'booked',        coalesce(dem.booked, 0),
             'people_booked', coalesce(dem.people_booked, 0),
             'blocked',       coalesce(blk.blocked, '{}'::jsonb)),
           'outcome', jsonb_build_object(
             'applicants',            coalesce(oc.applicants, 0),
             'paid_before',           coalesce(oc.paid_before, 0),
             'paid_after',            coalesce(oc.paid_after, 0),
             'not_paid',              coalesce(oc.not_paid, 0),
             'enrolled',              coalesce(oc.enrolled, 0),
             'enrolled_after',        coalesce(oc.enrolled_after, 0),
             'median_days_to_pay',    oc.median_days_to_pay,
             'median_days_to_enroll', oc.median_days_to_enroll)))
    into v_out
  from w
  left join dem on dem.d = w.d
  left join blk on blk.d = w.d
  left join oc  on oc.d  = w.d;

  return jsonb_build_object('mode', coalesce(v_mode, 'off'), 'ranges', v_out);
end $fn$;

comment on function public.pp_admin_insights(jsonb) is
  'PeerPath admin Impact numbers for 7/30/90 days (counts only). Admins only. Input {} or {"campus": "Pune"|"Gurugram"|null}.';

revoke all on function public.pp_admin_insights(jsonb) from public, anon;
grant execute on function public.pp_admin_insights(jsonb) to authenticated;

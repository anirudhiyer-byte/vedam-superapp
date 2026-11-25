-- 0185 · PeerPath admin Impact trends (read-only)
--
-- One new function, nothing else changes: no table, no existing function (pp_admin_all,
-- pp_admin_insights, pp_book, pp_cleanup_logs …) is touched. Rollback: supabase/rollback/0185_peerpath_admin_impact_trend_down.sql
--
-- public.pp_admin_impact_trend(p jsonb) → jsonb, admins only. Counts only (no names, emails, phones
-- or ids). It adds the "over time" view next to the totals from pp_admin_insights (0176):
--   · one row per IST day for the last 90 days (booking tries, booked tries, first chats, paid after)
--   · a "how many days from the chat to paying" histogram for 7, 30 and 90 days
--
-- Input: {} or {"campus": null | "Pune" | "Gurugram"}. Any other key or value → BAD_VALUE (22023).
-- Not an admin (pp_is_admin) → FORBIDDEN (42501).
--
-- Rules (the same as pp_admin_insights, so the numbers add up):
--   · the window is the last 90 days from now (the same cut-off as 0176); days are IST calendar days,
--     so the first day can be partial. That makes up to 91 rows, oldest first, zeros included.
--   · "paid"     = a row in vsat_payments (never payment_stage_*). vsat_payments.lead_id = auth user id.
--   · a "chat"   = a logged-in booking that is completed, or confirmed and already over. Pre-login bookings
--     have no user and are left out. Users are matched by login id only, never by email/phone.
--   · campus of an attempt / booking = campus of its senior. Attempts with no senior only count when no
--     campus is chosen.
--   · tries / booked : booking attempts that day (booked = code 'OK'); additive, so any range can be summed.
--   · chats / paid_after : each signed-in applicant is counted ONCE, on the IST day their first chat in the
--     last 90 days ended; paid_after = they paid after that chat. Sum over all rows = the 90-day
--     "applicants" / "paid_after" of pp_admin_insights.
--   · pay_bins : for 7, 30 and 90 days, applicants who paid AFTER their first chat in that range, grouped by
--     days from the chat's end to the payment: [<1, 1–3, 3–7, 7–14, 14–30, 30+] (a value on an edge goes in
--     the higher bin). The six numbers add up to that range's paid_after in pp_admin_insights.
--
-- Output:
--   { "mode": <app_flags.peerpath_eligibility>,
--     "days": [ { "d": "YYYY-MM-DD", "tries", "booked", "chats", "paid_after" }, … ],
--     "pay_bins": { "7": [6 numbers], "30": [6 numbers], "90": [6 numbers] } }

create or replace function public.pp_admin_impact_trend(p jsonb default '{}'::jsonb)
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
  v_from   date := ((now() - interval '90 days') at time zone 'Asia/Kolkata')::date;
  v_to     date := (now() at time zone 'Asia/Kolkata')::date;
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

  with
  days as (
    select g.d::date as d
    from generate_series(v_from::timestamp, v_to::timestamp, interval '1 day') as g(d)
  ),
  -- ── booking attempts per IST day (pp_book_attempts_created_idx) ──
  tries as (
    select (ba.created_at at time zone 'Asia/Kolkata')::date as d,
           count(*) as n,
           count(*) filter (where ba.code = 'OK') as booked
    from public.pp_book_attempts ba
    left join public.pp_seniors s on s.id = ba.senior_id
    where ba.created_at >= v_now - interval '90 days'
      and (v_campus is null or s.campus = v_campus)
    group by 1
  ),
  -- ── first chat (end time) of each logged-in applicant, per range: same rule as pp_admin_insights ──
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
    select c.uid, c.e7, c.e30, c.e90, vp.paid_at
    from chats c
    left join public.vsat_payments vp on vp.lead_id = c.uid
  ),
  by_day as (
    select (j.e90 at time zone 'Asia/Kolkata')::date as d,
           count(*) as chats,
           count(*) filter (where j.paid_at > j.e90) as paid_after
    from j
    group by 1
  ),
  -- ── days from the first chat to paying, per range and bin ──
  pay as (
    select r.d as range_d, bn.bin, count(*) as n
    from j
    cross join (values (7), (30), (90)) as r(d)
    cross join lateral (select case r.d when 7 then j.e7 when 30 then j.e30 else j.e90 end as e) x
    cross join lateral (select extract(epoch from j.paid_at - x.e) / 86400.0 as dd) y
    cross join lateral (select case when y.dd < 1 then 1 when y.dd < 3 then 2 when y.dd < 7 then 3
                                    when y.dd < 14 then 4 when y.dd < 30 then 5 else 6 end as bin) bn
    where x.e is not null and j.paid_at > x.e
    group by r.d, bn.bin
  )
  select jsonb_build_object(
           'mode', coalesce(v_mode, 'off'),
           'days', (select jsonb_agg(jsonb_build_object(
                               'd',          to_char(dd.d, 'YYYY-MM-DD'),
                               'tries',      coalesce(t.n, 0),
                               'booked',     coalesce(t.booked, 0),
                               'chats',      coalesce(bd.chats, 0),
                               'paid_after', coalesce(bd.paid_after, 0)) order by dd.d)
                    from days dd
                    left join tries  t  on t.d  = dd.d
                    left join by_day bd on bd.d = dd.d),
           'pay_bins', jsonb_build_object(
             '7',  (select jsonb_agg(coalesce(pc.n, 0) order by b.n) from generate_series(1, 6) as b(n) left join pay pc on pc.range_d = 7  and pc.bin = b.n),
             '30', (select jsonb_agg(coalesce(pc.n, 0) order by b.n) from generate_series(1, 6) as b(n) left join pay pc on pc.range_d = 30 and pc.bin = b.n),
             '90', (select jsonb_agg(coalesce(pc.n, 0) order by b.n) from generate_series(1, 6) as b(n) left join pay pc on pc.range_d = 90 and pc.bin = b.n)))
    into v_out;

  return v_out;
end $fn$;

comment on function public.pp_admin_impact_trend(jsonb) is
  'PeerPath admin Impact trends: per-IST-day tries/booked/first chats/paid-after for 90 days plus days-to-pay bins for 7/30/90 (counts only). Admins only. Input {} or {"campus": "Pune"|"Gurugram"|null}.';

revoke all on function public.pp_admin_impact_trend(jsonb) from public, anon;
grant execute on function public.pp_admin_impact_trend(jsonb) to authenticated;

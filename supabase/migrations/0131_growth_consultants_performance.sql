-- 0131 · Growth → Marketing channels → Consultants Channel → Consultant Performance (admin only)
--
-- Ports the vedamcrm360 "Consultants Dashboard" (Consultant Breakdown, Application Journey, BDM View, City View and the
-- KPI / consultant drill-downs) into Vedam One, on Vedam One's own data. New objects only: nothing of 0130 (Consultant
-- Listing) or of the Ads / Influencers / Overview pages is changed. Their helpers (growth__admin, growth__keys, growth__txt,
-- growth__date, growth__utm_key, growth__leads, growth__campus) are called, not redefined.
--
-- Where the people come from (same rules as the Consultant Listing, so the two pages always agree for "all time"):
--   by UTM     = growth__leads(): lead_manager rows whose primary (first-touch) UTM equals the UTM key of a live Listing row
--                (staff @vedam.org left out). A lead counts for ONE row.
--   by coupon  = paid VSAT-fee leads (vsat_payment_orders status 'paid', kind 'vsat_fee') that used a live row's coupon code
--                (case-insensitive) and whose own UTM is NOT the UTM of a live row: a payment that matches by UTM is counted
--                by UTM only, so each payment counts once ("strict"). When two rows share a coupon, the oldest row owns it.
-- One consultant = all live rows with the same name (trimmed, case-insensitive), as in the CRM roll-up.
--
-- Numbers per consultant, for an optional period (IST days) and campus (GGN | PUNE, from lead_manager.campus_preference):
--   Leads         = UTM leads whose registration day is in the period            (growth__leads.created_d)
--   Applications  = paid people (UTM: apps_utm, coupon: apps_coupon) whose first VSAT payment day is in the period
--   Enrollments   = people (UTM + coupon) with enrollment_stage = 'approved' whose enrolment day is in the period
--   Spend         = Enrollment Spend + Sunstone Slab Spend typed on the Listing rows (not period-dependent)
--   Active        = Leads > 0 or Applications > 0 (worked out on screen)
--   Journey stage = of every paid person in the period: 'enrolled' when enrollment_stage = 'approved', else the person's
--                   application_manager.application_stage_1 (latest application), else 'no_application'. The stage list is
--                   Vedam One's own (vm_app_stage), not the CRM's Meritto stages; the stage counts add up to Applications.
-- "All time" = no period; then every number equals the Consultant Listing's.
--
-- City targets: one enrolment target per city (City View), kept in growth_cons_city_targets.
--
-- Student drill-downs show name, e-mail and mobile to admins (the CRM does the same; Vedam One's admin panels already show
-- them). They are loaded only when a card or a consultant is opened, capped at 5,000 rows, and have no download.
--
-- Security: admin only (growth__admin). Table: RLS on, no policies, no grants. Public RPCs: SECURITY DEFINER, search_path '',
-- unknown request keys refused (growth__keys), revoked from public/anon, granted to authenticated. Private helpers
-- (growth__cons_*) are not callable by browsers. Audit history through public.audit_trigger().
--
-- Rollback: supabase/rollback/0131_growth_consultants_performance_down.sql
-- Tests:    supabase/tests/growth_consultants_performance.test.sql

-- ═══════════════════════════════ table ═══════════════════════════════

create table if not exists public.growth_cons_city_targets (
  id         uuid primary key default gen_random_uuid(),
  city       text not null check (char_length(btrim(city)) between 1 and 80),
  target     int  not null default 0 check (target between 0 and 1000000),
  updated_by uuid,
  updated_at timestamptz not null default now()
);
create unique index if not exists growth_cons_city_targets_city on public.growth_cons_city_targets (lower(btrim(city)));

alter table public.growth_cons_city_targets enable row level security;
revoke all on table public.growth_cons_city_targets from public, anon, authenticated;

create trigger trg_audit_growth_cons_city_targets
  after insert or update or delete on public.growth_cons_city_targets
  for each row execute function public.audit_trigger();

-- ═══════════════════════════════ private helpers ═══════════════════════════════

-- is the day inside the period? (no period = always; a missing day is never inside)
create or replace function public.growth__cons_in(p_d date, p_s date, p_e date)
returns boolean language sql immutable set search_path to '' as $fn$
  select p_d is not null and (p_s is null or p_d >= p_s) and (p_e is null or p_d <= p_e);
$fn$;

-- the journey stage of a person (see header)
create or replace function public.growth__cons_stage(p_lead uuid)
returns text language sql stable security definer set search_path to '' as $fn$
  select case
    when exists (select 1 from public.application_manager a where a.lead_id = p_lead and a.enrollment_stage = 'approved') then 'enrolled'
    else coalesce((select a.application_stage_1::text from public.application_manager a where a.lead_id = p_lead
                    order by a.last_updated_date desc nulls last, a.created_at desc limit 1), 'no_application')
  end;
$fn$;

-- every person attributed to a live Listing row, once: row, lead, how (utm | coupon), registration / first paid / enrolled day (IST).
-- p_campus = null (all) | 'GGN' | 'PUNE'.
create or replace function public.growth__cons_people(p_campus text)
returns table (row_id uuid, lead_id uuid, via text, created_d date, paid_d date, enrolled_d date)
language sql stable security definer set search_path to '' as $fn$
  with r as materialized (
    select c.id, public.growth__utm_key(c.utm_link) k, nullif(lower(btrim(c.coupon_code)), '') cp, c.created_at
      from public.growth_cons_rows c where c.deleted_at is null
  ), l as materialized (
    select * from public.growth__leads(array(select distinct r.k from r where r.k is not null))
  ), lu as (                       -- each lead once: its UTM row (the oldest, if two rows ever shared a key)
    select distinct on (l.lead_id) r.id, l.lead_id, l.created_d, l.paid_d, l.enrolled_d
      from l join r on r.k = l.k order by l.lead_id, r.created_at, r.id
  ), live_keys as materialized (   -- a lead from one of these UTMs is counted by UTM, never again by coupon
    select distinct r.k from r where r.k is not null
  ), own as (                      -- one row per coupon: the oldest
    select distinct on (r.cp) r.cp, r.id from r where r.cp is not null order by r.cp, r.created_at, r.id
  ), cl as materialized (          -- paid VSAT-fee leads by coupon, each lead once (its first paid order)
    select distinct on (o.lead_id) o.lead_id, lower(btrim(o.discount_coupon)) cp
      from public.vsat_payment_orders o
      join public.vsat_payments vp on vp.lead_id = o.lead_id
      join public.lead_manager lm on lm.lead_id = o.lead_id
     where o.status = 'paid' and o.kind = 'vsat_fee'
       and lower(btrim(o.discount_coupon)) in (select own.cp from own)
       and (lm.registered_email is null or lm.registered_email not ilike '%@vedam.org')
       and not exists (select 1 from live_keys lk where lk.k = public.vsat__norm_utm(lm.primary_utm))
     order by o.lead_id, o.created_at, o.cf_order_id
  ), a as (
    select lu.id row_id, lu.lead_id, 'utm'::text via, lu.created_d, lu.paid_d, lu.enrolled_d from lu
    union all
    select own.id, cl.lead_id, 'coupon'::text,
           (coalesce(lm.user_registration_date, lm.created_at) at time zone 'Asia/Kolkata')::date,
           (select (min(vp.paid_at) at time zone 'Asia/Kolkata')::date from public.vsat_payments vp where vp.lead_id = cl.lead_id),
           (select (min(coalesce(am.enrollment_paid_at, am.last_updated_date)) at time zone 'Asia/Kolkata')::date
              from public.application_manager am where am.lead_id = cl.lead_id and am.enrollment_stage = 'approved')
      from cl join own on own.cp = cl.cp join public.lead_manager lm on lm.lead_id = cl.lead_id
  )
  select a.row_id, a.lead_id, a.via, a.created_d, a.paid_d, a.enrolled_d
    from a
   where p_campus is null
      or exists (select 1 from public.lead_manager m where m.lead_id = a.lead_id and public.growth__campus(m.campus_preference) = p_campus);
$fn$;

-- the period + campus of a request: start / end (YYYY-MM-DD) and campus ('GGN' | 'PUNE'); all optional
create or replace function public.growth__cons_window(p jsonb)
returns jsonb language plpgsql stable set search_path to '' as $fn$
declare s date; e date; c text;
begin
  s := public.growth__date(p, 'start');
  e := public.growth__date(p, 'end');
  if s is not null and e is not null and s > e then raise exception 'BAD_VALUE: start' using errcode = '22023'; end if;
  c := public.growth__txt(p, 'campus', 10);
  if c is not null and c not in ('GGN', 'PUNE') then raise exception 'BAD_VALUE: campus' using errcode = '22023'; end if;
  return jsonb_build_object('start', s, 'end', e, 'campus', c);
end $fn$;

-- ═══════════════════════════════ public RPCs ═══════════════════════════════

-- { start?, end?, campus? } → { consultants: [ one per consultant ], window }
create or replace function public.growth_cons_perf(p jsonb)
returns jsonb language plpgsql stable security definer set search_path to '' as $fn$
declare w jsonb; v_s date; v_e date; v_c text; v_rows jsonb;
begin
  perform public.growth__admin();
  perform public.growth__keys(p, array['start', 'end', 'campus']);
  w := public.growth__cons_window(p);
  v_s := (w->>'start')::date; v_e := (w->>'end')::date; v_c := w->>'campus';

  with g as (
    select lower(btrim(c.consultant_name)) gk,
           (array_agg(c.consultant_name order by c.created_at, c.id))[1] name,
           (array_agg(c.category order by c.created_at, c.id))[1] category,
           coalesce(array_agg(distinct btrim(c.city) order by btrim(c.city)) filter (where nullif(btrim(c.city), '') is not null), '{}') cities,
           coalesce(array_agg(distinct btrim(c.bdm) order by btrim(c.bdm)) filter (where nullif(btrim(c.bdm), '') is not null), '{}') bdms,
           count(*)::int n_rows, sum(c.enrollment_spend) enr_spend, sum(c.slab_spend) slab_spend
      from public.growth_cons_rows c where c.deleted_at is null group by 1
  ), pe as materialized (
    select lower(btrim(c.consultant_name)) gk, x.lead_id, x.via, x.created_d, x.paid_d, x.enrolled_d
      from public.growth__cons_people(v_c) x join public.growth_cons_rows c on c.id = x.row_id
  ), m as (
    select pe.gk,
           count(*) filter (where pe.via = 'utm' and public.growth__cons_in(pe.created_d, v_s, v_e))::int leads,
           count(*) filter (where pe.via = 'utm' and public.growth__cons_in(pe.paid_d, v_s, v_e))::int apps_utm,
           count(*) filter (where pe.via = 'coupon' and public.growth__cons_in(pe.paid_d, v_s, v_e))::int apps_coupon,
           count(*) filter (where public.growth__cons_in(pe.enrolled_d, v_s, v_e))::int enrolled
      from pe group by 1
  ), st as (
    select pe.gk, public.growth__cons_stage(pe.lead_id) stage, count(*)::int n
      from pe where public.growth__cons_in(pe.paid_d, v_s, v_e) group by 1, 2
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'name', g.name, 'category', g.category, 'cities', to_jsonb(g.cities), 'bdms', to_jsonb(g.bdms), 'rows', g.n_rows,
           'leads', coalesce(m.leads, 0), 'apps_utm', coalesce(m.apps_utm, 0), 'apps_coupon', coalesce(m.apps_coupon, 0),
           'enrolled', coalesce(m.enrolled, 0), 'enrollment_spend', g.enr_spend, 'slab_spend', g.slab_spend,
           'stages', coalesce((select jsonb_object_agg(st.stage, st.n) from st where st.gk = g.gk), '{}'::jsonb))
         order by g.name), '[]'::jsonb)
    into v_rows
    from g left join m on m.gk = g.gk;

  return jsonb_build_object('consultants', v_rows, 'window', w);
end $fn$;

-- { start?, end?, campus?, consultant? } → { students: [...max 5000], total, truncated, window }
-- one line per attributed person who is a lead, an application or an enrolment inside the period
create or replace function public.growth_cons_perf_students(p jsonb)
returns jsonb language plpgsql stable security definer set search_path to '' as $fn$
declare w jsonb; v_s date; v_e date; v_c text; v_who text; v_total int; v_rows jsonb;
begin
  perform public.growth__admin();
  perform public.growth__keys(p, array['start', 'end', 'campus', 'consultant']);
  w := public.growth__cons_window(p);
  v_s := (w->>'start')::date; v_e := (w->>'end')::date; v_c := w->>'campus';
  v_who := lower(public.growth__txt(p, 'consultant', 120));

  with s as materialized (
    select x.lead_id, x.via, x.created_d, x.paid_d, x.enrolled_d, c.consultant_name, c.city, c.bdm, c.category,
           (x.via = 'utm' and public.growth__cons_in(x.created_d, v_s, v_e)) in_lead,
           public.growth__cons_in(x.paid_d, v_s, v_e) in_pay,
           public.growth__cons_in(x.enrolled_d, v_s, v_e) in_enr
      from public.growth__cons_people(v_c) x join public.growth_cons_rows c on c.id = x.row_id
     where v_who is null or lower(btrim(c.consultant_name)) = v_who
  ), f as materialized (
    select * from s where in_lead or in_pay or in_enr
  )
  select (select count(*) from f)::int,
         coalesce((select jsonb_agg(j order by (j->>'registration_date') desc nulls last, j->>'consultant_name', j->>'lead_id') from (
           select jsonb_build_object(
             'lead_id', f.lead_id, 'consultant_name', f.consultant_name, 'city', f.city, 'bdm', f.bdm, 'category', f.category, 'via', f.via,
             'name', lm.registered_name, 'email', lm.registered_email, 'mobile', lm.registered_mobile,
             'registration_date', f.created_d, 'campus_preference', lm.campus_preference,
             'stage', public.growth__cons_stage(f.lead_id),
             'payment_status', case when f.paid_d is not null then 'Paid' else 'Not paid' end,
             'is_paid', f.paid_d is not null, 'is_enrolled', f.enrolled_d is not null,
             'in_lead_window', f.in_lead, 'in_pay_window', f.in_pay, 'in_enr_window', f.in_enr) j
             from f join public.lead_manager lm on lm.lead_id = f.lead_id
            order by f.created_d desc nulls last, f.consultant_name, f.lead_id limit 5000) t), '[]'::jsonb)
    into v_total, v_rows;

  return jsonb_build_object('students', v_rows, 'total', v_total, 'truncated', v_total > 5000, 'window', w);
end $fn$;

-- {} → { targets: { "<city>": n } }
create or replace function public.growth_cons_city_targets_get(p jsonb)
returns jsonb language plpgsql stable security definer set search_path to '' as $fn$
begin
  perform public.growth__admin();
  perform public.growth__keys(p, array[]::text[]);
  return jsonb_build_object('targets', coalesce((select jsonb_object_agg(btrim(t.city), t.target) from public.growth_cons_city_targets t), '{}'::jsonb));
end $fn$;

-- { city, target } → { ok }   (target 0 = no target)
create or replace function public.growth_cons_city_target_set(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $fn$
declare v_city text; v_t numeric;
begin
  perform public.growth__admin();
  perform public.growth__keys(p, array['city', 'target']);
  v_city := public.growth__txt(p, 'city', 80);
  if v_city is null then raise exception 'REQUIRED: city' using errcode = '22023'; end if;
  v_t := public.growth__num(p, 'target', 0, 1000000);
  if v_t is null then raise exception 'REQUIRED: target' using errcode = '22023'; end if;
  if v_t <> trunc(v_t) then raise exception 'BAD_VALUE: target' using errcode = '22023'; end if;
  insert into public.growth_cons_city_targets (city, target, updated_by) values (v_city, v_t::int, auth.uid())
  on conflict (lower(btrim(city))) do update set target = excluded.target, updated_by = auth.uid(), updated_at = now();
  return jsonb_build_object('ok', true);
end $fn$;

-- ═══════════════════════════════ grants ═══════════════════════════════

revoke all on function public.growth__cons_in(date, date, date)  from public, anon, authenticated;
revoke all on function public.growth__cons_stage(uuid)           from public, anon, authenticated;
revoke all on function public.growth__cons_people(text)          from public, anon, authenticated;
revoke all on function public.growth__cons_window(jsonb)         from public, anon, authenticated;

revoke all on function public.growth_cons_perf(jsonb)             from public, anon;
revoke all on function public.growth_cons_perf_students(jsonb)    from public, anon;
revoke all on function public.growth_cons_city_targets_get(jsonb)     from public, anon;
revoke all on function public.growth_cons_city_target_set(jsonb)  from public, anon;
grant execute on function public.growth_cons_perf(jsonb)            to authenticated;
grant execute on function public.growth_cons_perf_students(jsonb)   to authenticated;
grant execute on function public.growth_cons_city_targets_get(jsonb)    to authenticated;
grant execute on function public.growth_cons_city_target_set(jsonb) to authenticated;

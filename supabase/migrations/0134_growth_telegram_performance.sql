-- 0134 · Growth → Marketing channels → Telegram Channel → Telegram Performance (admin only)
--
-- Ports the vedamcrm360 "Telegram Dashboard" (tabs Season, Compare Influencers, Campaign + the influencer student drill)
-- onto the Telegram Listing rows (0132 / 0133). New functions only: nothing of 0132 / 0133 or of other pages changes.
-- Helpers growth__admin, growth__keys, growth__txt, growth__date, growth__campaign_id, growth__leads, growth__cons_in and
-- growth__cons_stage are called, not redefined.
--
-- Who counts (VSAT-scoped, same rule as the Listing's in-window numbers):
--   a lead counts for a live Telegram row when its primary (first-touch) UTM equals the row's UTM key and it registered
--   inside the row's VSAT dates (campaign_start..campaign_end, IST). Staff (@vedam.org) are left out (growth__leads).
-- For a period (From..To, IST days; both optional):
--   Leads        = those leads whose registration day is in the period
--   Payments     = those leads whose first VSAT payment day is in the period
--   Enrollments  = those leads whose enrolment day is in the period
--   CPL spend    = Σ row CPL × row leads;  CPA spend = Σ row CPA × row payments;  Total spend = CPL + CPA spend
--   Overall CPL  = CPL spend / leads;  Overall CPA = CPA spend / payments;  CPP = total spend / payments;
--   L2P %        = payments / leads × 100  (CPL / CPA / CPP / L2P are worked out on screen)
--   Influencers  = distinct influencer names (trimmed, any case) of the rows in view; UTMs = distinct UTM keys.
-- From = 2025-11-20 .. To = today equals the Listing's in-window totals for this season.
--
-- Student drill: one line per lead of one influencer (optional VSAT) who is a lead, a payment or an enrolment inside the
-- period; name, e-mail and mobile are shown to admins (as the CRM and the Consultant drill do), capped at 5,000, no download.
--
-- Security: admin only (growth__admin). Public RPCs: SECURITY DEFINER, search_path '', unknown request keys refused,
-- revoked from public/anon, granted to authenticated. The private helper growth__tgperf_people is not callable by browsers.
--
-- Rollback: supabase/rollback/0134_growth_telegram_performance_down.sql
-- Tests:    supabase/tests/growth_telegram_performance.test.sql

-- every in-window person of the live rows in view (one line per row × lead)
create or replace function public.growth__tgperf_people(p_campaign uuid, p_inf text)
returns table (row_id uuid, lead_id uuid, created_d date, paid_d date, enrolled_d date)
language sql stable security definer set search_path to '' as $fn$
  with r as materialized (
    select a.id, a.utm_key k, c.campaign_start s, c.campaign_end e
      from public.growth_tg_rows a join public.vsat_campaigns c on c.id = a.campaign_id
     where a.deleted_at is null
       and (p_campaign is null or a.campaign_id = p_campaign)
       and (p_inf is null or lower(btrim(a.influencer_name)) = p_inf)
  ), l as materialized (
    select * from public.growth__leads(array(select distinct r.k from r where r.k is not null))
  )
  select r.id, l.lead_id, l.created_d, l.paid_d, l.enrolled_d
    from r join l on l.k = r.k
   where r.s is not null and r.e is not null and l.created_d between r.s and r.e;
$fn$;

-- the filters of a request: start / end (YYYY-MM-DD), campaign (VSAT id or name), influencer (name, any case)
create or replace function public.growth__tgperf_filter(p jsonb)
returns jsonb language plpgsql stable security definer set search_path to '' as $fn$
declare s date; e date; c uuid; i text;
begin
  s := public.growth__date(p, 'start');
  e := public.growth__date(p, 'end');
  if s is not null and e is not null and s > e then raise exception 'BAD_VALUE: start' using errcode = '22023'; end if;
  if nullif(btrim(coalesce(p->>'campaign', '')), '') is not null then c := public.growth__campaign_id(p, 'campaign'); end if;
  i := lower(btrim(public.growth__txt(p, 'influencer', 120)));
  return jsonb_build_object('start', s, 'end', e, 'campaign', c, 'influencer', i);
end $fn$;

-- {} → { campaigns: [{id, name, campaign_start, campaign_end}] newest first, influencers: [{key, name}] A–Z }
create or replace function public.growth_tg_perf_meta(p jsonb)
returns jsonb language plpgsql stable security definer set search_path to '' as $fn$
begin
  perform public.growth__admin();
  perform public.growth__keys(p, array[]::text[]);
  return jsonb_build_object(
    'campaigns', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'campaign_start', c.campaign_start,
                   'campaign_end', c.campaign_end) order by c.campaign_start desc nulls last, c.name) from public.vsat_campaigns c), '[]'::jsonb),
    'influencers', coalesce((select jsonb_agg(jsonb_build_object('key', x.k, 'name', x.name) order by lower(x.name), x.k) from (
                     select lower(btrim(a.influencer_name)) k, (array_agg(btrim(a.influencer_name) order by a.created_at, a.id))[1] name
                       from public.growth_tg_rows a where a.deleted_at is null group by 1) x), '[]'::jsonb));
end $fn$;

-- { start?, end?, campaign?, influencer? } → { kpi: {...}, filter }
create or replace function public.growth_tg_perf(p jsonb)
returns jsonb language plpgsql stable security definer set search_path to '' as $fn$
declare f jsonb; v_s date; v_e date; v_c uuid; v_i text; v_kpi jsonb;
begin
  perform public.growth__admin();
  perform public.growth__keys(p, array['start', 'end', 'campaign', 'influencer']);
  f := public.growth__tgperf_filter(p);
  v_s := (f->>'start')::date; v_e := (f->>'end')::date; v_c := (f->>'campaign')::uuid; v_i := f->>'influencer';

  with r as materialized (
    select a.id, lower(btrim(a.influencer_name)) ik, coalesce(a.utm_key, lower(btrim(a.utm_link))) uk, a.cpl, a.cpa
      from public.growth_tg_rows a
     where a.deleted_at is null and (v_c is null or a.campaign_id = v_c) and (v_i is null or lower(btrim(a.influencer_name)) = v_i)
  ), m as (
    select x.row_id,
           count(*) filter (where public.growth__cons_in(x.created_d, v_s, v_e))::int leads,
           count(*) filter (where public.growth__cons_in(x.paid_d, v_s, v_e))::int payments,
           count(*) filter (where public.growth__cons_in(x.enrolled_d, v_s, v_e))::int enrollments
      from public.growth__tgperf_people(v_c, v_i) x group by 1
  )
  select jsonb_build_object(
           'influencers', count(distinct r.ik), 'utms', count(distinct r.uk),
           'leads', coalesce(sum(m.leads), 0), 'payments', coalesce(sum(m.payments), 0), 'enrollments', coalesce(sum(m.enrollments), 0),
           'cpl_spend', coalesce(sum(coalesce(r.cpl, 0) * coalesce(m.leads, 0)), 0),
           'cpa_spend', coalesce(sum(coalesce(r.cpa, 0) * coalesce(m.payments, 0)), 0))
    into v_kpi
    from r left join m on m.row_id = r.id;

  return jsonb_build_object('kpi', v_kpi, 'filter', f);
end $fn$;

-- { influencer, start?, end?, campaign? } → { students: [...max 5000], total, truncated, filter }
create or replace function public.growth_tg_perf_students(p jsonb)
returns jsonb language plpgsql stable security definer set search_path to '' as $fn$
declare f jsonb; v_s date; v_e date; v_c uuid; v_i text; v_total int; v_rows jsonb;
begin
  perform public.growth__admin();
  perform public.growth__keys(p, array['start', 'end', 'campaign', 'influencer']);
  f := public.growth__tgperf_filter(p);
  v_s := (f->>'start')::date; v_e := (f->>'end')::date; v_c := (f->>'campaign')::uuid; v_i := f->>'influencer';
  if v_i is null then raise exception 'REQUIRED: influencer' using errcode = '22023'; end if;

  with x as materialized (       -- each lead once (its earliest matching row)
    select distinct on (x.lead_id) x.lead_id, x.created_d, x.paid_d, x.enrolled_d
      from public.growth__tgperf_people(v_c, v_i) x
     where public.growth__cons_in(x.created_d, v_s, v_e) or public.growth__cons_in(x.paid_d, v_s, v_e)
        or public.growth__cons_in(x.enrolled_d, v_s, v_e)
     order by x.lead_id, x.created_d
  )
  select (select count(*) from x)::int,
         coalesce((select jsonb_agg(j order by (j->>'registration_date') desc nulls last, j->>'lead_id') from (
           select jsonb_build_object(
             'lead_id', x.lead_id, 'name', lm.registered_name, 'email', lm.registered_email, 'mobile', lm.registered_mobile,
             'registration_date', x.created_d, 'campus_preference', lm.campus_preference,
             'stage', public.growth__cons_stage(x.lead_id),
             'payment_status', case when x.paid_d is not null then 'Paid' else 'Not paid' end) j
             from x join public.lead_manager lm on lm.lead_id = x.lead_id
            order by x.created_d desc nulls last, x.lead_id limit 5000) t), '[]'::jsonb)
    into v_total, v_rows;

  return jsonb_build_object('students', v_rows, 'total', v_total, 'truncated', v_total > 5000, 'filter', f);
end $fn$;

revoke all on function public.growth__tgperf_people(uuid, text)      from public, anon, authenticated;
revoke all on function public.growth__tgperf_filter(jsonb)           from public, anon, authenticated;
revoke all on function public.growth_tg_perf_meta(jsonb)         from public, anon;
revoke all on function public.growth_tg_perf(jsonb)              from public, anon;
revoke all on function public.growth_tg_perf_students(jsonb)     from public, anon;
grant execute on function public.growth_tg_perf_meta(jsonb)      to authenticated;
grant execute on function public.growth_tg_perf(jsonb)           to authenticated;
grant execute on function public.growth_tg_perf_students(jsonb)  to authenticated;

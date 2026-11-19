-- 0121 · Growth · one lead rule on the Overview pages (Season Dashboard, Payment Cohort)
--
-- Before: the three Overview pages counted "Leads" in different ways.
--   * Season Dashboard      — by lead_manager.created_at, staff included
--   * Payment Cohort        — by user_registration_date, staff included
--   * VSAT Campaign Report  — by user_registration_date, staff (@vedam.org) left out
-- So one campaign could show 520 / 520 / 519 leads.
--
-- Now (owner decision, 19 Nov 2026):
--   * A lead is counted on its registration day (user_registration_date, IST). On the Season Dashboard a lead
--     with an empty registration date falls back to the day its row was made — the date its list already shows.
--   * A lead whose email ends in @vedam.org (any case) is staff and is never a lead. A lead without an email
--     still counts.
--   * Payments and enrolments are NOT changed: a staff account that paid is still a payment, as on the report.
--
-- Changed:
--   * growth__season_ids(text, date, date, date) — only the 'leads' branch. The Leads list (growth__season_rows)
--     reads this function, so the card and the list still agree.
--   * growth__cohort_data(jsonb, date)           — only the lead-day counts.
--
-- Not touched: VSAT Campaign Report (already this rule), growth__lead_rows, growth__paid_rows, the Paid and
-- Enrolments rules, every Ads / Influencers function (growth__leads, growth_perf, growth_rows_list, …), any
-- table, RLS, grants.
-- Still different after this file: a lead with an EMPTY registration date is a lead on the Season Dashboard
-- (creation day) but has no lead day on the Payment Cohort / the report (their "unknown" handling is unchanged).
-- Rollback: supabase/rollback/0121_growth_overview_lead_rule_down.sql

create or replace function public.growth__season_ids(p_kind text, p_from date, p_to date, p_exam date)
returns setof uuid language plpgsql stable security definer set search_path to '' as $fn$
begin
  if p_kind = 'leads' then
    -- 0121: the lead's registration day (its row's creation day when that is empty); staff (@vedam.org) are not leads
    return query select lm.lead_id from public.lead_manager lm
      where (coalesce(lm.user_registration_date, lm.created_at) at time zone 'Asia/Kolkata')::date between p_from and p_to
        and (lm.registered_email is null or lm.registered_email not ilike '%@vedam.org');
  elsif p_kind = 'paid' then
    return query select vp.lead_id
      from (select x.lead_id, (min(x.paid_at) at time zone 'Asia/Kolkata')::date d from public.vsat_payments x group by x.lead_id) vp
      where exists (select 1 from public.lead_manager lm where lm.lead_id = vp.lead_id)   -- 0109: only leads the list can show
        and case when p_exam is null then vp.d between p_from and p_to
                 else exists (select 1 from public.application_manager am join public.vsat_exam_dates ed on ed.id = am.exam_date_id
                               where am.lead_id = vp.lead_id and ed.exam_date = p_exam) end;
  elsif p_kind = 'enrolled' then
    return query select e.lead_id
      from (select am.lead_id,
                   (min(coalesce(am.enrollment_paid_at, am.last_updated_date)) at time zone 'Asia/Kolkata')::date d,
                   coalesce(bool_or(ed.exam_date = p_exam), false) on_exam
              from public.application_manager am left join public.vsat_exam_dates ed on ed.id = am.exam_date_id
             where am.enrollment_stage = 'approved' and am.lead_id is not null
             group by am.lead_id) e
      where case when p_exam is null then e.d between p_from and p_to else e.on_exam end;
  end if;
end $fn$;

create or replace function public.growth__cohort_data(p jsonb, p_today date)
returns jsonb language plpgsql stable security invoker set search_path to '' as $fn$
declare
  w record;
  f date; t date;
  v_locked boolean := false;
  v_source text;
  v_camp jsonb := 'null'::jsonb;
  v_leads jsonb; v_cells jsonb; v_before jsonb; v_after jsonb; v_unknown jsonb;
  v_bd int; v_ad int;
begin
  p := coalesce(p, '{}'::jsonb);
  perform public.growth__keys(p, array['campaign_id', 'from', 'to']);

  if (p ? 'campaign_id' and jsonb_typeof(p->'campaign_id') <> 'null') or p ? 'from' or p ? 'to' then
    select * into w from public.growth__season_window(p);
    f := w.d_from; t := w.d_to; v_locked := w.locked;
    if w.locked then
      v_source := 'campaign';
      v_camp := jsonb_build_object('id', (p->>'campaign_id')::uuid, 'name', w.camp_name);
    else
      v_source := 'custom';
    end if;
  else
    t := p_today; f := p_today - 29; v_source := 'default';
  end if;

  -- a campaign row whose start is after its end (no table constraint stops it) is an error, never an empty report;
  -- typed dates are already refused by growth__season_window (BAD_VALUE: to)
  if t < f then raise exception 'BAD_VALUE: campaign_id' using errcode = '22023'; end if;
  if t - f + 1 > 120 then raise exception 'BAD_VALUE: range' using errcode = '22023'; end if;

  select coalesce(jsonb_agg(jsonb_build_object('d', x.d, 'n', x.n) order by x.d), '[]'::jsonb)
    into v_leads
    from (select lr.lead_on as d, count(*) as n from public.growth__lead_rows(f, t) lr
           where lr.email is null or lr.email not ilike '%@vedam.org'   -- 0121: staff are not leads (same as the VSAT Campaign Report)
           group by 1) x;

  with pr as materialized (select r.paid_on, r.lead_on from public.growth__paid_rows(f, t) r)
  select
    (select coalesce(jsonb_agg(jsonb_build_object('l', c.l, 'p', c.p, 'n', c.n) order by c.l, c.p), '[]'::jsonb)
       from (select pr.lead_on as l, pr.paid_on as p, count(*) as n from pr where pr.lead_on between f and t group by 1, 2) c),
    (select coalesce(jsonb_agg(jsonb_build_object('p', b.p, 'n', b.n) order by b.p), '[]'::jsonb)
       from (select pr.paid_on as p, count(*) as n from pr where pr.lead_on < f group by 1) b),
    (select count(distinct pr.lead_on)::int from pr where pr.lead_on < f),
    (select coalesce(jsonb_agg(jsonb_build_object('p', a.p, 'n', a.n) order by a.p), '[]'::jsonb)
       from (select pr.paid_on as p, count(*) as n from pr where pr.lead_on > t group by 1) a),
    (select count(distinct pr.lead_on)::int from pr where pr.lead_on > t),
    (select coalesce(jsonb_agg(jsonb_build_object('p', u.p, 'n', u.n) order by u.p), '[]'::jsonb)
       from (select pr.paid_on as p, count(*) as n from pr where pr.lead_on is null group by 1) u)
    into v_cells, v_before, v_bd, v_after, v_ad, v_unknown;

  return jsonb_build_object(
    'from', f, 'to', t, 'today', p_today, 'locked', v_locked, 'source', v_source, 'campaign', v_camp,
    'leads', v_leads, 'cells', v_cells,
    'before', v_before, 'before_days', v_bd,
    'after', v_after, 'after_days', v_ad,
    'unknown', v_unknown);
end $fn$;

-- create or replace keeps the grants of 0109 / 0117; restated so this file is complete on its own
revoke all on function public.growth__season_ids(text, date, date, date) from public, anon, authenticated;
revoke all on function public.growth__cohort_data(jsonb, date) from public, anon, authenticated;

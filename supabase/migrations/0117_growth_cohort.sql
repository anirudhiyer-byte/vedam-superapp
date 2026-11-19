-- 0117 · Growth · Payment Cohort (VSAT Admin → Growth → Overview → Payment Cohort), admin only.
--
-- Copy of the Vedam CRM page /cohort on Vedam One's own data: lead date × payment date matrix.
-- Only day-wise counts leave the database (never a name, email, phone or id of a person).
--
--   window   = a campaign's campaign_start .. campaign_end (locked)        — request {"campaign_id": uuid}
--              or the dates sent                                           — request {"from": d, "to": d}
--              or, with nothing sent, IST today − 29 .. today (decided here, never by the browser)
--              Checks come from public.growth__season_window (0108): campaign + dates together → BAD_VALUE: from,
--              bad id → BAD_VALUE: campaign_id, unknown id → NOT_FOUND, campaign without dates → BAD_VALUE: campaign_id,
--              missing date → REQUIRED: from|to, to < from → BAD_VALUE: to.
--   limit    = at most 120 days (both ends included) → else BAD_VALUE: range (also for a long campaign window).
--   leads    = public.growth__lead_rows (0116): lead_manager by the IST date of user_registration_date.
--              (@vedam.org addresses are NOT excluded here — owner's rule for this page, same as the CRM page.)
--   paid     = public.growth__paid_rows (0116): the Season Dashboard rule (0109) — first vsat_payments.paid_at per lead,
--              IST date inside the window, only leads that exist in lead_manager. ("paid" is ONLY vsat_payments.)
--   buckets  = every paid lead lands in exactly one place, so totals reconcile:
--                lead date inside the window → cells (lead day × pay day)
--                lead date before `from`     → before  (+ before_days = how many different earlier lead days)
--                lead date after `to`        → after   (+ after_days)          (owner's choice; the CRM has no row)
--                no lead date                → unknown
--
-- Security: admin only (growth__admin → is_admin()), checked first in the public function. SECURITY DEFINER,
-- search_path '', public function revoked from public/anon and granted to authenticated; the private helper is revoked
-- from everyone (also authenticated). Request keys: campaign_id | from | to only; unknown keys are refused. Read only.
--
-- Not touched: any table, RLS, existing function (growth__keys, growth__season_window, growth__lead_rows and
-- growth__paid_rows are only called).
-- Rollback: supabase/rollback/0117_growth_cohort_down.sql
-- Tests:    supabase/tests/growth_cohort.test.sql

-- the whole matrix for one request on one IST day (p_today is a parameter so tests can fix it)
create or replace function public.growth__cohort_data(p jsonb, p_today date)
returns jsonb language plpgsql stable security definer set search_path to '' as $fn$
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

  if t - f + 1 > 120 then raise exception 'BAD_VALUE: range' using errcode = '22023'; end if;

  select coalesce(jsonb_agg(jsonb_build_object('d', x.d, 'n', x.n) order by x.d), '[]'::jsonb)
    into v_leads
    from (select lr.lead_on as d, count(*) as n from public.growth__lead_rows(f, t) lr group by 1) x;

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

-- public: the page calls only this
create or replace function public.growth_cohort_report(p jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path to '' as $fn$
begin
  perform public.growth__admin();
  return public.growth__cohort_data(p, (now() at time zone 'Asia/Kolkata')::date);
end $fn$;

-- grants: browsers may call only growth_cohort_report
revoke all on function public.growth__cohort_data(jsonb, date) from public, anon, authenticated;
revoke all on function public.growth_cohort_report(jsonb) from public, anon;
grant execute on function public.growth_cohort_report(jsonb) to authenticated;

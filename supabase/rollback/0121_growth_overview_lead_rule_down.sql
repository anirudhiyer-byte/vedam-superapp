-- Rollback of 0121 · Growth · one lead rule on the Overview pages
--
-- Puts back growth__season_ids (0109) and growth__cohort_data (0117) exactly as they were:
-- Season Dashboard leads by created_at with staff included; Payment Cohort lead days with staff included.
-- No data is changed.

create or replace function public.growth__season_ids(p_kind text, p_from date, p_to date, p_exam date)
returns setof uuid language plpgsql stable security definer set search_path to '' as $fn$
begin
  if p_kind = 'leads' then
    return query select lm.lead_id from public.lead_manager lm
      where (lm.created_at at time zone 'Asia/Kolkata')::date between p_from and p_to;
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

revoke all on function public.growth__season_ids(text, date, date, date) from public, anon, authenticated;
revoke all on function public.growth__cohort_data(jsonb, date) from public, anon, authenticated;

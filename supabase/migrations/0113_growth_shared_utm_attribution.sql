-- 0113 · Growth performance: a lead counts for ONE ad / post, even when several rows share a UTM
--
-- Before (0105): in Ad / Influencer Performance every row got all the leads of its UTM. Two ads with
-- the same UTM link (e.g. "Reel – JEE droppers" in VSAT-8 and its rerun in VSAT-9) both showed the
-- same leads and payments, so a row's CPL / CPP was wrong and a plain sum of rows double counted.
--
-- Now every lead of a UTM has one owner row (growth__owned_leads), among the active rows of the same
-- channel with that UTM, picked in this order:
--   1. a row whose campaign window (campaign_start .. campaign_end) contains the lead's arrival date
--   2. else the row that went live most recently on or before the arrival date
--      (went live = live_date, else the campaign start, else the day the row was added)
--   3. else (every row went live after the lead) the row that went live first
--   ties: the one that went live most recently before the lead, then the row id (stable)
-- growth_perf counts a row's leads / payments / enrollments from the leads it owns (date view and
-- campaign view; the campaign view still keeps only the leads that arrived inside the row's
-- campaign dates). growth_weekly counts the leads owned by the given rows.
-- So rows never overlap: the totals of any set of rows are a plain sum.
--
-- Not changed: the listing (growth_rows_list / growth__row_attr) keeps "in-window" per row and
-- "all-time" per UTM, as on the CRM; growth__leads; grants of the public RPCs.
--
-- Rollback: supabase/rollback/0113_growth_shared_utm_attribution_down.sql

-- every lead whose primary UTM is one of p_keys, with the row (of p_channel) that owns it
create or replace function public.growth__owned_leads(p_channel text, p_keys text[])
returns table (lead_id uuid, k text, created_d date, paid_d date, enrolled_d date, row_id uuid)
language sql stable security definer set search_path to '' as $fn$
  with r as materialized (
    select a.id, public.growth__utm_key(a.utm_link) k, c.campaign_start s, c.campaign_end e,
           coalesce(a.live_date, c.campaign_start, (a.created_at at time zone 'Asia/Kolkata')::date) st
      from public.growth_ad_rows a left join public.vsat_campaigns c on c.id = a.campaign_id
     where p_channel = 'ads' and a.deleted_at is null
    union all
    select a.id, public.growth__utm_key(a.utm_link), c.campaign_start, c.campaign_end,
           coalesce(a.live_date, c.campaign_start, (a.created_at at time zone 'Asia/Kolkata')::date)
      from public.growth_infl_posts a left join public.vsat_campaigns c on c.id = a.campaign_id
     where p_channel = 'influencers' and a.deleted_at is null
  ), rk as materialized (
    select * from r where r.k = any (p_keys)
  )
  select l.lead_id, l.k, l.created_d, l.paid_d, l.enrolled_d, o.id
    from public.growth__leads(p_keys) l
    cross join lateral (
      select rk.id from rk
       where rk.k = l.k
       order by (l.created_d between rk.s and rk.e) is true desc,
                (rk.st <= l.created_d) desc,
                case when rk.st <= l.created_d then rk.st end desc nulls last,
                rk.st asc,
                rk.id
       limit 1
    ) o;
$fn$;

revoke all on function public.growth__owned_leads(text, text[]) from public, anon, authenticated;

-- performance rows: { channel, from?, to?, campaign_ids?: [...], live?: 'live'|'planned'|'all' }
-- campaign filter = in-window cohort of those campaigns' rows; else date range by event date (see 0105 header).
-- A row counts only the leads it owns (see header).
create or replace function public.growth_perf(p jsonb)
returns jsonb language plpgsql stable security definer set search_path to '' as $fn$
declare ch text; v_from date; v_to date; v_camps uuid[]; v_live text; v_rows jsonb;
begin
  perform public.growth__admin();
  perform public.growth__keys(p, array['channel', 'from', 'to', 'campaign_ids', 'live']);
  ch := public.growth__channel(p);
  v_from := public.growth__date(p, 'from'); v_to := public.growth__date(p, 'to');
  if v_from is not null and v_to is not null and v_to < v_from then raise exception 'BAD_VALUE: to' using errcode = '22023'; end if;
  if p ? 'campaign_ids' and jsonb_typeof(p->'campaign_ids') <> 'null' then
    if jsonb_typeof(p->'campaign_ids') <> 'array' or jsonb_array_length(p->'campaign_ids') > 100 then raise exception 'BAD_VALUE: campaign_ids' using errcode = '22023'; end if;
    begin select array_agg(x::uuid) into v_camps from jsonb_array_elements_text(p->'campaign_ids') x;
    exception when others then raise exception 'BAD_VALUE: campaign_ids' using errcode = '22023'; end;
  end if;
  v_live := coalesce(p->>'live', 'all');
  if v_live not in ('live', 'planned', 'all') then raise exception 'BAD_VALUE: live' using errcode = '22023'; end if;

  with r as (
    select a.id, public.growth__utm_key(a.utm_link) k, a.campaign_id, c.name campaign, c.campaign_start s, c.campaign_end e,
           a.spend cost, a.platform, a.live_date, a.ad_name label, null::uuid influencer_id, null::text influencer, null::bigint views,
           a.campaign_status status, null::text live_link, a.utm_link
      from public.growth_ad_rows a left join public.vsat_campaigns c on c.id = a.campaign_id
     where ch = 'ads' and a.deleted_at is null
    union all
    select a.id, public.growth__utm_key(a.utm_link), a.campaign_id, c.name, c.campaign_start, c.campaign_end,
           a.cost, a.platform, a.live_date, i.name, a.influencer_id, i.name, a.actual_views, a.live_status, a.live_link, a.utm_link
      from public.growth_infl_posts a join public.growth_influencers i on i.id = a.influencer_id
      left join public.vsat_campaigns c on c.id = a.campaign_id
     where ch = 'influencers' and a.deleted_at is null
       and (v_live = 'all' or lower(a.live_status) = v_live)
  ), f as (
    select * from r where v_camps is null or r.campaign_id = any (v_camps)
  ), l as materialized (
    select * from public.growth__owned_leads(ch, array(select distinct k from f where k is not null))
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', f.id, 'utm_key', f.k, 'campaign_id', f.campaign_id, 'campaign', f.campaign, 'cost', f.cost, 'platform', f.platform,
      'live_date', f.live_date, 'label', f.label, 'influencer_id', f.influencer_id, 'influencer', f.influencer, 'views', f.views,
      'status', f.status, 'live_link', f.live_link, 'utm_link', f.utm_link,
      'leads', m.leads, 'payments', m.payments, 'enrollments', m.enrollments)), '[]'::jsonb)
    into v_rows
    from f
    cross join lateral (
      select
        count(*) filter (where v_camps is null and (v_from is null or l.created_d >= v_from) and (v_to is null or l.created_d <= v_to)
                         or v_camps is not null and l.created_d between f.s and f.e
                            and (v_from is null or l.created_d >= v_from) and (v_to is null or l.created_d <= v_to))::int leads,
        count(*) filter (where l.paid_d is not null and (
                           v_camps is null and (v_from is null or l.paid_d >= v_from) and (v_to is null or l.paid_d <= v_to)
                           or v_camps is not null and l.created_d between f.s and f.e
                              and (v_from is null or l.created_d >= v_from) and (v_to is null or l.created_d <= v_to)))::int payments,
        count(*) filter (where l.enrolled_d is not null and (
                           v_camps is null and (v_from is null or l.enrolled_d >= v_from) and (v_to is null or l.enrolled_d <= v_to)
                           or v_camps is not null and l.created_d between f.s and f.e
                              and (v_from is null or l.created_d >= v_from) and (v_to is null or l.created_d <= v_to)))::int enrollments
        from l where l.row_id = f.id
    ) m
   -- a date range with no campaign keeps the rows that went live in it or had a lead / payment /
   -- enrollment in it (their spend counts); a campaign filter keeps all of the campaign's rows
   where v_camps is not null or (v_from is null and v_to is null)
      or (f.live_date is not null and (v_from is null or f.live_date >= v_from) and (v_to is null or f.live_date <= v_to))
      or m.leads + m.payments + m.enrollments > 0;
  return jsonb_build_object('rows', v_rows);
end $fn$;

-- weekly leads / payments / enrollments for a set of rows: { channel, ids: [...], campaign_id? }
-- only the leads those rows own (see header), each once. With a campaign: only the rows of that
-- campaign and the leads that arrived in its window (the cohort).
create or replace function public.growth_weekly(p jsonb)
returns jsonb language plpgsql stable security definer set search_path to '' as $fn$
declare ch text; v_ids uuid[]; v_camp uuid; s date; e date; v_out jsonb;
begin
  perform public.growth__admin();
  perform public.growth__keys(p, array['channel', 'ids', 'campaign_id']);
  ch := public.growth__channel(p);
  if jsonb_typeof(p->'ids') is distinct from 'array' or jsonb_array_length(p->'ids') = 0 or jsonb_array_length(p->'ids') > 2000 then
    raise exception 'BAD_VALUE: ids' using errcode = '22023';
  end if;
  begin select array_agg(x::uuid) into v_ids from jsonb_array_elements_text(p->'ids') x;
  exception when others then raise exception 'BAD_VALUE: ids' using errcode = '22023'; end;
  if p ? 'campaign_id' and jsonb_typeof(p->'campaign_id') <> 'null' then
    v_camp := public.growth__campaign_id(p, 'campaign_id');
    select campaign_start, campaign_end into s, e from public.vsat_campaigns where id = v_camp;
  end if;
  with mine as (
    select id, public.growth__utm_key(utm_link) k from public.growth_ad_rows
     where ch = 'ads' and id = any (v_ids) and (v_camp is null or campaign_id = v_camp)
    union all
    select id, public.growth__utm_key(utm_link) from public.growth_infl_posts
     where ch = 'influencers' and id = any (v_ids) and (v_camp is null or campaign_id = v_camp)
  ), l as materialized (
    select * from public.growth__owned_leads(ch, array(select distinct k from mine where k is not null))
     where row_id in (select id from mine) and (v_camp is null or created_d between s and e)
  ), ev as (
    select date_trunc('week', created_d)::date wk, 1 a, 0 b, 0 c from l
    union all select date_trunc('week', paid_d)::date, 0, 1, 0 from l where paid_d is not null
    union all select date_trunc('week', enrolled_d)::date, 0, 0, 1 from l where enrolled_d is not null
  )
  select coalesce(jsonb_agg(jsonb_build_object('week', wk, 'leads', a, 'payments', b, 'enrollments', c) order by wk), '[]'::jsonb)
    into v_out
    from (select wk, sum(a)::int a, sum(b)::int b, sum(c)::int c from ev group by wk) w;
  return jsonb_build_object('weeks', v_out, 'from', s, 'to', e);
end $fn$;

-- create or replace keeps the grants of 0105; restated so this file is complete on its own
revoke all on function public.growth_perf(jsonb) from public, anon;
revoke all on function public.growth_weekly(jsonb) from public, anon;
grant execute on function public.growth_perf(jsonb) to authenticated;
grant execute on function public.growth_weekly(jsonb) to authenticated;

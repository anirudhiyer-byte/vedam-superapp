-- Rollback of 0113_growth_shared_utm_attribution.sql — puts back the 0105 versions of growth_perf and
-- growth_weekly (every row sharing a UTM gets all of that UTM's leads again) and drops the owner helper.
-- The two function bodies below are copied unchanged from 0105_growth_ads_influencers.sql.

-- performance rows: { channel, from?, to?, campaign_ids?: [...], live?: 'live'|'planned'|'all' }
-- campaign filter = in-window cohort of those campaigns' rows; else date range by event date (see header)
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
    select * from public.growth__leads(array(select distinct k from f where k is not null))
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
        from l where f.k is not null and l.k = f.k
    ) m
   -- a date range with no campaign keeps the rows that went live in it or had a lead / payment /
   -- enrollment in it (their spend counts); a campaign filter keeps all of the campaign's rows
   where v_camps is not null or (v_from is null and v_to is null)
      or (f.live_date is not null and (v_from is null or f.live_date >= v_from) and (v_to is null or f.live_date <= v_to))
      or m.leads + m.payments + m.enrollments > 0;
  return jsonb_build_object('rows', v_rows);
end $fn$;

-- weekly leads / payments / enrollments for a set of rows: { channel, ids: [...], campaign_id? }
-- leads are counted once even when several of the rows share a UTM. With a campaign: only the rows of
-- that campaign and the leads that arrived in its window (the cohort).
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
  with k as (
    select distinct public.growth__utm_key(utm_link) k from public.growth_ad_rows
     where ch = 'ads' and id = any (v_ids) and (v_camp is null or campaign_id = v_camp)
    union
    select distinct public.growth__utm_key(utm_link) from public.growth_infl_posts
     where ch = 'influencers' and id = any (v_ids) and (v_camp is null or campaign_id = v_camp)
  ), l as materialized (
    select * from public.growth__leads(array(select k from k where k is not null))
     where v_camp is null or created_d between s and e
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

drop function if exists public.growth__owned_leads(text, text[]);

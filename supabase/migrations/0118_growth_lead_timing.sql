-- 0118 · Growth performance: when leads arrive after a post / ad goes live
--
-- New read-only RPC growth_lead_timing for the "When leads arrive after a post goes live" chart in
-- Influencer Performance → Influencer Compare. For a set of rows it counts the leads they own
-- (growth__owned_leads, 0113: each lead once) by the days between the lead's arrival date and the
-- row's own live_date:
--   before  = arrived before the row's live date (often a wrong live date or a reused UTM link)
--   d0_7    = live day .. 7 days after
--   d8_30   = 8 .. 30 days after
--   d31p    = more than 30 days after
--   no_live = the row has no live date yet
-- The leads counted are the same as growth_perf's leads for those rows:
--   campaign_id given → only that campaign's rows and the leads that arrived in its window (cohort)
--   else              → the leads that arrived between from and to (each optional)
--
-- Security: admin only (growth__admin), unknown keys refused (growth__keys), SECURITY DEFINER with an
-- empty search_path, execute for authenticated only. Nothing is written.
--
-- Rollback: supabase/rollback/0118_growth_lead_timing_down.sql

-- { channel, ids: [...], campaign_id?, from?, to? } → { before, d0_7, d8_30, d31p, no_live }
create or replace function public.growth_lead_timing(p jsonb)
returns jsonb language plpgsql stable security definer set search_path to '' as $fn$
declare ch text; v_ids uuid[]; v_camp uuid; s date; e date; v_from date; v_to date; v_out jsonb;
begin
  perform public.growth__admin();
  perform public.growth__keys(p, array['channel', 'ids', 'campaign_id', 'from', 'to']);
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
  v_from := public.growth__date(p, 'from'); v_to := public.growth__date(p, 'to');
  if v_from is not null and v_to is not null and v_to < v_from then raise exception 'BAD_VALUE: to' using errcode = '22023'; end if;

  with mine as (
    select id, public.growth__utm_key(utm_link) k, live_date from public.growth_ad_rows
     where ch = 'ads' and id = any (v_ids) and deleted_at is null and (v_camp is null or campaign_id = v_camp)
    union all
    select id, public.growth__utm_key(utm_link), live_date from public.growth_infl_posts
     where ch = 'influencers' and id = any (v_ids) and deleted_at is null and (v_camp is null or campaign_id = v_camp)
  ), l as materialized (
    select o.created_d - m.live_date d, m.live_date
      from public.growth__owned_leads(ch, array(select distinct k from mine where k is not null)) o
      join mine m on m.id = o.row_id
     where (v_camp is null or o.created_d between s and e)
       and (v_from is null or o.created_d >= v_from) and (v_to is null or o.created_d <= v_to)
  )
  select jsonb_build_object(
           'before',  count(*) filter (where live_date is not null and d < 0),
           'd0_7',    count(*) filter (where d between 0 and 7),
           'd8_30',   count(*) filter (where d between 8 and 30),
           'd31p',    count(*) filter (where d > 30),
           'no_live', count(*) filter (where live_date is null))
    into v_out
    from l;
  return v_out;
end $fn$;

revoke all on function public.growth_lead_timing(jsonb) from public, anon;
grant execute on function public.growth_lead_timing(jsonb) to authenticated;

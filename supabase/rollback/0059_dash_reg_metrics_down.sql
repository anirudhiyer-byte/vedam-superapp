-- Rollback 0059 · restore dash_registration_funnel and dash_product_leads to their
-- pre-0059 bodies (session-gated funnel registered; product leads = action ∪ UTM).
-- Exact inverse; CREATE OR REPLACE preserves grants/ACLs.

create or replace function public.dash_registration_funnel(p_from timestamp with time zone, p_to timestamp with time zone)
 returns table(new_visitors bigint, attempted bigint, registered bigint, registered_partial bigint, registered_full bigint, drop_off bigint, mql bigint)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not public.is_admin() then
    return query select 0::bigint,0::bigint,0::bigint,0::bigint,0::bigint,0::bigint,0::bigint; return;
  end if;
  return query
  with sess as (
    select session_id, (max(user_id::text))::uuid as user_id
    from public.traffic_events
    where kind='view' and session_id is not null and created_at >= p_from and created_at < p_to
    group by session_id
  ),
  att as (
    select distinct session_id from public.traffic_events
    where kind='view' and path='/register' and session_id is not null and created_at >= p_from and created_at < p_to
  ),
  reg as (
    select distinct s.session_id, coalesce(p.profile_completed,false) as is_full, p.stream, p.grad_year
    from sess s
    join public.profiles p
      on (p.signup_session_id = s.session_id or p.id = s.user_id)
     and p.created_at >= p_from and p.created_at < p_to
  )
  select
    (select count(*) from sess),
    (select count(*) from att),
    (select count(distinct session_id) from reg),
    (select count(distinct session_id) from reg where is_full = false),
    (select count(distinct session_id) from reg where is_full = true),
    greatest((select count(*) from att) - (select count(distinct session_id) from reg), 0),
    (select count(distinct session_id) from reg where stream in ('PCM','PCMB') and grad_year in (2026,2027));
end $function$;

create or replace function public.dash_product_leads(p_product text, p_from timestamp with time zone, p_to timestamp with time zone)
 returns table(total_leads bigint, leads bigint, mql bigint, spend numeric)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_path text := case when p_product='codesprint' then '/codesprint' else '/events' end;
begin
  if not public.is_admin() then return query select 0::bigint,0::bigint,0::bigint,0::numeric; return; end if;
  return query
  with camp as (
    select distinct lower(c) as c from (
      select nullif(btrim(substring(utm_link from 'utm_campaign=([^&[:space:]]+)')),'') c
        from public.growth_cs_banner_utms where p_product='codesprint' and not coalesce(is_trashed,false)
      union all
      select nullif(btrim(utm_campaign),'') from public.growth_cs_banner_utms where p_product='codesprint' and not coalesce(is_trashed,false)
      union all
      select nullif(btrim(substring(utm_link from 'utm_campaign=([^&[:space:]]+)')),'')
        from public.growth_cs_cost_rows where p_product='codesprint' and not coalesce(is_trashed,false)
      union all
      select nullif(btrim(substring(utm_link from 'utm_campaign=([^&[:space:]]+)')),'')
        from public.growth_events_rows where p_product='bootcamp' and not coalesce(is_trashed,false)
      union all
      select nullif(btrim(substring(utm_link from 'utm_campaign=([^&[:space:]]+)')),'')
        from public.growth_events_manual where p_product='bootcamp' and not coalesce(is_trashed,false)
    ) s where c is not null
  ),
  action_users as (
    select distinct user_id from public.bootcamp_participation
      where p_product='bootcamp' and registered_at >= p_from and registered_at < p_to
    union
    select distinct user_id from public.cs_enrollments
      where p_product='codesprint' and enrolled_at >= p_from and enrolled_at < p_to
  ),
  utm_users as (
    select id as user_id from public.profiles
      where created_at >= p_from and created_at < p_to
        and ( lower(coalesce(utm_campaign,'')) in (select c from camp) or landing_path ilike v_path||'%' )
  ),
  lead_users as (select user_id from action_users union select user_id from utm_users)
  select
    (select count(*) from public.profiles where created_at >= p_from and created_at < p_to),
    (select count(*) from lead_users),
    (select count(*) from lead_users lu join public.profiles pr on pr.id = lu.user_id
        where pr.stream in ('PCM','PCMB') and pr.grad_year in (2026,2027)),
    (case when p_product='codesprint'
       then (select coalesce(sum(total_cost),0) from public.growth_cs_cost_rows where not coalesce(is_trashed,false))
       else (select coalesce(sum(coalesce(ad_spend,0)+coalesce(influencer_spend,0)+coalesce(comms_spend,0)+coalesce(telegram_spend,0)+coalesce(host_spend,0)+coalesce(price_spend,0)),0) from public.growth_events_rows where not coalesce(is_trashed,false))
          + (select coalesce(sum(coalesce(ad_spend,0)+coalesce(influencer_spend,0)+coalesce(comms_spend,0)+coalesce(telegram_spend,0)+coalesce(host_spend,0)+coalesce(price_spend,0)),0) from public.growth_events_manual where not coalesce(is_trashed,false))
     end);
end $function$;

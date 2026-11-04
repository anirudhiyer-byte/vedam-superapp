-- 0059 · Fix the admin registration/registration-funnel metrics.
--
-- (#6/#7) dash_registration_funnel: "Registered" was gated on a tracked visitor
--   session (traffic_events), so it undercounted (1,215 vs the true 1,329 signups)
--   and disagreed with "Product Registration" on the product dashboards. Registered
--   / partial / full / MQR now count ALL profiles created in the window — the same
--   population Product Registration uses — so the two dashboards agree. New Visitors
--   and Attempted stay session-based (that is the genuine visitor funnel).
--
-- (#8/#9) dash_product_leads: the "<product> Registrations" metric cross-counted
--   anyone who merely landed on /events|/codesprint or carried a product UTM, which
--   inflated it well past the people who actually registered. It now counts ONLY real
--   registrations — bootcamp = bootcamp_participation (= event_registrations),
--   codesprint = cs_enrollments, and a NEW pyq branch = pyq_attempts. "Product
--   Registration" (all platform signups) and the spend logic are unchanged.
--
-- CREATE OR REPLACE preserves existing grants/ACLs; no grant changes here.

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
    select session_id
    from public.traffic_events
    where kind='view' and session_id is not null and created_at >= p_from and created_at < p_to
    group by session_id
  ),
  att as (
    select distinct session_id from public.traffic_events
    where kind='view' and path='/register' and session_id is not null and created_at >= p_from and created_at < p_to
  ),
  regs as (
    select coalesce(p.profile_completed,false) as is_full, p.stream, p.grad_year
    from public.profiles p
    where p.created_at >= p_from and p.created_at < p_to
  )
  select
    (select count(*) from sess),
    (select count(*) from att),
    (select count(*) from regs),
    (select count(*) from regs where is_full = false),
    (select count(*) from regs where is_full = true),
    greatest((select count(*) from att) - (select count(*) from regs), 0),
    (select count(*) from regs where stream in ('PCM','PCMB') and grad_year in (2026,2027));
end $function$;

create or replace function public.dash_product_leads(p_product text, p_from timestamp with time zone, p_to timestamp with time zone)
 returns table(total_leads bigint, leads bigint, mql bigint, spend numeric)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not public.is_admin() then return query select 0::bigint,0::bigint,0::bigint,0::numeric; return; end if;
  return query
  with action_users as (
    select distinct user_id from public.bootcamp_participation
      where p_product='bootcamp' and registered_at >= p_from and registered_at < p_to
    union
    select distinct user_id from public.cs_enrollments
      where p_product='codesprint' and enrolled_at >= p_from and enrolled_at < p_to
    union
    select distinct user_id from public.pyq_attempts
      where p_product='pyq' and created_at >= p_from and created_at < p_to
  )
  select
    (select count(*) from public.profiles where created_at >= p_from and created_at < p_to),
    (select count(*) from action_users),
    (select count(*) from action_users au join public.profiles pr on pr.id = au.user_id
        where pr.stream in ('PCM','PCMB') and pr.grad_year in (2026,2027)),
    (case when p_product='codesprint'
       then (select coalesce(sum(total_cost),0) from public.growth_cs_cost_rows where not coalesce(is_trashed,false))
       when p_product='bootcamp'
       then (select coalesce(sum(coalesce(ad_spend,0)+coalesce(influencer_spend,0)+coalesce(comms_spend,0)+coalesce(telegram_spend,0)+coalesce(host_spend,0)+coalesce(price_spend,0)),0) from public.growth_events_rows where not coalesce(is_trashed,false))
          + (select coalesce(sum(coalesce(ad_spend,0)+coalesce(influencer_spend,0)+coalesce(comms_spend,0)+coalesce(telegram_spend,0)+coalesce(host_spend,0)+coalesce(price_spend,0)),0) from public.growth_events_manual where not coalesce(is_trashed,false))
       else 0::numeric
     end);
end $function$;

-- 0128 · Product Users → VSAT table: add an `applied` column.
--
-- The VSAT product table lists everyone in vsat_registrations (early registrants). This adds a
-- boolean `applied` = did this early registrant go on to start a VSAT application
-- (an application_manager row with lead_id = their user_id). Shown beside the existing
-- "Early Registration" (registered) and "Paid" columns so admissions can see the funnel at a glance.
--
-- Admin-only (unchanged). CREATE OR REPLACE preserves grants; the revoke/grant below match 0052.
-- Rollback: supabase/rollback/0128_pu_vsat_applied_down.sql (restores the 0052 body, no `applied`).

create or replace function public.pu_vsat()
 returns setof jsonb
 language plpgsql
 stable
 security definer
 set search_path to ''
as $function$
begin
  if not public.is_admin() then return; end if;

  if to_regclass('public.vsat_payments') is null then
    return query
      select to_jsonb(x) from (
        select v.user_id,
               coalesce(v.full_name, p.full_name) as full_name,
               coalesce(v.email, p.email)         as email,
               coalesce(v.phone, p.phone)         as phone,
               coalesce(p.public_id, v.public_id) as public_id,
               v.campus_preference, v.year_passing_10th, v.gender,
               v.registered, v.registered_at, v.signup_at,
               v.utm_source, v.utm_campaign,
               exists (select 1 from public.application_manager am where am.lead_id = v.user_id) as applied,
               to_jsonb(p) as profile
        from public.vsat_registrations v
        left join public.vedam_one_profiles p on p.user_id = v.user_id
        order by v.registered_at desc nulls last, v.user_id
      ) x;
  else
    -- planned only when this branch runs, so a missing table never breaks the function
    return query
      select to_jsonb(x) from (
        select v.user_id,
               coalesce(v.full_name, p.full_name) as full_name,
               coalesce(v.email, p.email)         as email,
               coalesce(v.phone, p.phone)         as phone,
               coalesce(p.public_id, v.public_id) as public_id,
               v.campus_preference, v.year_passing_10th, v.gender,
               v.registered, v.registered_at, v.signup_at,
               v.utm_source, v.utm_campaign,
               exists (select 1 from public.application_manager am where am.lead_id = v.user_id) as applied,
               (pay.paid_at is not null)          as paid,
               pay.paid_at                        as paid_at,
               to_jsonb(p) as profile
        from public.vsat_registrations v
        left join public.vedam_one_profiles p on p.user_id = v.user_id
        left join lateral (
          select min(coalesce(vp.paid_at, vp.created_at)) as paid_at
          from public.vsat_payments vp
          where vp.lead_id = v.user_id
        ) pay on true
        order by v.registered_at desc nulls last, v.user_id
      ) x;
  end if;
end
$function$;

revoke all on function public.pu_vsat() from public, anon, authenticated, service_role;
grant execute on function public.pu_vsat() to authenticated;

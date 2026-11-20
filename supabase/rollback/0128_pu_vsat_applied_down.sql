-- Rollback for 0128 — restore public.pu_vsat to its 0052 definition (no `applied` column).
-- Byte-identical to the body shipped in 0052_pu_rpcs_release.sql.

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

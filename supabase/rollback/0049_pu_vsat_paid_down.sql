-- Rollback for 0049: restore pu_vsat() exactly as it was before (no paid / paid_at).
-- Signature, security mode, search_path and ACL are unchanged.

create or replace function public.pu_vsat()
 returns setof jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
BEGIN
  IF NOT public.is_admin() THEN RETURN; END IF;
  RETURN QUERY
    SELECT to_jsonb(x) FROM (
      SELECT v.user_id,
             coalesce(v.full_name, p.full_name) AS full_name,
             coalesce(v.email, p.email)         AS email,
             coalesce(v.phone, p.phone)         AS phone,
             coalesce(p.public_id, v.public_id) AS public_id,
             v.campus_preference, v.year_passing_10th, v.gender,
             v.registered, v.registered_at, v.signup_at,
             v.utm_source, v.utm_campaign,
             to_jsonb(p) AS profile
      FROM vsat_registrations v
      LEFT JOIN vedam_one_profiles p ON p.user_id = v.user_id
      ORDER BY v.registered_at DESC NULLS LAST
    ) x;
END $function$;

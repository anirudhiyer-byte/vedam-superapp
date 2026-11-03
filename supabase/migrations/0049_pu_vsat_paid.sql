-- 0049: Product Users · VSAT tab — add payment status + payment date.
-- "Paid" means ONLY a row in vsat_payments (same rule as PeerPath / exam gates:
-- vp.lead_id = the user's auth id). Never payment_stage_*.
-- Signature, security mode, search_path and ACL are unchanged (CREATE OR REPLACE
-- keeps the existing grants); only the selected columns change.

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
             (pay.paid_at IS NOT NULL)          AS paid,
             pay.paid_at                        AS paid_at,
             to_jsonb(p) AS profile
      FROM vsat_registrations v
      LEFT JOIN vedam_one_profiles p ON p.user_id = v.user_id
      LEFT JOIN LATERAL (
        SELECT min(coalesce(vp.paid_at, vp.created_at)) AS paid_at
        FROM vsat_payments vp
        WHERE vp.lead_id = v.user_id
      ) pay ON true
      ORDER BY v.registered_at DESC NULLS LAST
    ) x;
END $function$;

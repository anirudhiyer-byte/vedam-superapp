-- Migration 0006 — free up stale emails + resync profiles.email after an email change
--
-- Two problems, same root cause (the complete-profile form changed the verified
-- email in Auth but left profiles.email behind — fixed in the frontend too):
--
--  1. signup_conflict() blocked an email found in auth.users.raw_user_meta_data
--     ('email' key = the ORIGINAL signup email) even for accounts that have since
--     verified a DIFFERENT email. So an abandoned old address stayed locked forever
--     and could never be reused by anyone. We now gate that branch on the account
--     having NO verified auth email (coalesce(email,'')=''), which is the only case
--     the metadata-email check was meant for (phone-first, email never verified).
--
--  2. profiles.email drifted from the confirmed auth.users.email on accounts that
--     changed their email. The confirmed Auth email is the source of truth, so we
--     resync profiles.email to it wherever they differ. Non-destructive; does NOT
--     touch phone-first users who have an email in profiles but none in Auth.

CREATE OR REPLACE FUNCTION public.signup_conflict(p_phone text, p_email text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v uuid;
begin
  if coalesce(p_phone,'') <> '' then
    select id into v from auth.users
      where phone in (p_phone, replace(p_phone,'+',''), '+'||replace(p_phone,'+','')) limit 1;
    if v is not null then return 'phone'; end if;
  end if;
  if coalesce(p_email,'') <> '' then
    select id into v from public.profiles where lower(email)=lower(p_email) limit 1;
    if v is not null then return 'email'; end if;
    select id into v from auth.users where lower(coalesce(email,''))=lower(p_email) limit 1;
    if v is not null then return 'email'; end if;
    -- email present only in signup metadata of an account that never verified an
    -- email (phone-first). Gated on empty auth email so a changed account's OLD
    -- metadata email no longer blocks reuse.
    select id into v from auth.users
      where lower(coalesce(raw_user_meta_data->>'email',''))=lower(p_email)
        and coalesce(email,'')='' limit 1;
    if v is not null then return 'email'; end if;
  end if;
  return null;
end $function$;

-- One-time reconciliation (idempotent: re-running changes nothing once in sync).
update public.profiles p
set email = u.email, updated_at = now()
from auth.users u
where p.id = u.id
  and u.email is not null and u.email <> ''
  and lower(u.email) <> lower(coalesce(p.email,''));

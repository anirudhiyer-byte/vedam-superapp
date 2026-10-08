-- Migration 0002 — Signup email + verification capture (server-side, durable)
--
-- THE CONTRACT this migration enforces (do not let it regress):
--   1. The moment an auth account is created (phone OTP requested OR email
--      signup), profiles must hold: full_name, phone, email — whatever was
--      supplied — plus the two status flags mobile_verified / email_verified
--      (false = pending, true = done).
--   2. mobile_verified flips to true the instant auth.users.phone_confirmed_at
--      is set (the user entered their phone OTP).
--   3. email_verified flips to true the instant auth.users.email is confirmed
--      (the user completed email verification, now or later).
--   None of this may depend on a browser-side write.
--
-- WHY: email/verification capture used to ride ENTIRELY on a client-side
-- profiles.update() fired right after OTP verify (register-form, vsat-apply-
-- form). That write never runs if the user drops off at the OTP screen, and
-- silently no-ops if it races the fresh session (RLS matches 0 rows, the code
-- never checks the error). Result on 2026-10-08: 61 phone-first profiles with
-- a blank email, 22 real users with mobile_verified lost — all gated out of
-- their profile (and every product, bootcamp included).
--
-- FIX: move capture into the database. handle_new_user captures email at row
-- creation; a new AFTER UPDATE trigger on auth.users keeps mobile_verified /
-- email_verified / email in sync with the auth source of truth. The client
-- writes stay as a harmless fast-path but are no longer load-bearing.

-- 1) handle_new_user — capture the typed email (from metadata on phone-first,
--    where the auth email column is still null) and seed the status flags.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_grad int;
  v_consent boolean;
  v_err text;
  v_state text;
begin
  v_grad := case when (m->>'grad_year') ~ '^\d+$' then (m->>'grad_year')::int else null end;
  v_consent := case when (m->>'consent_given') in ('true','false') then (m->>'consent_given')::boolean else false end;

  begin
    insert into public.profiles (
      id, email, phone, full_name, grad_year, stream, stream_other,
      utm_source, utm_medium, utm_campaign, referrer, landing_path,
      consent_given, consent_at, mobile_verified, email_verified
    )
    values (
      new.id,
      coalesce(new.email, nullif(m->>'email','')),   -- typed email from metadata when the auth column is null (phone-first)
      new.phone, nullif(m->>'full_name',''),
      v_grad, nullif(m->>'stream',''), nullif(m->>'stream_other',''),
      nullif(m->>'utm_source',''), nullif(m->>'utm_medium',''), nullif(m->>'utm_campaign',''),
      nullif(m->>'referrer',''), nullif(m->>'landing_path',''),
      v_consent, case when v_consent then now() else null end,
      (new.phone_confirmed_at is not null),                               -- mobile: done if phone already confirmed
      (new.email is not null and new.email_confirmed_at is not null)      -- email: done if auth email already confirmed (email-first/OAuth)
    )
    on conflict (id) do nothing;
  exception when others then
    get stacked diagnostics v_err = message_text, v_state = returned_sqlstate;
    raise warning 'handle_new_user: profile insert FAILED for % (%): %', new.id, v_state, v_err;
    begin
      insert into public.signup_failures(user_id, email, err_state, err_text)
      values (new.id, coalesce(new.email, nullif(m->>'email','')), v_state, v_err);
    exception when others then
      null; -- logging must never break auth
    end;
  end;

  return new;
end;
$function$;

-- 2) handle_auth_user_update — reflect auth verification state into profiles,
--    server-side, so status can never be lost to a failed client write.
create or replace function public.handle_auth_user_update()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  begin
    -- mobile verified once the phone is confirmed
    if new.phone_confirmed_at is not null then
      update public.profiles
        set mobile_verified = true
        where id = new.id and coalesce(mobile_verified, false) = false;
    end if;

    -- email verified once the auth email column is confirmed (email-first, or
    -- a phone-first user completing email_change now or later). Keep the
    -- profiles email in lockstep with the confirmed auth email.
    if new.email is not null
       and new.email_confirmed_at is not null
       and new.email is distinct from old.email then
      update public.profiles
        set email = new.email,
            email_verified = true
        where id = new.id;
    end if;
  exception when others then
    raise warning 'handle_auth_user_update: sync failed for %: %', new.id, sqlerrm;  -- auth must never break
  end;
  return new;
end;
$function$;

drop trigger if exists trg_on_auth_user_updated on auth.users;
create trigger trg_on_auth_user_updated
  after update on auth.users
  for each row execute function public.handle_auth_user_update();

-- 3) Backfill existing rows to the contract (all idempotent).
-- 3a) the 61 blank-email profiles, from the signup metadata.
update public.profiles p
set email = nullif(u.raw_user_meta_data->>'email','')
from auth.users u
where p.id = u.id
  and coalesce(p.email,'') = ''
  and nullif(u.raw_user_meta_data->>'email','') is not null;

-- 3b) mobile_verified for anyone whose phone is already confirmed.
update public.profiles p
set mobile_verified = true
from auth.users u
where p.id = u.id
  and u.phone_confirmed_at is not null
  and coalesce(p.mobile_verified, false) = false;

-- 3c) email_verified (+ email) for anyone whose auth email is already confirmed.
update public.profiles p
set email_verified = true,
    email = coalesce(nullif(p.email,''), u.email)
from auth.users u
where p.id = u.id
  and u.email is not null
  and u.email_confirmed_at is not null
  and coalesce(p.email_verified, false) = false;

-- 4) Preflight now tests the PHONE-FIRST path (the one that broke) and fails
--    loudly if a signup ever lands without its email again. Same signature, so
--    fn_signup_healthcheck is unaffected. The raise/catch rolls the test row
--    back (plpgsql wraps each BEGIN/EXCEPTION block in an implicit savepoint).
create or replace function public.preflight_signup_test()
returns table(ok boolean, detail text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid := gen_random_uuid();
  v_mail text := 'preflight_'||replace(v_id::text,'-','')||'@vedam-preflight.invalid';
  v_profile boolean := false;
  v_email_ok boolean := false;
  v_lead boolean := false;
  v_err text;
begin
  begin
    -- phone-first signup: email lives ONLY in metadata, no auth email column
    insert into auth.users(id, phone, raw_user_meta_data, aud, role)
    values (v_id,
      '+99900'||lpad((floor(random()*100000))::int::text, 5, '0'),
      jsonb_build_object('full_name','PREFLIGHT','email',v_mail,'grad_year','2027','stream','PCM','consent_given','true'),
      'authenticated','authenticated');
    select exists(select 1 from public.profiles where id=v_id)                        into v_profile;
    select exists(select 1 from public.profiles where id=v_id and coalesce(email,'')<>'') into v_email_ok;
    select exists(select 1 from public.leads    where lead_id=v_id)                   into v_lead;
    raise exception 'PREFLIGHT_ROLLBACK';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err = 'PREFLIGHT_ROLLBACK' then
      ok := (v_profile and v_email_ok and v_lead);
      detail := case
        when not v_profile  then 'BROKEN - no profile row created; check public.signup_failures'
        when not v_email_ok then 'BROKEN - profile created but EMAIL NOT CAPTURED (the Oct-8 regression)'
        when not v_lead     then 'DEGRADED - profile+email ok but leads sync did not fire'
        else 'HEALTHY - phone-first signup captures profile + email + leads'
      end;
    else
      ok := false;
      detail := 'ERROR during test: '||v_err;
    end if;
    return next;
  end;
end;
$function$;

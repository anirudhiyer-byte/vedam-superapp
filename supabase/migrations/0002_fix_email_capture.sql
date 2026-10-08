-- Migration 0002 — Fix email capture on signup
--
-- Bug: handle_new_user writes `new.email` (the auth.users email COLUMN), which
-- is ALWAYS NULL for phone-first signups. So the trigger never captured the
-- email at all — it created every phone-first profile with a blank email and
-- just the name (from metadata).
--
-- Email was only getting into profiles via a CLIENT-SIDE write in the register
-- form (profiles.update({email,...}), fired right after the phone OTP verify).
-- That write is fragile: it never runs if the user abandons at the OTP screen,
-- and it silently no-ops if it races the fresh session (RLS matches 0 rows and
-- the code doesn't check the error). Result: 61 phone-first profiles with a
-- blank email (38 never confirmed phone; 23 real users whose client write
-- failed — mobile_verified was false for 22 of them). Those 23 then hit a
-- dead-end: blank email + a read-only email field, so they could never
-- complete their profile and were gated out of every product (bootcamp too).
--
-- Fix: capture the email in the TRIGGER (server-side, at row-creation time) so
-- it no longer depends on the client write, phone verification, or RLS timing.
-- Then backfill the 61 existing blanks from the auth metadata.
--
-- NOTE (follow-up, not in this migration): the client-side profiles.update in
-- register-form.tsx line ~122 and completePart2 don't check their error — they
-- can fail silently (mobile_verified was lost for 22 users the same way). Email
-- no longer depends on them, but they should be hardened to check + retry.

-- 1) Trigger: capture the typed email even before verification.
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
      consent_given, consent_at
    )
    values (
      new.id,
      coalesce(new.email, nullif(m->>'email','')),   -- <- the fix: typed email from metadata when the auth column is null
      new.phone, nullif(m->>'full_name',''),
      v_grad, nullif(m->>'stream',''), nullif(m->>'stream_other',''),
      nullif(m->>'utm_source',''), nullif(m->>'utm_medium',''), nullif(m->>'utm_campaign',''),
      nullif(m->>'referrer',''), nullif(m->>'landing_path',''),
      v_consent, case when v_consent then now() else null end
    )
    on conflict (id) do nothing;
  exception when others then
    get stacked diagnostics v_err = message_text, v_state = returned_sqlstate;
    raise warning 'handle_new_user: profile insert FAILED for % (%): %', new.id, v_state, v_err;
    begin
      insert into public.signup_failures(user_id, email, err_state, err_text)
      values (new.id, coalesce(new.email, nullif(m->>'email','')), v_state, v_err);
    exception when others then
      null;
    end;
  end;

  return new;
end;
$function$;

-- 2) Backfill the existing blank-email profiles from the auth metadata.
--    Idempotent: only touches rows that are still blank.
update public.profiles p
set email = nullif(u.raw_user_meta_data->>'email','')
from auth.users u
where p.id = u.id
  and coalesce(p.email,'') = ''
  and nullif(u.raw_user_meta_data->>'email','') is not null;

-- Migration 0002 — Fix email capture on signup
--
-- Bug: handle_new_user copied `new.email` (the auth.users email COLUMN), which
-- is NULL for phone-first signups. The email the user typed in the form lives
-- in raw_user_meta_data->>'email' until email verification completes. Result:
-- ~61 profiles landed with a blank email, leaving them unable to complete their
-- profile (no address to send the verification code to).
--
-- Fix: fall back to the metadata email, and backfill the existing blanks.

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

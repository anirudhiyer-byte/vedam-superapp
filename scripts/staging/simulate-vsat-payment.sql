-- STAGING ONLY · simulate a VSAT fee payment for ONE account, to test PeerPath mode "paid".
--
-- How: open the STAGING Supabase SQL editor (project kyhakenhbgcissmaacws), put the
-- account's email on the marked line, run. To undo, run the UNDO block at the bottom.
--
-- Safety:
--  * refuses to run unless app_flags has environment = 'staging' (a marker that exists
--    only on the staging database; it is in no migration, so production never has it)
--  * writes provider = 'simulated' — the payment webhook never writes that value
--  * vsat_payments is write-once; only 'simulated' rows can be removed, and only with
--    the switch below turned on for this transaction
--  * it never touches application_manager.payment_stage_* (those no longer mean "paid")

begin;
do $$
declare
  v_email text := 'REPLACE_WITH_TEST_ACCOUNT_EMAIL';   -- ← the account to mark as paid
  v_uid   uuid;
begin
  if coalesce((select value from public.app_flags where key = 'environment'), '') <> 'staging' then
    raise exception 'Refusing to run: this is not the staging database (app_flags.environment <> staging).';
  end if;
  select id into v_uid from auth.users where lower(email) = lower(btrim(v_email));
  if v_uid is null then
    raise exception 'No account with email %', v_email;
  end if;
  if exists (select 1 from public.vsat_payments where lead_id = v_uid) then
    raise notice 'Account % is already marked as paid — nothing to do.', v_email;
    return;
  end if;
  perform set_config('vedam.allow_simulated_payments', 'on', true);
  insert into public.vsat_payments (lead_id, paid_at, payment_ref, provider, amount, currency)
  values (v_uid, now(), 'SIMULATED-' || v_uid::text, 'simulated', 0, 'INR');
  raise notice 'Simulated payment added for % (%).', v_email, v_uid;
end $$;
commit;

-- ── UNDO (staging only): remove the simulated payment for that account ───────────
-- begin;
-- do $$
-- declare v_email text := 'REPLACE_WITH_TEST_ACCOUNT_EMAIL'; v_uid uuid;
-- begin
--   if coalesce((select value from public.app_flags where key = 'environment'), '') <> 'staging' then
--     raise exception 'Refusing to run: not the staging database.';
--   end if;
--   select id into v_uid from auth.users where lower(email) = lower(btrim(v_email));
--   perform set_config('vedam.allow_simulated_payments', 'on', true);
--   delete from public.vsat_payments where lead_id = v_uid and provider = 'simulated';
-- end $$;
-- commit;

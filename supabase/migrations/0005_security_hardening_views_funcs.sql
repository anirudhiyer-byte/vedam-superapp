-- Migration 0005 — Security hardening: definer views, trigger-fn grants, search_path
--
-- Addresses (see Security & Scale Assessment):
--   C1  9 SECURITY DEFINER views granted to anon/authenticated → readable by
--       anyone with the public anon key, bypassing RLS (live lead/PII leak).
--   H3  trigger-only SECURITY DEFINER functions needlessly EXECUTE-able as RPC.
--   M5  functions without a pinned search_path.
--
-- Written data-driven + idempotent so it applies cleanly on prod and on the
-- (schema-drifted) staging clone alike: it only touches objects that exist.
-- Blast radius verified: every underlying table of the views the admin UI reads
-- already has an is_admin() SELECT policy, so security_invoker keeps admin
-- access and denies anon/non-admin; v_leads/v_application_master are unused by
-- the app. Revoking EXECUTE on a trigger function never stops the trigger.

-- ── C1: make the definer views respect the CALLER's RLS ──────────────────────
do $$
declare v text;
begin
  foreach v in array array[
    'v_leads','v_application_master','bootcamp_audience','bootcamp_event_summary',
    'campaign_report','campaign_monthly','email_deliverability',
    'codesprint_dropoffs','codesprint_module_overview'
  ] loop
    if to_regclass('public.'||v) is not null then
      execute format('alter view public.%I set (security_invoker = on)', v);
    end if;
  end loop;
end $$;

-- ── C1b: leads had staff_* policies = USING(true) for authenticated, so ANY
-- logged-in user could read/insert/UPDATE every lead. Restrict to admins.
-- (leads is written only by SECURITY DEFINER triggers + service-role, and read
-- via v_leads/service-role — no normal-user path, verified.) ALTER, not DROP.
do $$
begin
  if exists (select 1 from pg_policy where polname='staff_select_leads' and polrelid='public.leads'::regclass) then
    execute 'alter policy staff_select_leads on public.leads using (public.is_admin())';
  end if;
  if exists (select 1 from pg_policy where polname='staff_update_leads' and polrelid='public.leads'::regclass) then
    execute 'alter policy staff_update_leads on public.leads using (public.is_admin()) with check (public.is_admin())';
  end if;
  if exists (select 1 from pg_policy where polname='staff_insert_leads' and polrelid='public.leads'::regclass) then
    execute 'alter policy staff_insert_leads on public.leads with check (public.is_admin())';
  end if;
end $$;

-- ── H3: revoke RPC EXECUTE from anon/authenticated on trigger-only functions ──
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.pronargs = 0 and p.proname = any(array[
      'applications_before_insert','audit_trigger','fn_archive_profile',
      'fn_sync_lead_from_profile','fn_sync_lead_from_vsat','handle_auth_user_update',
      'handle_new_user','master_delete','master_insert','master_update',
      'set_updated_at','tg_touch_updated_at','touch_updated','trg_bp_cert','trg_bp_reg',
      'trg_clear_bootcamp_dropoff','trg_csp_cert','trg_csp_progress','trg_csp_quiz',
      'trg_profile_completed','trg_vo_cert','trg_vo_lesson','trg_vo_points',
      'trg_vo_predict','trg_vo_profile_ins','trg_vo_quiz','trg_vo_reg'])
  loop
    execute format('revoke execute on function %s from anon, authenticated', r.sig);
  end loop;
end $$;

-- ── M5: pin search_path on the flagged functions (any signature) ─────────────
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = any(array[
      'touch_updated','set_updated_at','tg_touch_updated_at','trg_profile_completed',
      'applications_before_insert','compute_profile_completed','automation_where',
      'fn_save_academics','fn_save_profile','fn_save_documents'])
  loop
    execute format('alter function %s set search_path = %L', r.sig, '');
  end loop;
end $$;

-- 0141 · VSAT admin — purge a lead/application and its full VSAT footprint, + internal-email helper.
--
-- Two needs from the owner:
--  (1) Let an admin delete a dummy / test person straight from the VSAT Leads and VSAT
--      Applications panels, erasing their entire VSAT footprint "as if they never existed",
--      without hand-running SQL in Supabase each time.
--  (2) A reusable predicate for internal Vedam test emails (@vedam.org / @vedamcoms.org) so
--      every VSAT dashboard (Insights, Product Users, Growth) can exclude them (applied in 0142).
--
-- Deletion is fully app-level: NO foreign keys reference lead_manager / application_manager, so
-- nothing cascades — the purge clears every VSAT child table EXPLICITLY (the whitelist arrays below
-- are the full, auditable scope). It covers the VSAT domain only — lead, application, the exam /
-- interview / counselling children, payments, CRM logs and early registration — and deliberately
-- does NOT touch the shared Vedam One identity (vedam_one_profiles, product_usage, events, other
-- products); that stays, and the dashboard exclusion (0142) handles any residual internal presence.
--
-- Admin-only (public.is_admin()); every purge writes one row to vsat_admin_deletions with per-table
-- counts. vsat_payments is normally webhook-write-once, but an admin erasing a test person must be
-- able to remove their (dummy) payment too — that deletion is captured in the audit counts.
-- Rollback: supabase/rollback/0141_vsat_admin_purge_down.sql.

-- ── internal-email predicate ────────────────────────────────────────────────
create or replace function public.app__is_internal_email(p_email text)
 returns boolean
 language sql
 immutable
 set search_path to ''
as $function$
  select p_email is not null
     and (lower(p_email) like '%@vedam.org' or lower(p_email) like '%@vedamcoms.org');
$function$;
revoke all on function public.app__is_internal_email(text) from public, anon;
grant execute on function public.app__is_internal_email(text) to authenticated;

-- ── audit table (reached only through the SECURITY DEFINER functions) ────────
create table if not exists public.vsat_admin_deletions (
  id             uuid primary key default gen_random_uuid(),
  deleted_at     timestamptz not null default now(),
  deleted_by     uuid        default auth.uid(),
  lead_id        uuid,
  application_id text,
  subject_email  text,
  subject_name   text,
  counts         jsonb       not null default '{}'::jsonb
);
alter table public.vsat_admin_deletions enable row level security;
revoke all on table public.vsat_admin_deletions from public, anon, authenticated;
-- no RLS policies on purpose: the table is never touched directly by a browser.

-- ── internal purge, given a lead_id (erases the whole person's VSAT footprint) ──
create or replace function public.vsat__purge_person(p_lead_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  -- NOTE on keys: application_manager.application_id is a TEXT code (e.g. 'VDM-UTNOOOV2');
  -- most VSAT children key off that code. lead_id is the uuid (= profiles.id). The four
  -- bigint-keyed legacy tables (application_documents / _campus_visits / _stage_events /
  -- _vsat_slots) are empty and unused, so they are intentionally not in scope.

  -- children keyed by the TEXT application code
  appcode_tables text[] := array[
    'counselling_assignments','enrollment_fees','interview_assignments','vsat_overrides',
    'vsat_pipeline','vsat_proctoring','vsat_proctoring_log','vsat_stage_history',
    'vsat_interview_events','vsat_profile_runs'
  ];
  -- rows keyed by lead_id (uuid). 'leads' is the current CRM lead superset; the two
  -- legacy mirrors are a no-op when the id is absent.
  lead_tables text[] := array[
    'crm_activity_log','crm_comms_log','vsat_comm_sends','vsat_payment_orders',
    'vsat_payments','applications','applications_old','leads'
  ];
  v_app    text;
  v_email  text;
  v_name   text;
  v_counts jsonb := '{}'::jsonb;
  t        text;
  n        integer;
begin
  if p_lead_id is null then
    raise exception 'LEAD_ID_REQUIRED';
  end if;

  -- audited admin bypass for the vsat_payments write-once guard: this local flag lets the
  -- guard accept a DELETE from inside this purge only (it also re-checks is_admin()). It lives
  -- for this transaction only and is never set anywhere else.
  perform set_config('vedam.admin_purge', 'on', true);

  select a.application_id,
         coalesce(a.registered_email, l.registered_email),
         coalesce(a.registered_name,  l.registered_name)
    into v_app, v_email, v_name
    from public.lead_manager l
    left join public.application_manager a on a.lead_id = l.lead_id
   where l.lead_id = p_lead_id;

  if v_app is null then
    -- lead row may already be gone; still resolve an application by lead_id if one exists
    select application_id, registered_email, registered_name
      into v_app, v_email, v_name
      from public.application_manager where lead_id = p_lead_id;
  end if;

  -- 1) children keyed by the TEXT application code (skip tables absent in this environment,
  --    e.g. vsat_interview_events exists on staging ahead of prod — keeps the purge portable)
  if v_app is not null then
    foreach t in array appcode_tables loop
      if to_regclass('public.' || t) is not null then
        execute format('delete from public.%I where application_id = $1', t) using v_app;
        get diagnostics n = row_count;
        v_counts := v_counts || jsonb_build_object(t, n);
      end if;
    end loop;
  end if;

  -- 2) rows keyed by lead_id (uuid)
  foreach t in array lead_tables loop
    if to_regclass('public.' || t) is not null then
      execute format('delete from public.%I where lead_id = $1', t) using p_lead_id;
      get diagnostics n = row_count;
      v_counts := v_counts || jsonb_build_object(t, n);
    end if;
  end loop;

  -- 3) exam results carry BOTH keys (text code + uuid lead)
  delete from public.vsat_exam_results
   where (v_app is not null and application_id = v_app) or lead_id = p_lead_id;
  get diagnostics n = row_count;
  v_counts := v_counts || jsonb_build_object('vsat_exam_results', n);

  -- 4) early registration (vsat_registrations keys by the auth user = lead_id/profiles.id;
  --    also match on email as a fallback)
  delete from public.vsat_registrations
   where user_id = p_lead_id or (v_email is not null and lower(email) = lower(v_email));
  get diagnostics n = row_count;
  v_counts := v_counts || jsonb_build_object('vsat_registrations', n);

  -- 5) parents last (application_manager keyed by the TEXT code)
  if v_app is not null then
    delete from public.application_manager where application_id = v_app;
    get diagnostics n = row_count;
    v_counts := v_counts || jsonb_build_object('application_manager', n);
  end if;
  delete from public.lead_manager where lead_id = p_lead_id;
  get diagnostics n = row_count;
  v_counts := v_counts || jsonb_build_object('lead_manager', n);

  insert into public.vsat_admin_deletions
    (deleted_by, lead_id, application_id, subject_email, subject_name, counts)
  values (auth.uid(), p_lead_id, v_app, v_email, v_name, v_counts);

  return jsonb_build_object(
    'ok', true, 'lead_id', p_lead_id, 'application_id', v_app,
    'email', v_email, 'name', v_name, 'deleted', v_counts
  );
end;
$function$;
revoke all on function public.vsat__purge_person(uuid) from public, anon, authenticated;

-- ── public admin entry points (one per panel) ───────────────────────────────
create or replace function public.vsat_admin_delete_lead(p_lead_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  if not coalesce(public.is_admin(), false) then
    raise exception 'NOT_AUTHORISED';
  end if;
  if p_lead_id is null then
    raise exception 'LEAD_ID_REQUIRED';
  end if;
  return public.vsat__purge_person(p_lead_id);
end;
$function$;
revoke all on function public.vsat_admin_delete_lead(uuid) from public, anon;
grant execute on function public.vsat_admin_delete_lead(uuid) to authenticated;

create or replace function public.vsat_admin_delete_application(p_application_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_lead uuid;
begin
  if not coalesce(public.is_admin(), false) then
    raise exception 'NOT_AUTHORISED';
  end if;
  if p_application_id is null then
    raise exception 'APPLICATION_ID_REQUIRED';
  end if;
  select lead_id into v_lead from public.application_manager where application_id = p_application_id;
  if v_lead is null then
    raise exception 'APPLICATION_NOT_FOUND';
  end if;
  return public.vsat__purge_person(v_lead);
end;
$function$;
revoke all on function public.vsat_admin_delete_application(uuid) from public, anon;
grant execute on function public.vsat_admin_delete_application(uuid) to authenticated;

-- ── extend the payment write-once guard with an audited admin-purge exception ──
-- Identical to the prior guard, plus one DELETE branch: a payment may be deleted when the
-- current transaction set vedam.admin_purge='on' (only vsat__purge_person does that) AND the
-- caller is an admin. Simulated-payment and all other write-once behaviour is unchanged.
create or replace function public.vsat_payments_guard()
 returns trigger
 language plpgsql
 set search_path to ''
as $function$
declare
  v_sim boolean := coalesce(current_setting('vedam.allow_simulated_payments', true), '') = 'on'
                   and coalesce((select f.value from public.app_flags f where f.key = 'environment'), '') = 'staging';
begin
  if tg_op = 'INSERT' then
    if new.provider = 'simulated' and not v_sim then
      raise exception 'simulated payments are not allowed here' using errcode = '42501';
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    if old.provider = 'simulated' and v_sim then
      return old;
    end if;
    -- audited admin purge: vsat__purge_person sets this local flag; admin re-checked here
    if coalesce(current_setting('vedam.admin_purge', true), '') = 'on'
       and coalesce(public.is_admin(), false) then
      return old;
    end if;
  end if;
  raise exception 'vsat_payments is write-once (% blocked)', tg_op using errcode = '42501';
end $function$;

-- Migration 0007 — scale pass: RLS initplan + FK indexes + duplicate indexes
--
-- Written drift-proof (guards skip objects a given environment doesn't have),
-- because staging and prod schemas have diverged. Idempotent.
--
-- Scope deliberately EXCLUDES dropping the 47 "unused" indexes: most sit on the
-- new CRM tables still being built (lead_manager, application_manager, comms_*,
-- crm_activity_log, growth_*). They read as unused only because those features
-- aren't live yet; the indexes were pre-created on purpose.

-- ── Part A — RLS initplan: wrap auth.uid()/is_admin() in (select ...) so they
--    evaluate ONCE per query, not once per row. Boolean logic is unchanged. ──
do $$
declare r record;
begin
  for r in (values
    ('activity_log','activity_insert',       null, 'user_id = (select auth.uid())'),
    ('activity_log','activity_select',       '(user_id = (select auth.uid())) or (select is_admin())', null),
    ('bootcamp_dropoffs','bd_self',          null, '(select auth.uid()) = user_id'),
    ('certificates','cert_select',           '(user_id = (select auth.uid())) or (select is_admin())', null),
    ('cp_predictions','cp_pred_own',         '(user_id = (select auth.uid())) or (select is_admin())', null),
    ('cs_enrollments','cs_enroll_ins',       null, 'user_id = (select auth.uid())'),
    ('cs_enrollments','cs_enroll_own',       '(user_id = (select auth.uid())) or (select is_admin())', null),
    ('cs_progress','cs_progress_ins',        null, 'user_id = (select auth.uid())'),
    ('cs_progress','cs_progress_own',        '(user_id = (select auth.uid())) or (select is_admin())', null),
    ('cs_quiz_attempts','cs_attempt_own',    '(user_id = (select auth.uid())) or (select is_admin())', null),
    ('email_events','ee_self',               '(select auth.uid()) = user_id', null),
    ('event_registrations','reg_insert_own', null, 'user_id = (select auth.uid())'),
    ('event_registrations','reg_select_own', '(user_id = (select auth.uid())) or (select is_admin())', null),
    ('event_registrations','reg_update_own', '(user_id = (select auth.uid())) or (select is_admin())', '(user_id = (select auth.uid())) or (select is_admin())'),
    ('points_ledger','points_select_own',    '(user_id = (select auth.uid())) or (select is_admin())', null),
    ('product_usage','product_usage_own',    '(user_id = (select auth.uid())) or (select is_admin())', null),
    ('profiles','profiles_insert_own',       null, 'id = (select auth.uid())'),
    ('profiles','profiles_select_own',       '(id = (select auth.uid())) or (select is_admin())', null),
    ('profiles','profiles_update_own',       '(id = (select auth.uid())) or (select is_admin())', '(id = (select auth.uid())) or (select is_admin())'),
    ('user_roles','user_roles_select',       '(user_id = (select auth.uid())) or (select is_admin())', null),
    ('utm_touches','utm_touches_own',        '(user_id = (select auth.uid())) or (select is_admin())', null),
    ('vsat_registrations','vsat_self',       '(select auth.uid()) = user_id', null)
  ) as t(tbl, pol, u, c)
  loop
    if exists (select 1 from pg_policies where schemaname='public' and tablename=r.tbl and policyname=r.pol) then
      if r.u is not null and r.c is not null then
        execute format('alter policy %I on public.%I using (%s) with check (%s)', r.pol, r.tbl, r.u, r.c);
      elsif r.u is not null then
        execute format('alter policy %I on public.%I using (%s)', r.pol, r.tbl, r.u);
      else
        execute format('alter policy %I on public.%I with check (%s)', r.pol, r.tbl, r.c);
      end if;
    end if;
  end loop;
end $$;

-- ── Part B — add the 16 missing foreign-key covering indexes (pure additions).
--    traffic_events is held out: high-write, so it gets CREATE INDEX CONCURRENTLY
--    outside any transaction (see runbook), not here. ──
do $$
declare r record;
begin
  for r in (values
    ('application_manager','lead_id','idx_application_manager_lead_id'),
    ('comms_campaigns','created_by','idx_comms_campaigns_created_by'),
    ('comms_journeys','created_by','idx_comms_journeys_created_by'),
    ('comms_optouts','user_id','idx_comms_optouts_user_id'),
    ('cp_events','user_id','idx_cp_events_user_id'),
    ('cs_quiz_attempts','module_id','idx_cs_quiz_attempts_module_id'),
    ('email_sends','sent_by','idx_email_sends_sent_by'),
    ('events','created_by','idx_events_created_by'),
    ('growth_cs_banner_utms','created_by','idx_growth_cs_banner_utms_created_by'),
    ('growth_cs_cost_rows','created_by','idx_growth_cs_cost_rows_created_by'),
    ('meet_link_pool','assigned_interview_id','idx_meet_link_pool_assigned_interview_id'),
    ('user_roles','created_by','idx_user_roles_created_by'),
    ('whatsapp_automations','created_by','idx_whatsapp_automations_created_by'),
    ('whatsapp_automations','event_id','idx_whatsapp_automations_event_id'),
    ('whatsapp_sends','sent_by','idx_whatsapp_sends_sent_by')
  ) as t(tbl, col, idx)
  loop
    if to_regclass('public.'||r.tbl) is not null then
      execute format('create index if not exists %I on public.%I (%I)', r.idx, r.tbl, r.col);
    end if;
  end loop;
end $$;

-- ── Part C — drop the 3 duplicate indexes (keep PK / better-named twin). ──
drop index if exists public.idx_csp_user;          -- dup of idx_cs_progress_user
drop index if exists public.idx_institutes_id;     -- dup of institutes_pkey
drop index if exists public.idx_pl_user_created;   -- dup of idx_points_user_time

-- ── Separate, run by hand on prod (cannot run in a txn; high-write table) ──
--   create index concurrently if not exists idx_traffic_events_user_id
--     on public.traffic_events (user_id);

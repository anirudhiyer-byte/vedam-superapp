-- Migration 0001 — Security hardening
-- Closes three critical exposures found in the Oct 2026 security audit.
-- Applied to production as a hotfix on 2026-10-07 (live data exposure);
-- recorded here so staging and any future environment get the same change.
--
-- SAFETY: none of this affects server-side access. Service-role API routes,
-- triggers, foreign keys, and SECURITY DEFINER functions all bypass RLS and
-- keep working. These statements only remove access by the public anon /
-- authenticated roles, which no browser code uses for these objects.

-- C1 — Lock down CRM-mutating functions that were executable by anon over REST.
-- (Loop handles any argument signature so we never mismatch defaults.)
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('fn_update_lead', 'fn_update_lead_details',
                        'fn_assign_leads', 'fn_register_lead')
  loop
    -- EXECUTE defaults to PUBLIC, so revoke PUBLIC (not just anon/authenticated),
    -- then grant back only to service_role for server-side admin code.
    execute format('revoke execute on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;
end $$;

-- C2 — Enable Row Level Security on the CRM tables that had it off.
-- No policies are added: all legitimate access is via service-role routes,
-- which bypass RLS. This denies the public anon key direct read/write.
alter table public.lead_manager            enable row level security;
alter table public.application_manager     enable row level security;
alter table public.enrollment_fees         enable row level security;
alter table public.vsat_campaigns          enable row level security;
alter table public.interview_assignments   enable row level security;
alter table public.counselling_assignments enable row level security;
alter table public.vsat_coupons            enable row level security;
alter table public.form_builder            enable row level security;
alter table public.stage_definitions       enable row level security;
alter table public.crm_comms_log           enable row level security;
alter table public.meet_link_pool          enable row level security;
alter table public.crm_activity_log        enable row level security;
alter table public.vedam_one_refresh_queue enable row level security;

-- C3 — Stop anon / authenticated reading auth.users emails through these views.
do $$
begin
  if exists (select 1 from information_schema.views
             where table_schema = 'public' and table_name = 'v_signup_health') then
    execute 'revoke select on public.v_signup_health from anon, authenticated';
  end if;
  if exists (select 1 from information_schema.views
             where table_schema = 'public' and table_name = 'duplicate_email_accounts') then
    execute 'revoke select on public.duplicate_email_accounts from anon, authenticated';
  end if;
end $$;

-- Hygiene — pin search_path on the health-check functions (audit WARN).
alter function public.preflight_signup_test()        set search_path = 'public';
alter function public.fn_signup_healthcheck(boolean) set search_path = 'public';

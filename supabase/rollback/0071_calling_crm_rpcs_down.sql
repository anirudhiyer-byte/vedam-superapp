-- Rollback 0071 · remove the Calling CRM Stage-2 RPCs.
-- Leaves the 0070 foundation (table, link/payment plumbing) intact.

drop function if exists public.calling_callers();
drop function if exists public.calling_set_vsat_paid(jsonb);
drop function if exists public.calling_import(jsonb);
drop function if exists public.calling_bulk_update(jsonb);
drop function if exists public.calling_assign(jsonb);
drop function if exists public.calling_admin_list(jsonb);
drop function if exists public.calling_dashboard(jsonb);
drop function if exists public.calling_log_update(jsonb);
drop function if exists public.calling_my_queue(jsonb);
drop function if exists public.calling_caller_json(public.calling_leads);

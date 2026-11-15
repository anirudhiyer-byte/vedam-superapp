-- Rollback 0073 · remove the Calling caller-management RPCs.
drop function if exists public.calling_caller_roster();
drop function if exists public.calling_remove_caller(jsonb);
drop function if exists public.calling_add_caller(jsonb);

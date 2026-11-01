-- Rollback 0038: restore the pre-migration blanket grants on the two tables.
-- Before 0038, anon + authenticated each held DELETE,INSERT,REFERENCES,SELECT,
-- TRIGGER,TRUNCATE,UPDATE (i.e. ALL) on both tables; public held nothing.
-- This re-grants that exact set so the change is fully reversible.

grant all on table public.application_manager to anon, authenticated;
grant all on table public.lead_manager      to anon, authenticated;

-- Rollback 0058 · remove the event_registrations profile-fill trigger and its function.
-- Exact inverse of the up migration.

drop trigger if exists trg_er_fill_profile on public.event_registrations;
drop function if exists public.er_fill_profile_fields();

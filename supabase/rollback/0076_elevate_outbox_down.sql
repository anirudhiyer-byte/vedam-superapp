-- Rollback 0076 · remove the Elevate outbox + enqueue triggers.
drop trigger if exists trg_elevate_application on public.application_manager;
drop function if exists public.elevate_on_application();
drop trigger if exists trg_elevate_calling_lead on public.calling_leads;
drop function if exists public.elevate_on_calling_lead();
drop function if exists public.elevate_enqueue(public.calling_leads, text, timestamptz, jsonb);
drop function if exists public.elevate_outbox_stats();
drop function if exists public.elevate_live();
drop trigger if exists trg_elevate_touch on public.elevate_outbox;
drop function if exists public.elevate_touch_updated();
drop table if exists public.elevate_outbox;
delete from public.app_flags where key = 'elevate_webhook';

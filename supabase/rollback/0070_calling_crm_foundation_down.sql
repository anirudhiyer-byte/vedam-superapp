-- Rollback 0070 · remove the Calling CRM foundation.
-- NOTE: Postgres cannot drop an enum value, so app_role 'caller' is left in place
-- (harmless; nothing references it once the functions/table below are gone).

drop trigger if exists trg_calling_apply_on_app on public.application_manager;
drop function if exists public.calling_apply_on_application();
drop trigger if exists trg_calling_link_profile on public.profiles;
drop function if exists public.calling_link_profile();
drop function if exists public.calling_apply_vsat_payment(uuid);
drop trigger if exists trg_calling_touch on public.calling_leads;
drop function if exists public.calling_touch_updated();
drop table if exists public.calling_leads;
drop function if exists public.phone10(text);
drop function if exists public.is_caller();

-- Rollback 0039 · VSAT Form builder
-- Drops the rpcs, the flatten view, the adaptive columns and the vsat_forms table.
-- Destructive: application_manager.form_data (stored answers) is removed.

drop function if exists public.vsat_form_save_category(jsonb);
drop function if exists public.vsat_form_active_for_fill();
drop function if exists public.vsat_form_get(uuid);
drop function if exists public.vsat_forms_admin_list();
drop function if exists public.vsat_form_set_status(jsonb);
drop function if exists public.vsat_form_upsert(jsonb);

drop view if exists public.vsat_application_answers;

alter table public.application_manager drop column if exists active_form_id;
alter table public.application_manager drop column if exists form_data;

drop table if exists public.vsat_forms;

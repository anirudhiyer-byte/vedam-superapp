-- Rollback for 0098_vsat_settings_team.sql
-- Removes the settings / team RPCs, their private helpers and the audit log. The settings tables
-- themselves (0079) are not touched: values saved through the screens stay as they are.

drop function if exists public.vsat_team_set(jsonb);
drop function if exists public.vsat_team_add(jsonb);
drop function if exists public.vsat_team_admin_list();
drop function if exists public.vsat_settings_vsat_set(jsonb);
drop function if exists public.vsat_settings_bands_set(jsonb);
drop function if exists public.vsat_settings_weights_delete(jsonb);
drop function if exists public.vsat_settings_weights_set(jsonb);
drop function if exists public.vsat_settings_campus_set(jsonb);
drop function if exists public.vsat_settings_get();
drop function if exists public.vsat__settings_num(jsonb, text, numeric, numeric, boolean);
drop function if exists public.vsat__settings_log(text, text, jsonb, jsonb);
drop function if exists public.vsat__settings_admin();
drop table if exists public.vsat_settings_audit;

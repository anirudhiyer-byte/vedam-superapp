-- Rollback 0061 · Communication Manager Slice 3a (Manage List on VSAT data).
-- Drops exactly what 0061 created. 0061 changed nothing that already existed
-- (the existing audit_trigger() function is only referenced by our trigger), so nothing
-- has to be restored. Saved lists in comm_lists are lost — export them first if needed.

drop function if exists public.comm_list_delete(uuid);
drop function if exists public.comm_list_update(uuid, text, jsonb);
drop function if exists public.comm_list_create(text, jsonb);
drop function if exists public.comm_lists_list(text, int, int);
drop function if exists public.comm_list_options();
drop function if exists public.comm_audience_preview(jsonb);

drop function if exists public.comm__audience(jsonb);
drop function if exists public.comm__conditions_check(jsonb);
drop function if exists public.comm__mask_email(text);
drop function if exists public.comm__mask_phone(text);
drop function if exists public.comm__phone91(text);

drop trigger if exists trg_audit_comm_lists on public.comm_lists;
drop table if exists public.comm_lists;

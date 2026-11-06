-- Rollback 0069 · Communication Manager Slice 6 (WhatsApp Flow drafts).
-- Drops exactly what 0069 created. 0069 changed nothing that already existed (audit_trigger(), comm__guard()
-- and is_admin() are only called), so nothing has to be restored. Saved flow drafts are lost.
-- Order matters: the table's CHECK uses comm__flow_screens_check, so the table goes before the helper.

drop function if exists public.comm_flow_delete(uuid);
drop function if exists public.comm_flow_duplicate(uuid);
drop function if exists public.comm_flow_create(text, text, text, text, jsonb);
drop function if exists public.comm_flow_get(uuid);
drop function if exists public.comm_flow_list();

drop trigger if exists trg_audit_comm_flows on public.comm_flows;
drop table if exists public.comm_flows;

drop function if exists public.comm__flow_screens_check(jsonb);

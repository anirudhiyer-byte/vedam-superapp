-- Rollback 0066 · Communication Manager Slice 4 (Manage Document Templates).
-- Drops exactly what 0066 created. 0066 changed nothing that already existed (audit_trigger(),
-- comm__guard() and comm__like() are only called), so nothing has to be restored.
-- Saved document templates are lost — export them first if needed.

drop function if exists public.comm_doc_template_delete(uuid);
drop function if exists public.comm_doc_template_update(uuid, text, text);
drop function if exists public.comm_doc_template_create(text, text, boolean);
drop function if exists public.comm_doc_template_get(uuid);
drop function if exists public.comm_doc_template_list(text, int, int);

drop function if exists public.comm__doc_html_check(text);

drop trigger if exists trg_audit_comm_doc_templates on public.comm_doc_templates;
drop table if exists public.comm_doc_templates;

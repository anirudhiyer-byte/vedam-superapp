-- Rollback 0067 · Communication Manager Slice 8 (Manage Automation, read-only).
-- Drops exactly what 0067 created. 0067 changed nothing that already existed (comm__guard() is only
-- called; the four automation tables are only read), so nothing has to be restored. No data is lost.

drop function if exists public.comm_automation_list();

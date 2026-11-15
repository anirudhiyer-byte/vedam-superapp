-- Rollback 0064 · Communication Manager Slice 2 (Suppressions add / remove).
-- Drops exactly what 0064 created. 0064 changed nothing that already existed (it only CALLS the existing
-- comms_opt_out / is_opted_out / comm__guard / comm__phone91 and attaches the existing audit_trigger()),
-- so nothing has to be restored.
--
-- Suppressions that were added through the admin panel STAY in comms_optouts on purpose (they are real
-- opt-outs; dropping them could start messaging people who asked to stop). After rollback they behave like
-- any other opt-out row. Only the "who added it / note" metadata is lost; audit_log keeps the history.

drop function if exists public.comm_suppression_remove(uuid, text);
drop function if exists public.comm_suppression_add(text, text, text, text);

drop trigger if exists trg_audit_comm_suppression_meta on public.comm_suppression_meta;
drop table if exists public.comm_suppression_meta;

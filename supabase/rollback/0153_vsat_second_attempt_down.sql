-- Rollback 0153 · remove the second-attempt reset, trigger and admin RPC.
drop trigger if exists trg_vsat_attempt2 on public.application_manager;
drop function if exists public.vsat_start_second_attempt(jsonb);
drop function if exists public.vsat__on_attempt2_payment();
drop function if exists public.vsat__begin_attempt2(text, text, uuid);
drop function if exists public.vsat__is_terminal_fail(text, text);
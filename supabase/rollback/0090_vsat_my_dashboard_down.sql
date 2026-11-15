-- Rollback 0090 · remove the student dashboard read RPCs + their helper indexes.
drop function if exists public.vsat_my_payments();
drop function if exists public.vsat_my_communications(integer);
drop function if exists public.vsat_my_email_body(uuid);

drop index if exists public.email_events_user_id_idx;
drop index if exists public.email_events_to_email_lower_idx;
drop index if exists public.whatsapp_sends_last10_idx;

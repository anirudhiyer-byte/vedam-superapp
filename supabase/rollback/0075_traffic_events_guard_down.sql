-- Rollback for 0075_traffic_events_guard.sql
-- Removes the insert guard on traffic_events. Rows already written stay as they are.

drop trigger if exists traffic_events_guard on public.traffic_events;
drop function if exists public.trg_traffic_events_guard();

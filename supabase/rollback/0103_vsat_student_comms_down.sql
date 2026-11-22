-- Rollback for 0103 — drop the companion RPC. No data is touched (read-only function).
drop function if exists public.vsat_student_comms(text);

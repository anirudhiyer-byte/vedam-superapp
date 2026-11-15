-- Rollback 0091 · remove the VSAT comms config + send log + admin RPCs.
drop function if exists public.vsat_comm_step_update(jsonb);
drop function if exists public.vsat_comm_steps_get();
drop table if exists public.vsat_comm_sends;
drop table if exists public.vsat_comm_settings;
drop table if exists public.vsat_comm_steps;

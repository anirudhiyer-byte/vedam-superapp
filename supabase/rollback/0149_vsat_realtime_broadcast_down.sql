-- Rollback 0149 · remove realtime broadcast triggers, functions and the receive policy.
drop trigger if exists trg_rt_vsat_pipeline on public.vsat_pipeline;
drop trigger if exists trg_rt_interview_assign on public.interview_assignments;
drop trigger if exists trg_rt_counselling_assign on public.counselling_assignments;
drop trigger if exists trg_rt_calling_assign on public.calling_leads;
drop policy if exists "vsat realtime receive" on realtime.messages;
drop function if exists public.rt__calling_assign();
drop function if exists public.rt__broadcast();

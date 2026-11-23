-- 0149 · Realtime: push "something changed" to open admin/caller screens so stage moves and
-- assignments appear without a refresh.
--
-- SECURITY MODEL (CLAUDE.md): RLS on, no table policies, browsers get zero table access — so a
-- browser CANNOT subscribe to postgres_changes (that needs SELECT on the table). Instead we use
-- Supabase Broadcast FROM the database: a trigger calls realtime.send() with a CONTENTLESS signal
-- (just a timestamp — no names, stages or PII) on a private topic. The client receives the ping and
-- re-fetches through the existing SECURITY DEFINER RPCs, which re-check role + campus. So no data
-- ever travels on the channel; the broadcast only says "reload".
--
-- Topics:  vsat_pipeline  — stage/status moves + interview/counselling assignments
--          calling_leads  — a lead's caller assignment changed
-- Rollback: supabase/rollback/0149_vsat_realtime_broadcast_down.sql

-- ── broadcaster: contentless signal on the topic given as the trigger argument ──
create or replace function public.rt__broadcast() returns trigger language plpgsql
  security definer set search_path to '' as $fn$
begin
  perform realtime.send(
    jsonb_build_object('at', extract(epoch from clock_timestamp())),  -- no row data: just "reload"
    'change', tg_argv[0], true /* private */);
  return null;
end $fn$;
revoke all on function public.rt__broadcast() from public, anon, authenticated;

-- pipeline moves + assignment tables → one ping per statement (a bulk move pings once)
drop trigger if exists trg_rt_vsat_pipeline on public.vsat_pipeline;
create trigger trg_rt_vsat_pipeline after insert or update or delete on public.vsat_pipeline
  for each statement execute function public.rt__broadcast('vsat_pipeline');

drop trigger if exists trg_rt_interview_assign on public.interview_assignments;
create trigger trg_rt_interview_assign after insert or update or delete on public.interview_assignments
  for each statement execute function public.rt__broadcast('vsat_pipeline');

drop trigger if exists trg_rt_counselling_assign on public.counselling_assignments;
create trigger trg_rt_counselling_assign after insert or update or delete on public.counselling_assignments
  for each statement execute function public.rt__broadcast('vsat_pipeline');

-- calling leads: ping only when the ASSIGNMENT changes (calls update these rows constantly otherwise)
create or replace function public.rt__calling_assign() returns trigger language plpgsql
  security definer set search_path to '' as $fn$
begin
  if tg_op = 'INSERT' or (old.assigned_to is distinct from new.assigned_to) then
    perform realtime.send(jsonb_build_object('at', extract(epoch from clock_timestamp())), 'change', 'calling_leads', true);
  end if;
  return null;
end $fn$;
revoke all on function public.rt__calling_assign() from public, anon, authenticated;

drop trigger if exists trg_rt_calling_assign on public.calling_leads;
create trigger trg_rt_calling_assign after insert or update on public.calling_leads
  for each row execute function public.rt__calling_assign();

-- ── receive authorization: any signed-in user may subscribe to these two topics ──
-- Safe because the payload is contentless; all real data stays behind the RPCs.
drop policy if exists "vsat realtime receive" on realtime.messages;
create policy "vsat realtime receive" on realtime.messages
  for select to authenticated
  using ( realtime.topic() in ('vsat_pipeline', 'calling_leads') );

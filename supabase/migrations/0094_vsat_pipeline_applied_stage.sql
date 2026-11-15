-- 0094 · VSAT pipeline — enroll every applicant from application creation ('applied' stage).
--
-- Until now a student entered vsat_pipeline only when they BOOKED an exam, so the
-- Applications panel (and all its stage actions) couldn't show applied/paid-but-unbooked
-- students. This adds an 'applied' stage at the very front (order 0) and enrolls every
-- application into the pipeline when it is created — so the Applications panel shows
-- EVERY applicant WITH the full stage management (moves, comments, overrides, bulk,
-- assignments), not just booked ones.
--
-- 'applied' maps to NULL in vsat__legacy_stage (same as 'booked'), so enrolling never
-- overwrites application_manager / lead_manager legacy stages. The move engine itself
-- (vsat__move) is unchanged. Rollback: supabase/rollback/0094_vsat_pipeline_applied_stage_down.sql

-- ── allow the new stage ──────────────────────────────────────────────────────────────────
alter table public.vsat_pipeline drop constraint if exists vsat_pipeline_stage_check;
alter table public.vsat_pipeline add constraint vsat_pipeline_stage_check
  check (stage = any (array[
    'applied','booked','eligible','exam_taken','vsat_cleared','interview_scheduled','interviewed',
    'pi_cleared','counselling_scheduled','counselled','offer_sent','seat_blocked','offer_lapsed','offer_cancelled'
  ]));

-- ── order it before 'booked' (0) ─────────────────────────────────────────────────────────
create or replace function public.vsat__stage_order(p_stage text)
returns integer language sql immutable set search_path to '' as $fn$
  select case p_stage
    when 'applied' then 0
    when 'booked' then 1 when 'eligible' then 2 when 'exam_taken' then 3 when 'vsat_cleared' then 4
    when 'interview_scheduled' then 5 when 'interviewed' then 6 when 'pi_cleared' then 7
    when 'counselling_scheduled' then 8 when 'counselled' then 9 when 'offer_sent' then 10
    when 'seat_blocked' then 11 when 'offer_lapsed' then 11 when 'offer_cancelled' then 11 end
$fn$;

-- ── enroll on application creation; advance 'applied' → 'booked' once an exam date is set ─
create or replace function public.vsat__on_application()
returns trigger language plpgsql security definer set search_path to '' as $fn$
declare st text; stt text; v_attempt int := least(greatest(coalesce(new.current_attempt, 1), 1), 2);
begin
  -- every application gets a pipeline row: 'booked' if an exam date is already set, else 'applied'
  if not exists (select 1 from public.vsat_pipeline vp where vp.application_id = new.application_id) then
    insert into public.vsat_pipeline (application_id, attempt_no, stage, status)
    values (new.application_id, v_attempt, case when new.exam_date_id is not null then 'booked' else 'applied' end, 'active')
    on conflict (application_id) do nothing;
    if found then
      insert into public.vsat_stage_history (application_id, attempt_no, to_stage, to_status, source)
      values (new.application_id, v_attempt, case when new.exam_date_id is not null then 'booked' else 'applied' end, 'active', 'system');
    end if;
  elsif new.exam_date_id is not null then
    -- an existing 'applied' student just booked an exam → move them forward
    select vp.stage, vp.status into st, stt from public.vsat_pipeline vp where vp.application_id = new.application_id;
    if st = 'applied' and stt = 'active' then
      perform public.vsat__move(new.application_id, 'booked', 'active', null, 'system', null, null);
    end if;
  end if;

  -- exam taken → exam_taken (unchanged)
  if coalesce(new.exam_given, false) and (tg_op = 'INSERT' or not coalesce(old.exam_given, false)) then
    select vp.stage, vp.status into st, stt from public.vsat_pipeline vp where vp.application_id = new.application_id;
    if st in ('booked', 'eligible') and stt = 'active' then
      perform public.vsat__move(new.application_id, 'exam_taken', 'active', null, 'system', null, null);
    end if;
  end if;
  return null;
end $fn$;

-- the trigger must also fire on plain INSERT (it already does) — recreate to be safe/explicit
drop trigger if exists trg_vsat_pipeline_sync on public.application_manager;
create trigger trg_vsat_pipeline_sync after insert or update of exam_date_id, exam_given on public.application_manager
  for each row execute function public.vsat__on_application();

-- ── backfill: applications not yet in the pipeline → 'applied' ────────────────────────────
with src as (
  select am.application_id, least(greatest(coalesce(am.current_attempt, 1), 1), 2) attempt_no
  from public.application_manager am
  where not exists (select 1 from public.vsat_pipeline vp where vp.application_id = am.application_id)
), ins as (
  insert into public.vsat_pipeline (application_id, attempt_no, stage, status)
  select application_id, attempt_no, 'applied', 'active' from src
  on conflict (application_id) do nothing
  returning application_id, attempt_no
)
insert into public.vsat_stage_history (application_id, attempt_no, to_stage, to_status, source)
select application_id, attempt_no, 'applied', 'active', 'backfill' from ins;

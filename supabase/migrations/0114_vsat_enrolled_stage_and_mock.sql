-- 0114 · VSAT pipeline (Option A) — rename seat_blocked → enrolled, auto-enroll on ₹50k,
--         and add mock-result columns.
--
-- The pipeline already modelled the final enrolled state as stage 'seat_blocked' (which
-- vsat__legacy_stage maps to legacy 'enrolled'). This renames the stage to 'enrolled' so the
-- admin UI reads true, auto-advances it when the ₹50k enrollment payment is approved, and adds
-- mock_percentile / mock_sections for the mock exam result. "VSAT not cleared" / "PI not
-- cleared" / offer states keep their existing representation (status + legacy mapping) and are
-- surfaced in the admin UI — no enum churn there.
--
-- Only vsat__stage_order + vsat__legacy_stage reference seat_blocked; on_application does not.
-- Rollback: supabase/rollback/0114_vsat_enrolled_stage_and_mock_down.sql

-- 1) allow both names transiently so the data move is legal
alter table public.vsat_pipeline drop constraint if exists vsat_pipeline_stage_check;
alter table public.vsat_pipeline add constraint vsat_pipeline_stage_check
  check (stage = any (array[
    'applied','application_fee_paid','booked','eligible','exam_taken','vsat_cleared','interview_scheduled','interviewed',
    'pi_cleared','counselling_scheduled','counselled','offer_sent','seat_blocked','enrolled','offer_lapsed','offer_cancelled'
  ]));

-- 2) stage order — 'enrolled' takes seat_blocked's terminal slot
create or replace function public.vsat__stage_order(p_stage text)
returns integer language sql immutable set search_path to '' as $function$
  select case p_stage
    when 'applied' then 0
    when 'application_fee_paid' then 1
    when 'booked' then 2 when 'eligible' then 3 when 'exam_taken' then 4 when 'vsat_cleared' then 5
    when 'interview_scheduled' then 6 when 'interviewed' then 7 when 'pi_cleared' then 8
    when 'counselling_scheduled' then 9 when 'counselled' then 10 when 'offer_sent' then 11
    when 'enrolled' then 12 when 'offer_lapsed' then 12 when 'offer_cancelled' then 12 end
$function$;

-- 3) legacy mapping — enrolled (active) → legacy 'enrolled'
create or replace function public.vsat__legacy_stage(p_stage text, p_status text)
returns text language sql immutable set search_path to '' as $function$
  select case
    when p_stage = 'exam_taken'   and p_status = 'not_selected' then 'vsat_not_cleared'
    when p_stage = 'vsat_cleared' and p_status = 'active'       then 'vsat_cleared'
    when p_stage = 'interview_scheduled' and p_status = 'active' then 'interview_selected'
    when p_stage = 'interviewed'  and p_status = 'not_selected' then 'interview_rejected'
    when p_stage = 'counselled'   and p_status = 'active'       then 'counselling_done'
    when p_stage = 'offer_sent'   and p_status = 'active'       then 'offer_released'
    when p_stage = 'enrolled'     and p_status = 'active'       then 'enrolled'
    when p_stage = 'offer_cancelled'                            then 'offer_cancelled'
  end
$function$;

-- 4) move existing rows, log the change
with moved as (
  update public.vsat_pipeline set stage = 'enrolled', stage_changed_at = now()
   where stage = 'seat_blocked'
   returning application_id, attempt_no, status
)
insert into public.vsat_stage_history (application_id, attempt_no, from_stage, to_stage, from_status, to_status, source)
select application_id, attempt_no, 'seat_blocked', 'enrolled', status, status, 'system' from moved;

-- 5) tighten the constraint — seat_blocked gone
alter table public.vsat_pipeline drop constraint if exists vsat_pipeline_stage_check;
alter table public.vsat_pipeline add constraint vsat_pipeline_stage_check
  check (stage = any (array[
    'applied','application_fee_paid','booked','eligible','exam_taken','vsat_cleared','interview_scheduled','interviewed',
    'pi_cleared','counselling_scheduled','counselled','offer_sent','enrolled','offer_lapsed','offer_cancelled'
  ]));

-- 6) auto-enroll: when the ₹50k enrollment is approved, advance the pipeline to 'enrolled'.
--    Best-effort; never fails the enrollment write.
create or replace function public.vsat__on_enrollment()
returns trigger language plpgsql security definer set search_path to '' as $fn$
declare st text; stt text;
begin
  if new.enrollment_stage = 'approved' and (tg_op = 'INSERT' or coalesce(old.enrollment_stage, '') <> 'approved') then
    select vp.stage, vp.status into st, stt from public.vsat_pipeline vp where vp.application_id = new.application_id;
    if st is not null and stt = 'active' and public.vsat__stage_order(st) < public.vsat__stage_order('enrolled') then
      begin
        perform public.vsat__move(new.application_id, 'enrolled', 'active', null, 'system', null, null);
      exception when others then null;
      end;
    end if;
  end if;
  return null;
end $fn$;
revoke all on function public.vsat__on_enrollment() from public, anon, authenticated;

drop trigger if exists trg_vsat_on_enrollment on public.application_manager;
create trigger trg_vsat_on_enrollment
  after insert or update of enrollment_stage on public.application_manager
  for each row execute function public.vsat__on_enrollment();

-- 7) mock result columns (mirroring the real-exam ones; student sees mock only)
alter table public.application_manager
  add column if not exists mock_percentile numeric,
  add column if not exists mock_sections   jsonb;

-- Rollback for 0094_vsat_pipeline_applied_stage.sql
-- Removes the 'applied' stage: drops the 'applied' pipeline rows + their history, restores
-- the original trigger / stage_order / check constraint (no 'applied').

-- 1) remove 'applied' pipeline rows and their history (so the constraint can be restored)
delete from public.vsat_stage_history h
 where exists (select 1 from public.vsat_pipeline vp where vp.application_id = h.application_id and vp.stage = 'applied');
delete from public.vsat_pipeline where stage = 'applied';

-- 2) restore the original trigger behaviour (enroll only at 'booked')
create or replace function public.vsat__on_application()
returns trigger language plpgsql security definer set search_path to '' as $fn$
declare st text; stt text;
begin
  if new.exam_date_id is not null and not exists (select 1 from public.vsat_pipeline vp where vp.application_id = new.application_id) then
    insert into public.vsat_pipeline (application_id, attempt_no, stage, status)
    values (new.application_id, least(greatest(coalesce(new.current_attempt, 1), 1), 2), 'booked', 'active')
    on conflict (application_id) do nothing;
    if found then
      insert into public.vsat_stage_history (application_id, attempt_no, to_stage, to_status, source)
      values (new.application_id, least(greatest(coalesce(new.current_attempt, 1), 1), 2), 'booked', 'active', 'system');
    end if;
  end if;
  if coalesce(new.exam_given, false) and (tg_op = 'INSERT' or not coalesce(old.exam_given, false)) then
    select vp.stage, vp.status into st, stt from public.vsat_pipeline vp where vp.application_id = new.application_id;
    if st in ('booked', 'eligible') and stt = 'active' then
      perform public.vsat__move(new.application_id, 'exam_taken', 'active', null, 'system', null, null);
    end if;
  end if;
  return null;
end $fn$;

drop trigger if exists trg_vsat_pipeline_sync on public.application_manager;
create trigger trg_vsat_pipeline_sync after insert or update of exam_date_id, exam_given on public.application_manager
  for each row execute function public.vsat__on_application();

-- 3) restore stage_order (no 'applied')
create or replace function public.vsat__stage_order(p_stage text)
returns integer language sql immutable set search_path to '' as $fn$
  select case p_stage
    when 'booked' then 1 when 'eligible' then 2 when 'exam_taken' then 3 when 'vsat_cleared' then 4
    when 'interview_scheduled' then 5 when 'interviewed' then 6 when 'pi_cleared' then 7
    when 'counselling_scheduled' then 8 when 'counselled' then 9 when 'offer_sent' then 10
    when 'seat_blocked' then 11 when 'offer_lapsed' then 11 when 'offer_cancelled' then 11 end
$fn$;

-- 4) restore the original check constraint (no 'applied')
alter table public.vsat_pipeline drop constraint if exists vsat_pipeline_stage_check;
alter table public.vsat_pipeline add constraint vsat_pipeline_stage_check
  check (stage = any (array[
    'booked','eligible','exam_taken','vsat_cleared','interview_scheduled','interviewed',
    'pi_cleared','counselling_scheduled','counselled','offer_sent','seat_blocked','offer_lapsed','offer_cancelled'
  ]));

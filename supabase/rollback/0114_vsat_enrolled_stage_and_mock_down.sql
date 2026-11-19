-- Rollback for 0114 — rename 'enrolled' back to 'seat_blocked', drop the auto-enroll trigger
-- and the mock columns. Any pipeline row at 'enrolled' reverts to 'seat_blocked' (its pre-0114
-- equivalent). vsat__stage_order / vsat__legacy_stage are restored byte-identical to pre-0114.

-- transitional constraint (both names)
alter table public.vsat_pipeline drop constraint if exists vsat_pipeline_stage_check;
alter table public.vsat_pipeline add constraint vsat_pipeline_stage_check
  check (stage = any (array[
    'applied','application_fee_paid','booked','eligible','exam_taken','vsat_cleared','interview_scheduled','interviewed',
    'pi_cleared','counselling_scheduled','counselled','offer_sent','seat_blocked','enrolled','offer_lapsed','offer_cancelled'
  ]));

create or replace function public.vsat__stage_order(p_stage text)
returns integer language sql immutable set search_path to '' as $function$
  select case p_stage
    when 'applied' then 0
    when 'application_fee_paid' then 1
    when 'booked' then 2 when 'eligible' then 3 when 'exam_taken' then 4 when 'vsat_cleared' then 5
    when 'interview_scheduled' then 6 when 'interviewed' then 7 when 'pi_cleared' then 8
    when 'counselling_scheduled' then 9 when 'counselled' then 10 when 'offer_sent' then 11
    when 'seat_blocked' then 12 when 'offer_lapsed' then 12 when 'offer_cancelled' then 12 end
$function$;

create or replace function public.vsat__legacy_stage(p_stage text, p_status text)
returns text language sql immutable set search_path to '' as $function$
  select case
    when p_stage = 'exam_taken'   and p_status = 'not_selected' then 'vsat_not_cleared'
    when p_stage = 'vsat_cleared' and p_status = 'active'       then 'vsat_cleared'
    when p_stage = 'interview_scheduled' and p_status = 'active' then 'interview_selected'
    when p_stage = 'interviewed'  and p_status = 'not_selected' then 'interview_rejected'
    when p_stage = 'counselled'   and p_status = 'active'       then 'counselling_done'
    when p_stage = 'offer_sent'   and p_status = 'active'       then 'offer_released'
    when p_stage = 'seat_blocked' and p_status = 'active'       then 'enrolled'
    when p_stage = 'offer_cancelled'                            then 'offer_cancelled'
  end
$function$;

update public.vsat_pipeline set stage = 'seat_blocked', stage_changed_at = now() where stage = 'enrolled';

alter table public.vsat_pipeline drop constraint if exists vsat_pipeline_stage_check;
alter table public.vsat_pipeline add constraint vsat_pipeline_stage_check
  check (stage = any (array[
    'applied','application_fee_paid','booked','eligible','exam_taken','vsat_cleared','interview_scheduled','interviewed',
    'pi_cleared','counselling_scheduled','counselled','offer_sent','seat_blocked','offer_lapsed','offer_cancelled'
  ]));

drop trigger if exists trg_vsat_on_enrollment on public.application_manager;
drop function if exists public.vsat__on_enrollment();

alter table public.application_manager drop column if exists mock_percentile;
alter table public.application_manager drop column if exists mock_sections;

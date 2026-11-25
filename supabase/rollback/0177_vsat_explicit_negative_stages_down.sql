-- Rollback 0177 · back to status-based "not selected" / "absent" (pre-0177 functions, rows restored from the snapshot).
-- Students an admin moved to VSAT not cleared / PI not cleared AFTER 0177 go back to Exam taken / Interviewed + not selected.
-- The 0177 'backfill' history rows stay (audit trail).

-- 1. widen the status check back to the four statuses
alter table public.vsat_pipeline drop constraint vsat_pipeline_status_check;
alter table public.vsat_pipeline add constraint vsat_pipeline_status_check
  check (status = any (array['active', 'not_selected', 'absent', 'on_hold']::text[]));

-- 2. rows the backfill moved: exact before values
update public.vsat_pipeline vp set stage = s.stage, status = s.status, stage_changed_at = now()
  from public.vsat_0177_backfill_snapshot s where s.application_id = vp.application_id;
update public.application_manager am set
    application_stage_1 = s.application_stage_1::public.vm_app_stage,
    application_stage_2 = s.application_stage_2::public.vm_app_stage
  from public.vsat_0177_backfill_snapshot s where s.application_id = am.application_id;
update public.lead_manager lm set lead_stage = s.lead_stage::public.vm_lead_stage
  from public.vsat_0177_backfill_snapshot s join public.application_manager am on am.application_id = s.application_id
 where lm.lead_id = am.lead_id and s.lead_stage is not null;

-- 3. anyone moved to the new stages after 0177
update public.vsat_pipeline set stage = 'exam_taken',  status = 'not_selected', stage_changed_at = now() where stage = 'vsat_not_cleared';
update public.vsat_pipeline set stage = 'interviewed', status = 'not_selected', stage_changed_at = now() where stage = 'pi_not_cleared';

-- 4. stage vocabulary as before
alter table public.vsat_pipeline drop constraint vsat_pipeline_stage_check;
alter table public.vsat_pipeline add constraint vsat_pipeline_stage_check check (stage = any (array[
  'applied', 'application_fee_paid', 'booked', 'eligible', 'exam_taken', 'vsat_cleared',
  'interview_scheduled', 'interviewed', 'pi_cleared', 'counselling_scheduled', 'counselled',
  'offer_sent', 'enrolled', 'offer_lapsed', 'offer_cancelled',
  'vsat_not_appeared', 'pi_not_appeared', 'counselling_not_appeared'
]::text[]));

-- 5. pre-0177 functions
create or replace function public.vsat__stage_order(p_stage text)
 returns integer
 language sql
 immutable
 set search_path to ''
as $function$
  select case p_stage
    when 'applied' then 0 when 'application_fee_paid' then 1
    when 'booked' then 2 when 'eligible' then 3 when 'exam_taken' then 4 when 'vsat_cleared' then 5
    when 'interview_scheduled' then 6 when 'interviewed' then 7 when 'pi_cleared' then 8
    when 'counselling_scheduled' then 9 when 'counselled' then 10 when 'offer_sent' then 11
    when 'enrolled' then 12 when 'offer_lapsed' then 12 when 'offer_cancelled' then 12
    when 'vsat_not_appeared' then 4 when 'pi_not_appeared' then 7 when 'counselling_not_appeared' then 10 end
$function$;

create or replace function public.vsat__legacy_stage(p_stage text, p_status text)
 returns text
 language sql
 immutable
 set search_path to ''
as $function$
  select case
    when p_stage = 'exam_taken'   and p_status = 'not_selected' then 'vsat_not_cleared'
    when p_stage = 'vsat_cleared' and p_status = 'active'       then 'vsat_cleared'
    when p_stage = 'interview_scheduled' and p_status = 'active' then 'interview_selected'
    when p_stage = 'interviewed'  and p_status = 'not_selected' then 'interview_rejected'
    when p_stage = 'counselled'   and p_status = 'active'       then 'counselling_done'
    when p_stage = 'offer_sent'   and p_status = 'active'       then 'offer_released'
    when p_stage = 'enrolled'     and p_status = 'active'       then 'enrolled'
    when p_stage = 'offer_cancelled'                            then 'offer_cancelled'
    when p_stage = 'vsat_not_appeared'                          then 'vsat_not_cleared'
    when p_stage = 'pi_not_appeared'                            then 'interview_rejected'
  end
$function$;

create or replace function public.vsat__is_terminal_fail(p_stage text, p_status text)
 returns boolean
 language sql
 immutable
 set search_path to ''
as $function$
  select p_stage in ('vsat_not_appeared', 'pi_not_appeared', 'counselling_not_appeared')
      or (p_stage = 'exam_taken'  and p_status = 'not_selected')
      or (p_stage = 'interviewed' and p_status = 'not_selected')
      or (p_stage = 'counselled'  and p_status = 'not_selected')
$function$;

create or replace function public.vsat__move_checked(p_app text, p_to_stage text, p_to_status text, p_reason text, p_expected_stage text, p_source text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare cur public.vsat_pipeline; campus text; to_stage text; to_status text; o_cur int; o_to int; need_reason boolean;
begin
  select vp.* into cur from public.vsat_pipeline vp where vp.application_id = p_app;
  if not found then
    if public.vsat__can_manage(null) then raise exception 'NOT_IN_PIPELINE' using errcode = 'P0002'; end if;
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select public.vsat__campus_key(am.campus_applied) into campus from public.application_manager am where am.application_id = p_app;
  to_stage  := coalesce(p_to_stage, cur.stage);
  to_status := coalesce(p_to_status, 'active');
  o_cur := public.vsat__stage_order(cur.stage);
  o_to  := public.vsat__stage_order(to_stage);
  if o_to is null then raise exception 'BAD_STAGE' using errcode = '22023'; end if;
  if to_status not in ('active', 'not_selected', 'absent', 'on_hold') then raise exception 'BAD_STATUS' using errcode = '22023'; end if;
  if p_reason is not null and char_length(p_reason) > 500 then raise exception 'REASON_TOO_LONG' using errcode = '22023'; end if;

  if public.vsat__can_manage(campus) then
    need_reason := o_to < o_cur or o_to > o_cur + 1 or to_status in ('not_selected', 'on_hold')
                   or (cur.status <> 'active' and to_status = 'active');
  elsif cur.stage = 'interview_scheduled' and public.vsat__is_assigned('interviewer', p_app, cur.attempt_no)
        and ((to_stage = 'interviewed' and to_status = 'active') or (to_stage = 'interview_scheduled' and to_status = 'absent')
             or (to_stage = 'pi_not_appeared' and to_status = 'absent')) then
    need_reason := false;
  elsif cur.stage = 'pi_not_appeared' and public.vsat__is_assigned('interviewer', p_app, cur.attempt_no)
        and (to_stage = 'interview_scheduled' and to_status = 'active') then
    need_reason := false;
  elsif cur.stage = 'counselling_scheduled' and public.vsat__is_assigned('counsellor', p_app, cur.attempt_no)
        and ((to_stage = 'counselled' and to_status = 'active') or (to_stage = 'counselling_scheduled' and to_status = 'absent')
             or (to_stage = 'counselling_not_appeared' and to_status = 'absent')) then
    need_reason := false;
  elsif cur.stage = 'counselling_not_appeared' and public.vsat__is_assigned('counsellor', p_app, cur.attempt_no)
        and (to_stage = 'counselling_scheduled' and to_status = 'active') then
    need_reason := false;
  else
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_expected_stage is not null and cur.stage <> p_expected_stage then
    raise exception 'STAGE_CHANGED' using errcode = '40001';
  end if;

  if need_reason and char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'REASON_REQUIRED' using errcode = '22023';
  end if;
  if to_stage = 'interview_scheduled' and cur.stage <> 'interview_scheduled'
     and not exists (select 1 from public.interview_assignments a where a.application_id = p_app and a.attempt_no = cur.attempt_no and a.interviewer_id is not null) then
    raise exception 'NEEDS_INTERVIEWER' using errcode = '22023';
  end if;
  if to_stage = 'counselling_scheduled' and cur.stage <> 'counselling_scheduled'
     and not exists (select 1 from public.counselling_assignments a where a.application_id = p_app and a.attempt_no = cur.attempt_no and a.counsellor_id is not null) then
    raise exception 'NEEDS_COUNSELLOR' using errcode = '22023';
  end if;

  return public.vsat__move(p_app, to_stage, to_status, p_reason, p_source, auth.uid(), p_expected_stage);
end $function$;

revoke all on function public.vsat__move_checked(text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.vsat__move_checked(text, text, text, text, text, text) to service_role;

drop function if exists public.vsat__retired_status_stage(text, text);
drop table if exists public.vsat_0177_backfill_snapshot;

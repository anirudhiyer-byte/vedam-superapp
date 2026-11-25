-- 0177 · VSAT stages: explicit "not cleared" stages, statuses cut to Active / On hold (staging first).
--
-- Owner's model (19 + 25 Nov 2026): every outcome is a STAGE the admin picks, not a status:
--   VSAT:        VSAT cleared · VSAT not cleared (sat the exam, failed) · VSAT not appeared (did not sit it)
--   Interview:   PI cleared   · PI not cleared   (attended, failed)      · PI not appeared   (did not join)
--   Counselling: Counselled   · Counselling not appeared   (counselling never rejects)
-- and the only statuses left are Active (in progress) and On hold (paused).
--
-- Before this, "not cleared" was status not_selected on Exam taken / Interviewed, and a no-show was status absent.
-- This adds the two missing stages and retires both statuses:
--   * vsat_not_cleared (order 5, next to VSAT cleared) and pi_not_cleared (order 8, next to PI cleared);
--     both mirror to the student's application stage exactly as before (vsat_not_cleared / interview_rejected),
--     so the student dashboard needs no change; both count as a terminal fail (attempt 2 is offered, as before).
--   * vsat__move_checked translates a caller that still sends not_selected / absent into the matching stage
--     (vsat__retired_status_stage), so nothing that has not been updated yet breaks; then only Active / On hold
--     pass. Moving a student into a "not cleared" stage still needs a reason, as "not selected" did.
--   * every row still on a retired status is moved through the normal engine (history source 'backfill',
--     application stage + lead stage mirrored); a status with no matching stage becomes On hold.
--   * the interview / counselling scheduling checks that test status <> 'not_selected' are left as they are:
--     those students now sit on a "not cleared" / "not appeared" stage, which those checks already exclude.
--
-- Rollback: supabase/rollback/0177_vsat_explicit_negative_stages_down.sql
-- Tests:    supabase/tests/vsat_explicit_negative_stages.test.sql

-- ═════════════ 1. stage vocabulary ═════════════
alter table public.vsat_pipeline drop constraint vsat_pipeline_stage_check;
alter table public.vsat_pipeline add constraint vsat_pipeline_stage_check check (stage = any (array[
  'applied', 'application_fee_paid', 'booked', 'eligible', 'exam_taken',
  'vsat_cleared', 'vsat_not_cleared', 'vsat_not_appeared',
  'interview_scheduled', 'interviewed', 'pi_cleared', 'pi_not_cleared', 'pi_not_appeared',
  'counselling_scheduled', 'counselled', 'counselling_not_appeared',
  'offer_sent', 'enrolled', 'offer_lapsed', 'offer_cancelled'
]::text[]));

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
    when 'vsat_not_appeared' then 4 when 'pi_not_appeared' then 7 when 'counselling_not_appeared' then 10
    when 'vsat_not_cleared' then 5 when 'pi_not_cleared' then 8 end
$function$;

-- the student's application stage (legacy enum) for a pipeline stage; the old status rows stay for history
create or replace function public.vsat__legacy_stage(p_stage text, p_status text)
 returns text
 language sql
 immutable
 set search_path to ''
as $function$
  select case
    when p_stage = 'vsat_not_cleared'                           then 'vsat_not_cleared'
    when p_stage = 'pi_not_cleared'                             then 'interview_rejected'
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
  select p_stage in ('vsat_not_cleared', 'pi_not_cleared', 'vsat_not_appeared', 'pi_not_appeared', 'counselling_not_appeared')
      or (p_stage = 'exam_taken'  and p_status = 'not_selected')
      or (p_stage = 'interviewed' and p_status = 'not_selected')
      or (p_stage = 'counselled'  and p_status = 'not_selected')
$function$;

-- ═════════════ 2. retired statuses → the matching stage ═════════════
-- not_selected = failed the step the student was on; absent = did not turn up for it. null = no matching stage.
create or replace function public.vsat__retired_status_stage(p_stage text, p_status text)
 returns text
 language sql
 immutable
 set search_path to ''
as $function$
  select case
    when p_status = 'not_selected' and p_stage in ('booked', 'eligible', 'exam_taken', 'vsat_not_cleared') then 'vsat_not_cleared'
    when p_status = 'not_selected' and p_stage in ('vsat_cleared', 'interview_scheduled', 'interviewed', 'pi_not_cleared') then 'pi_not_cleared'
    when p_status = 'absent' and p_stage in ('booked', 'eligible', 'exam_taken', 'vsat_not_appeared') then 'vsat_not_appeared'
    when p_status = 'absent' and p_stage in ('vsat_cleared', 'interview_scheduled', 'interviewed', 'pi_not_appeared') then 'pi_not_appeared'
    when p_status = 'absent' and p_stage in ('pi_cleared', 'counselling_scheduled', 'counselled', 'counselling_not_appeared') then 'counselling_not_appeared'
  end
$function$;

revoke all on function public.vsat__retired_status_stage(text, text) from public, anon, authenticated;
grant execute on function public.vsat__retired_status_stage(text, text) to service_role;

-- ═════════════ 3. the checked move: translate, then Active / On hold only ═════════════
create or replace function public.vsat__move_checked(p_app text, p_to_stage text, p_to_status text, p_reason text, p_expected_stage text, p_source text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare cur public.vsat_pipeline; campus text; to_stage text; to_status text; o_cur int; o_to int; need_reason boolean; v_mapped text;
begin
  select vp.* into cur from public.vsat_pipeline vp where vp.application_id = p_app;
  if not found then
    if public.vsat__can_manage(null) then raise exception 'NOT_IN_PIPELINE' using errcode = 'P0002'; end if;
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select public.vsat__campus_key(am.campus_applied) into campus from public.application_manager am where am.application_id = p_app;
  to_stage  := coalesce(p_to_stage, cur.stage);
  to_status := coalesce(p_to_status, 'active');
  -- 0177: "not selected" / "absent" are retired — an older caller is moved to the matching stage instead
  if to_status in ('not_selected', 'absent') then
    v_mapped := public.vsat__retired_status_stage(to_stage, to_status);
    if v_mapped is null then raise exception 'BAD_STATUS' using errcode = '22023'; end if;
    to_stage := v_mapped; to_status := 'active';
  end if;
  o_cur := public.vsat__stage_order(cur.stage);
  o_to  := public.vsat__stage_order(to_stage);
  if o_to is null then raise exception 'BAD_STAGE' using errcode = '22023'; end if;
  if to_status not in ('active', 'on_hold') then raise exception 'BAD_STATUS' using errcode = '22023'; end if;
  if p_reason is not null and char_length(p_reason) > 500 then raise exception 'REASON_TOO_LONG' using errcode = '22023'; end if;

  if public.vsat__can_manage(campus) then
    -- a reason, as before: going back, skipping, On hold, rejecting (into a "not cleared" stage),
    -- reopening (out of any "not cleared" / "not appeared" stage), or resuming from On hold
    need_reason := o_to < o_cur or o_to > o_cur + 1 or to_status = 'on_hold'
                   or (to_stage in ('vsat_not_cleared', 'pi_not_cleared') and to_stage <> cur.stage)
                   or (cur.stage in ('vsat_not_cleared', 'pi_not_cleared', 'vsat_not_appeared', 'pi_not_appeared', 'counselling_not_appeared')
                       and to_stage <> cur.stage)
                   or (cur.status <> 'active' and to_status = 'active');
  elsif cur.stage = 'interview_scheduled' and public.vsat__is_assigned('interviewer', p_app, cur.attempt_no)
        and to_status = 'active' and to_stage in ('interviewed', 'pi_not_appeared') then
    need_reason := false;
  elsif cur.stage = 'pi_not_appeared' and public.vsat__is_assigned('interviewer', p_app, cur.attempt_no)
        and to_stage = 'interview_scheduled' and to_status = 'active' then
    need_reason := false;
  elsif cur.stage = 'counselling_scheduled' and public.vsat__is_assigned('counsellor', p_app, cur.attempt_no)
        and to_status = 'active' and to_stage in ('counselled', 'counselling_not_appeared') then
    need_reason := false;
  elsif cur.stage = 'counselling_not_appeared' and public.vsat__is_assigned('counsellor', p_app, cur.attempt_no)
        and to_stage = 'counselling_scheduled' and to_status = 'active' then
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

-- ═════════════ 4. move every row still on a retired status (through the engine: history + mirrors) ═════════════
-- snapshot first, so the rollback restores these rows exactly (pipeline + the mirrored application / lead stage)
create table if not exists public.vsat_0177_backfill_snapshot (
  application_id      text primary key,
  stage               text not null,
  status              text not null,
  application_stage_1 text,
  application_stage_2 text,
  lead_stage          text,
  taken_at            timestamptz not null default now()
);
alter table public.vsat_0177_backfill_snapshot enable row level security;
revoke all on table public.vsat_0177_backfill_snapshot from public, anon, authenticated;
comment on table public.vsat_0177_backfill_snapshot is
  '0177: rows moved off a retired status (before values). Read by the 0177 rollback only; safe to drop once 0177 is final.';

insert into public.vsat_0177_backfill_snapshot (application_id, stage, status, application_stage_1, application_stage_2, lead_stage)
select vp.application_id, vp.stage, vp.status, am.application_stage_1::text, am.application_stage_2::text, lm.lead_stage::text
  from public.vsat_pipeline vp
  left join public.application_manager am on am.application_id = vp.application_id
  left join public.lead_manager lm on lm.lead_id = am.lead_id
 where vp.status in ('not_selected', 'absent')
on conflict (application_id) do nothing;

do $$
declare r record; v_to text; v_status text;
begin
  for r in select vp.application_id, vp.stage, vp.status from public.vsat_pipeline vp
            where vp.status in ('not_selected', 'absent') order by vp.application_id loop
    v_to := public.vsat__retired_status_stage(r.stage, r.status);
    v_status := case when v_to is null then 'on_hold' else 'active' end;
    perform public.vsat__move(r.application_id, coalesce(v_to, r.stage), v_status,
      '0177: status "' || r.status || '" retired (was ' || r.stage || ')', 'backfill', null, r.stage);
  end loop;
end $$;

-- ═════════════ 5. only Active / On hold from now on ═════════════
alter table public.vsat_pipeline drop constraint vsat_pipeline_status_check;
alter table public.vsat_pipeline add constraint vsat_pipeline_status_check check (status = any (array['active', 'on_hold']::text[]));

-- 0153 · VSAT second attempt — reset to a fresh attempt-2 VSAT re-sit.
--
-- A candidate who closed attempt 1 in a terminal-fail state (VSAT not cleared / not appeared,
-- PI not cleared / not appeared, counselling not cleared / not appeared) may take a 2nd attempt.
-- Decision: a 2nd attempt always re-sits the VSAT from the top (pick a new exam date), so the
-- reset snapshots attempt-1 results into the per-attempt _1 columns and returns the pipeline to
-- 'application_fee_paid' (paid, awaiting a new exam date) with attempt_no = 2.
--
-- Two entry points:
--   • student: pays ₹500 → webhook sets payment_stage_2 = 'payment_approved' → trg_vsat_attempt2
--     fires vsat__begin_attempt2 (source 'payment').
--   • admin:   vsat_start_second_attempt(p) — manager/admin only (e.g. offline payment / waiver).
--
-- Rollback: supabase/rollback/0153_vsat_second_attempt_down.sql

-- terminal-fail test for attempt 1 (closed, not progressing)
create or replace function public.vsat__is_terminal_fail(p_stage text, p_status text)
returns boolean language sql immutable set search_path to '' as $function$
  select p_stage in ('vsat_not_appeared', 'pi_not_appeared', 'counselling_not_appeared')
      or (p_stage = 'exam_taken'  and p_status = 'not_selected')
      or (p_stage = 'interviewed' and p_status = 'not_selected')
      or (p_stage = 'counselled'  and p_status = 'not_selected')
$function$;

-- core reset — SECURITY DEFINER, no auth check of its own (callers gate). Idempotent-safe:
-- it refuses unless the row is attempt 1 in a terminal-fail state.
create or replace function public.vsat__begin_attempt2(p_app text, p_source text, p_actor uuid)
returns jsonb language plpgsql security definer set search_path to '' as $function$
declare cur public.vsat_pipeline; am public.application_manager;
begin
  select * into cur from public.vsat_pipeline where application_id = p_app for update;
  if not found then raise exception 'NOT_IN_PIPELINE' using errcode = 'P0002'; end if;
  if cur.attempt_no <> 1 then raise exception 'ALREADY_SECOND_ATTEMPT' using errcode = '22023'; end if;
  if not public.vsat__is_terminal_fail(cur.stage, cur.status) then raise exception 'NOT_ELIGIBLE_FOR_RETRY' using errcode = '22023'; end if;
  select * into am from public.application_manager where application_id = p_app for update;

  -- 1) snapshot attempt-1 results into the per-attempt _1 columns (keep the single-row value too
  --    until attempt 2 overwrites it). application_stage_1 already holds the attempt-1 legacy stage.
  update public.application_manager a
     set vps_score_1       = coalesce(a.vps_score_1, a.vps_score),
         scholarship_pct_1 = coalesce(a.scholarship_pct_1, a.scholarship_percentage),
         -- 2) clear the single-row attempt fields so attempt 2 starts fresh
         current_attempt       = 2,
         exam_date_id          = null,
         exam_given            = false,
         exam_percentile       = null,
         vps_score             = null,
         scholarship_percentage = null,
         application_stage_2   = null,
         last_updated_date     = now()
   where a.application_id = p_app;

  -- 3) reset the pipeline row to a fresh attempt 2 (paid, awaiting a new exam date)
  update public.vsat_pipeline
     set attempt_no = 2, stage = 'application_fee_paid', status = 'active',
         stage_changed_at = now(), stage_changed_by = p_actor
   where application_id = p_app;
  insert into public.vsat_stage_history (application_id, attempt_no, from_stage, to_stage, from_status, to_status, reason, source, actor_id)
  values (p_app, 2, cur.stage, 'application_fee_paid', cur.status, 'active',
          left('Second attempt started (attempt 1 closed at ' || cur.stage || '/' || cur.status || ')', 500), p_source, p_actor);

  return jsonb_build_object('ok', true, 'application_id', p_app, 'attempt_no', 2, 'stage', 'application_fee_paid');
end $function$;
revoke all on function public.vsat__begin_attempt2(text, text, uuid) from public, anon, authenticated;

-- student path: payment_stage_2 approved → begin attempt 2 (best-effort; never fails the payment write)
create or replace function public.vsat__on_attempt2_payment()
returns trigger language plpgsql security definer set search_path to '' as $fn$
begin
  if new.payment_stage_2 = 'payment_approved'
     and (tg_op = 'INSERT' or old.payment_stage_2 is distinct from new.payment_stage_2) then
    begin
      perform public.vsat__begin_attempt2(new.application_id, 'payment', null);
    exception when others then null;
    end;
  end if;
  return null;
end $fn$;
revoke all on function public.vsat__on_attempt2_payment() from public, anon, authenticated;

drop trigger if exists trg_vsat_attempt2 on public.application_manager;
create trigger trg_vsat_attempt2
  after insert or update of payment_stage_2 on public.application_manager
  for each row execute function public.vsat__on_attempt2_payment();

-- admin path: manager/admin starts a 2nd attempt directly (offline payment / waiver)
create or replace function public.vsat_start_second_attempt(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $function$
declare app text; v_campus text;
begin
  if auth.uid() is null then raise exception 'NOT_SIGNED_IN' using errcode = '42501'; end if;
  perform public.vsat__check_keys(p, array['application_id']);
  app := public.vsat__txt(p, 'application_id', 64, true);
  select public.vsat__campus_key(am.campus_applied) into v_campus from public.application_manager am where am.application_id = app;
  if not public.vsat__can_manage(v_campus) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  perform public.vsat__begin_attempt2(app, 'admin', auth.uid());
  return public.vsat_student(app);
end $function$;
revoke all on function public.vsat_start_second_attempt(jsonb) from public, anon;
grant execute on function public.vsat_start_second_attempt(jsonb) to authenticated;
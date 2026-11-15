-- Rollback for 0082_vsat_achievements_bonus.sql
-- Puts back the 0081 versions of vsat_scholarship_preview and vsat_submit_counselling (copied
-- verbatim from 0081) and removes the function comment 0082 added. Grants are unchanged.

create or replace function public.vsat_scholarship_preview(p_application_id text)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare inp jsonb; v_campus text; d uuid; sc jsonb;
begin
  if auth.uid() is null then raise exception 'NOT_SIGNED_IN' using errcode = '42501'; end if;
  if not public.vsat__can_view(p_application_id) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  select public.vsat__campus_key(am.campus_applied), am.exam_date_id into v_campus, d from public.application_manager am where am.application_id = p_application_id;
  if v_campus is null then raise exception 'CAMPUS_MISSING' using errcode = '22023'; end if;
  inp := public.vsat__scholarship_inputs(p_application_id);
  sc := public.vsat_calc_scholarship(inp, v_campus, d);
  return sc || jsonb_build_object('inputs', inp, 'campus', v_campus,
           'jee_floor_enabled', (select c.jee_floor_enabled from public.vsat_campus_settings c where c.campus = v_campus),
           'programme_fee', (select c.programme_fee from public.vsat_campus_settings c where c.campus = v_campus));
end $$;

-- p: {application_id, chosen_step, special_rating?, actual_pct?, actual_reason?, remarks?}
create or replace function public.vsat_submit_counselling(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  app text; vp public.vsat_pipeline; ca public.counselling_assignments; v_campus text; mgr boolean;
  pre jsonb; step numeric; rating int; fin jsonb; actual numeric; reason text;
begin
  if auth.uid() is null then raise exception 'NOT_SIGNED_IN' using errcode = '42501'; end if;
  perform public.vsat__check_keys(p, array['application_id', 'chosen_step', 'special_rating', 'actual_pct', 'actual_reason', 'remarks']);
  app := public.vsat__txt(p, 'application_id', 64, true);
  select * into vp from public.vsat_pipeline where application_id = app;
  if not found then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  select public.vsat__campus_key(am.campus_applied) into v_campus from public.application_manager am where am.application_id = app;
  mgr := public.vsat__can_manage(v_campus);
  if not mgr and not public.vsat__is_assigned('counsellor', app, vp.attempt_no) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if vp.stage <> 'counselling_scheduled' then raise exception 'WRONG_STAGE' using errcode = '22023'; end if;
  select * into ca from public.counselling_assignments c where c.application_id = app and c.attempt_no = vp.attempt_no order by c.created_at desc limit 1;
  if not found then raise exception 'NEEDS_COUNSELLOR' using errcode = '22023'; end if;

  pre := public.vsat_scholarship_preview(app);
  step := public.vsat__num(p, 'chosen_step', 0, 100, true);
  if not (pre->'award_steps' @> to_jsonb(step)) and not exists (select 1 from jsonb_array_elements(pre->'award_steps') e where (e::text)::numeric = step) then
    raise exception 'BAD_VALUE: chosen_step' using errcode = '22023';
  end if;
  rating := public.vsat__num(p, 'special_rating', 1, 5, false)::int;
  fin := public.vsat_calc_final_scholarship(step, (pre->>'jee_floor')::numeric, rating, v_campus);
  actual := coalesce(public.vsat__num(p, 'actual_pct', 0, 100, false), (fin->>'pct')::numeric);
  reason := public.vsat__txt(p, 'actual_reason', 500, false);
  if actual <> (fin->>'pct')::numeric and char_length(coalesce(reason, '')) < 3 then raise exception 'REASON_REQUIRED' using errcode = '22023'; end if;

  update public.counselling_assignments c set
    calc_score = (pre->>'score')::numeric, calc_case = pre->>'case', calc_category = (pre->>'category')::int, award_steps = pre->'award_steps',
    calc_inputs = pre->'inputs', chosen_step = step, jee_floor = (pre->>'jee_floor')::numeric, special_rating = rating,
    bonus_applied = (fin->>'bonus_applied')::boolean, calculated_pct = (fin->>'pct')::numeric, actual_pct = actual,
    actual_reason = case when actual <> (fin->>'pct')::numeric then reason end, counsellor_remarks = public.vsat__txt(p, 'remarks', 2000, false),
    scholarship_pct = actual, scholarship_category = (pre->>'category')::int,
    pay_timeline_days = (select s.offer_days from public.vsat_campus_settings s where s.campus = v_campus),
    attendance = 'done', submitted_at = now(), submitted_by = auth.uid()
   where c.id = ca.id;

  if vp.attempt_no = 2 then
    update public.application_manager set counselling_status_2 = 'done', scholarship_pct_2 = actual, scholarship_category_2 = (pre->>'category')::int,
           scholarship_percentage = actual where application_id = app;
  else
    update public.application_manager set counselling_status_1 = 'done', scholarship_pct_1 = actual, scholarship_category_1 = (pre->>'category')::int,
           scholarship_percentage = actual where application_id = app;
  end if;

  perform public.vsat__move(app, 'counselled', 'active', case when actual <> (fin->>'pct')::numeric then reason end, 'manual', auth.uid(), null);
  return jsonb_build_object('calculated_pct', fin->'pct', 'actual_pct', actual, 'category', pre->'category', 'bonus_applied', fin->'bonus_applied',
                            'jee_floor_applied', fin->'jee_floor_applied', 'stage', 'counselled');
end $$;

comment on function public.vsat_calc_final_scholarship(numeric, numeric, int, text) is null;

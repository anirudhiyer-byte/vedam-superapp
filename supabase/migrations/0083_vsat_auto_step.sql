-- 0083 · VSAT pipeline — scholarship step and final % come only from the sheet formulas
--
-- Decisions (13 Nov 2026):
--   Q2  the step inside a category is picked the way sheet column BK ("Scholarship as Per
--       Weightage") does it: split the category's score range into its buckets; the bucket the
--       score falls in gives the step (min award + bucket × step size).
--   Q8  only the formula counts — nobody types a different %.
--
-- Changes:
--   • new vsat_calc_auto_step(score, min, max, buckets, min award, max award): the BK formula.
--     Private (no browser access), like the other vsat_calc_* functions.
--   • vsat_calc_scholarship also returns auto_step (so vsat_scholarship_preview shows it).
--   • vsat_submit_counselling takes only {application_id, remarks}; chosen_step, actual_pct and
--     actual_reason are refused (UNKNOWN_KEY). It saves chosen_step = auto_step and
--     actual_pct = calculated_pct. The admin override for VPS / eligibility (0080) stays.
-- Rollback: supabase/rollback/0083_vsat_auto_step_down.sql.

-- Sheet BK:  IF(score < min, 0, min award + MAX(0, MIN(buckets − 1, FLOOR((score − min) / ((max − min) / buckets)))) × step size)
--            step size = (max award − min award) / (buckets − 1), or 0 for one bucket; shown without trailing zeros (20, not 20.00)
create or replace function public.vsat_calc_auto_step(
  p_score numeric, p_min_score numeric, p_max_score numeric, p_buckets int, p_min_award numeric, p_max_award numeric)
returns numeric language sql immutable set search_path to '' as $$
  select case
    when p_score is null or p_buckets is null or p_buckets < 1 or p_max_score <= p_min_score then null
    when p_score < p_min_score then 0
    else trim_scale(round(p_min_award
               + greatest(0, least(p_buckets - 1, floor((p_score - p_min_score) / ((p_max_score - p_min_score) / p_buckets))))
                 * case when p_buckets > 1 then (p_max_award - p_min_award) / (p_buckets - 1) else 0 end, 2))
  end
$$;
revoke all on function public.vsat_calc_auto_step(numeric, numeric, numeric, int, numeric, numeric) from public, anon, authenticated;

create or replace function public.vsat_calc_scholarship(p jsonb, p_campus text, p_exam_date_id uuid)
returns jsonb language plpgsql stable set search_path to '' as $$
declare
  vs numeric; c10 numeric; c12 numeric; iv numeric; cs numeric; jee numeric; jm numeric; m10 numeric; m12 numeric;
  k text; s numeric; b record; steps jsonb; auto numeric; floor_pct numeric; k_missing text[] := '{}'; key text;
begin
  if p_campus not in ('pune', 'gurugram') then raise exception 'campus_invalid' using errcode = '22023'; end if;
  foreach key in array array['vsat_pct','class10_pct','class12_pct','interview_score','cs_passion','jee_pct','jee_maths_pct','class10_maths_pct','class12_maths_pct'] loop
    if p ? key and jsonb_typeof(p->key) not in ('number', 'null') then raise exception 'input_not_a_number: %', key using errcode = '22023'; end if;
  end loop;
  vs := (p->>'vsat_pct')::numeric;  c10 := (p->>'class10_pct')::numeric;  c12 := (p->>'class12_pct')::numeric;
  iv := (p->>'interview_score')::numeric;  cs := (p->>'cs_passion')::numeric;
  jee := (p->>'jee_pct')::numeric;  jm := (p->>'jee_maths_pct')::numeric;
  m10 := (p->>'class10_maths_pct')::numeric;  m12 := (p->>'class12_maths_pct')::numeric;
  if exists (select 1 from unnest(array[vs, c10, c12, jee, jm, m10, m12]) x where x < 0 or x > 100)
     or iv < 0 or iv > 5 or cs < 0 or cs > 5 then
    raise exception 'input_out_of_range' using errcode = '22023';
  end if;

  k := case when jee is not null and c12 is not null then 'jee_and_12th'
            when c12 is not null then '12th_only'
            when jee is not null then 'jee_only' else 'neither' end;
  -- inputs the chosen case uses but which are empty (counted as 0, like the sheet)
  k_missing := array(select n from (values
                       ('vsat_pct', vs, true), ('class10_pct', c10, true), ('interview_score', iv, true),
                       ('cs_passion', cs, true), ('class10_maths_pct', m10, true),
                       ('jee_maths_pct', jm, k in ('jee_and_12th', 'jee_only')),
                       ('class12_maths_pct', m12, k in ('jee_and_12th', '12th_only'))) v(n, x, used)
                     where used and x is null);
  s := case k
    when 'neither'      then coalesce(vs,0)*0.25 + coalesce(c10,0)*0.20 + coalesce(iv,0)*20*0.35 + coalesce(m10,0)*0.10 + coalesce(cs,0)*20*0.10
    when 'jee_and_12th' then coalesce(vs,0)*0.15 + coalesce(c10,0)*0.05 + coalesce(m10,0)*0.05 + coalesce(m12,0)*0.10 + c12*0.10
                             + coalesce(iv,0)*20*0.15 + jee*0.20 + coalesce(jm,0)*0.15 + coalesce(cs,0)*20*0.05
    when '12th_only'    then coalesce(vs,0)*0.20 + coalesce(c10,0)*0.05 + c12*0.20 + coalesce(iv,0)*20*0.20 + coalesce(m12,0)*0.15
                             + coalesce(m10,0)*0.15 + coalesce(cs,0)*20*0.05
    else                     coalesce(vs,0)*0.20 + coalesce(c10,0)*0.05 + jee*0.20 + coalesce(jm,0)*0.15 + coalesce(iv,0)*20*0.20
                             + coalesce(m10,0)*0.15 + coalesce(cs,0)*20*0.05
  end;
  s := round(s, 4);

  -- band: this batch's bands for the campus, else the defaults; lower edge included, category 1 includes 100
  select * into b from public.vsat_scholarship_bands sb
   where sb.campus = p_campus
     and sb.exam_date_id is not distinct from (
           case when exists (select 1 from public.vsat_scholarship_bands x where x.campus = p_campus and x.exam_date_id = p_exam_date_id)
                then p_exam_date_id end)
     and s >= sb.min_score and (s < sb.max_score or (sb.category = 1 and s <= sb.max_score))
   order by sb.category limit 1;

  if b.id is not null then
    steps := (select jsonb_agg(round(b.min_award + i * (b.max_award - b.min_award) / greatest(b.steps - 1, 1), 2) order by i)
                from generate_series(0, b.steps - 1) i);
    -- the sheet's "Scholarship as Per Weightage" (column BK): the step is picked by where the score sits in the band
    auto := public.vsat_calc_auto_step(s, b.min_score, b.max_score, b.steps, b.min_award, b.max_award);
  end if;

  floor_pct := case when jee is null or jee < 90 then null when jee >= 98.5 then 70 when jee >= 97 then 60
                    when jee >= 95 then 50 when jee >= 93 then 40 else 30 end;

  return jsonb_build_object('case', k, 'score', s, 'category', b.category, 'min_award', b.min_award, 'max_award', b.max_award,
                            'award_steps', coalesce(steps, '[]'::jsonb), 'auto_step', auto, 'jee_floor', floor_pct,
                            'missing', to_jsonb(k_missing));
end $$;

-- p: {application_id, remarks?}  — the step and the final % come only from the formulas
create or replace function public.vsat_submit_counselling(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  app text; vp public.vsat_pipeline; ca public.counselling_assignments; v_campus text; mgr boolean;
  pre jsonb; step numeric; rating int; fin jsonb; actual numeric;
begin
  if auth.uid() is null then raise exception 'NOT_SIGNED_IN' using errcode = '42501'; end if;
  perform public.vsat__check_keys(p, array['application_id', 'remarks']);
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
  step := (pre->>'auto_step')::numeric;  -- sheet column BK, never from the request
  if step is null then raise exception 'NO_BAND' using errcode = '22023'; end if;
  rating := (pre->>'special_rating')::int;  -- from the interview (achievements), never from the request
  fin := public.vsat_calc_final_scholarship(step, (pre->>'jee_floor')::numeric, rating, v_campus);
  actual := (fin->>'pct')::numeric;  -- formula only (Q8): no hand-typed %

  update public.counselling_assignments c set
    calc_score = (pre->>'score')::numeric, calc_case = pre->>'case', calc_category = (pre->>'category')::int, award_steps = pre->'award_steps',
    calc_inputs = pre->'inputs', chosen_step = step, jee_floor = (pre->>'jee_floor')::numeric, special_rating = rating,
    bonus_applied = (fin->>'bonus_applied')::boolean, calculated_pct = (fin->>'pct')::numeric, actual_pct = actual,
    actual_reason = null, counsellor_remarks = public.vsat__txt(p, 'remarks', 2000, false),
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

  perform public.vsat__move(app, 'counselled', 'active', null, 'manual', auth.uid(), null);
  return jsonb_build_object('step', step, 'calculated_pct', fin->'pct', 'actual_pct', actual, 'category', pre->'category', 'bonus_applied', fin->'bonus_applied',
                            'special_rating', rating, 'jee_floor_applied', fin->'jee_floor_applied', 'stage', 'counselled');
end $$;

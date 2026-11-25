-- Rollback of 0191 · Profile Analysis page.
-- Puts back the 0173 body of vsat_profile_start (field list inline, as before) and drops the three new functions.
-- No data is touched (0191 changed no tables).

create or replace function public.vsat_profile_start(p_application_id text)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  vp public.vsat_pipeline; am public.application_manager; ia public.interview_assignments; ca public.counselling_assignments;
  v_campus text; run uuid; f jsonb; iv_name text; vsat_pct numeric;
begin
  if auth.uid() is null then raise exception 'NOT_SIGNED_IN' using errcode = '42501'; end if;
  if p_application_id is null or char_length(p_application_id) > 64 then raise exception 'BAD_VALUE: application_id' using errcode = '22023'; end if;
  select * into vp from public.vsat_pipeline where application_id = p_application_id;
  if not found then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  select * into am from public.application_manager where application_id = p_application_id;
  v_campus := public.vsat__campus_key(am.campus_applied);
  if not public.vsat__can_manage(v_campus) and not public.vsat__is_assigned('counsellor', p_application_id, vp.attempt_no) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select * into ca from public.counselling_assignments c
   where c.application_id = p_application_id and c.attempt_no = vp.attempt_no order by c.created_at desc limit 1;
  if not found then raise exception 'NEEDS_COUNSELLOR' using errcode = '22023'; end if;

  -- limits: 30 runs per user per hour; one run per student at a time (2 minutes)
  if (select count(*) from public.vsat_profile_runs r where r.user_id = auth.uid() and r.created_at > now() - interval '1 hour') >= 30 then
    raise exception 'RATE_LIMITED' using errcode = '54000';
  end if;
  if exists (select 1 from public.vsat_profile_runs r where r.application_id = p_application_id and r.status = 'started'
               and r.created_at > now() - interval '2 minutes') then
    raise exception 'IN_PROGRESS' using errcode = '55006';
  end if;

  select * into ia from public.interview_assignments a
   where a.application_id = p_application_id and a.attempt_no = vp.attempt_no order by a.created_at desc limit 1;
  select coalesce(p.full_name, p.email) into iv_name from public.profiles p where p.id = ia.interviewer_id;
  vsat_pct := case when am.exam_max_marks > 0 then round(am.exam_obtained_marks / am.exam_max_marks * 100, 2) end;

  -- the sheet's fields (first + last name as one, country left out: not stored; labels as in the sheet, scales added
  -- where the sheet notes them); empty ones are skipped. No email, phone or address.
  select coalesce(jsonb_agg(jsonb_build_array(x.label, x.val) order by x.n), '[]'::jsonb) into f
    from (values
      (1,  'Name', am.registered_name),
      (2,  'Gender', am.gender),
      (3,  'DOB', am.date_of_birth::text),
      (4,  'Campus Preference', am.campus_applied),
      (5,  'State', am.state),
      (6,  'City', am.city),
      (7,  'Year Of Passing 10th Class', am.class10_year::text),
      (8,  'Class 10th Percentage', am.class10_percentage::text),
      (9,  'Math Score In Xth/SSC', am.class10_maths_percentage::text),
      (10, 'Year Of Passing 12th Class', am.class12_year::text),
      (11, 'Score / Slabs (12th)', am.class12_percentage::text),
      (12, 'Math Score In XIIth', am.class12_maths_percentage::text),
      (13, 'PCM marks in 12th (Physics / Chemistry / Maths)',
           case when coalesce(am.marks_physics_12, am.marks_chemistry_12, am.marks_maths_12) is not null
                then concat_ws(' / ', am.marks_physics_12, am.marks_chemistry_12, am.marks_maths_12) end),
      (14, 'Registered For JEE Mains', case am.jee_registered when true then 'Yes' when false then 'No' end),
      (15, 'When Did You Appear For JEE Mains', am.jee_appeared_when::text),
      (16, 'JEE Mains Percentile', coalesce(ia.jee_pct, case when am.jee_registered then am.entrance_percentile end)::text),
      (17, 'JEE Mains Maths Percentile', coalesce(ia.jee_maths_pct, case when am.jee_registered then am.jee_main_maths_percentile end)::text),
      (18, 'Studied Computer Science', case am.studied_cs when true then 'Yes' when false then 'No' end),
      (19, 'Computer Science Experience', am.cs_experience::text),
      (20, 'VPS (out of 10)', am.vps_score::text),
      (21, 'VSAT Obtained Score (correct answers out of 50)', am.exam_obtained_marks::text),
      (22, 'VSAT Percentage', vsat_pct::text),
      (23, 'VSAT section scores and time taken', case when am.exam_sections is not null and am.exam_sections::text not in ('null', '{}', '[]') then am.exam_sections::text end),
      (24, 'Interview Score (out of 5)', ia.weighted_avg::text),
      (25, 'Interviewer Name', iv_name),
      (26, 'Fathers Occupation', am.father_occupation),
      (27, 'Mothers Occupation', am.mother_occupation),
      (28, 'Communication & Behavioural Skills (out of 5)', ia.rubric_behavioural::text),
      (29, 'Behavioural & Communication — Remarks', ia.remarks->>'communication'),
      (30, 'Guesstimate & Logical Reasoning (out of 5)', ia.rubric_math::text),
      (31, 'Cheating seen while solving questions', case ia.cheating_seen when true then 'Yes' when false then 'No' end),
      (32, 'Passion & Motivation for Computer Science (out of 5)', ia.rubric_passion::text),
      (33, 'Passion & Motivation for CS — Remarks', ia.remarks->>'passion'),
      (34, 'Achievements & Extracurricular Activities (out of 5)', ia.rubric_achievements::text),
      (35, 'National-level certificate asked to be shared', case ia.cert_asked when true then 'Yes' when false then 'No' end),
      (36, 'Achievement & Extracurricular — Remarks', ia.remarks->>'achievements'),
      (37, 'Why This Program? (out of 5)', ia.rubric_why_program::text),
      (38, 'Why This Program — Remarks', ia.remarks->>'why_program'),
      (39, 'Guesstimate & Logical Reasoning — Remarks', ia.remarks->>'logic'),
      (40, 'Financial Capability (High: ₹15L+ a year; Medium: ₹6–15L; Low: under ₹6L)', initcap(ia.financial_capability)),
      (41, 'Why? (Financial explanation)', ia.financial_reason),
      (42, 'Why should Vedam accept your application and what could the batch learn from you?', ia.why_accept),
      (43, 'Scholarship Awarded (%)', coalesce(ca.actual_pct, ca.scholarship_pct)::text),
      -- vsat_interview_evaluation: the verdict from Interview Evaluation; an older form keeps its interviewer / sheet verdict
      (44, 'Final Verdict', coalesce(ia.verdict, ia.interviewer_verdict, case when ia.calc_verdict is null then ia.result end))
    ) x(n, label, val)
   where x.val is not null and btrim(x.val) <> '';

  insert into public.vsat_profile_runs (application_id, attempt_no, user_id) values (p_application_id, vp.attempt_no, auth.uid())
  returning id into run;
  return jsonb_build_object('run_id', run, 'fields', f);
end $$;
revoke all on function public.vsat_profile_start(text) from public, anon;
grant execute on function public.vsat_profile_start(text) to authenticated;

drop function if exists public.vsat_profile_get(jsonb);
drop function if exists public.vsat_profile_lookup(jsonb);
drop function if exists public.vsat__profile_fields(text);

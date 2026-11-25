-- 0191 · VSAT Phase 7 — Profile Analysis page (sir's review, 24 Nov 2026) — STAGING FIRST.
--
-- Sir (transcript): under Buckets there is one more page, Profile Analysis. Like the "Profile Analyzer" tab of the VSAT
-- Student Details sheet: search the student by application ID and pick the VSAT, so they are easy to find; all the fields
-- fill in by themselves from the different places the data lives; and the AI writes a comprehensive summary that is not
-- biased towards making the student look positive or negative — a logical, rational, structured analysis the counsellors
-- can talk about.
--
-- The AI summary is the existing profile analyser (0085, 0173): generated on the server (/api/vsat/profile), saved on the
-- counselling record, same access and limits. This migration adds the page's data:
--   1. vsat__profile_fields(app)   private: the sheet's fields for one student (the list 0173's vsat_profile_start built
--                                  inline, moved here unchanged so the page and the AI read the same fields).
--   2. vsat_profile_start          0173 body, md5 checked; the inline field list is replaced by a call to (1). Nothing else
--                                  changes (access, NEEDS_COUNSELLOR, limits, run log, result).
--   3. vsat_profile_lookup(p)      the VSAT list, and the students of one VSAT matching an application ID / number or name
--                                  (25 at most). Admin / admissions see their campus; a counsellor sees only the students
--                                  assigned to them. Nothing else about a student is returned here.
--   4. vsat_profile_get(p)         one student: name, application no, campus, VSAT, stage, the fields of (1) and the saved AI
--                                  summary. Same access as the analyser. A student not in the picked VSAT → WRONG_VSAT.
-- No table changes. The prompt's tone (sir: neither positive nor negative) is in src/lib/vsat/profile-prompt.ts.
--
-- Security: (3) and (4) SECURITY DEFINER, search_path '', unknown request keys refused, revoked from public / anon, granted to
-- authenticated, access checked inside per student; (1) closed to browsers. Unknown or hidden students → FORBIDDEN, no hint.
-- Rollback: supabase/rollback/0191_vsat_profile_analysis_down.sql
-- Tests:    supabase/tests/vsat_profile_analysis.test.sql (+ vsat_profile_analyser.test.sql unchanged)

-- ═════════════ 1. the sheet's fields for one student (private) ═════════════

create or replace function public.vsat__profile_fields(p_app text)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare
  vp public.vsat_pipeline; am public.application_manager; ia public.interview_assignments; ca public.counselling_assignments;
  f jsonb; iv_name text; vsat_pct numeric;
begin
  select * into vp from public.vsat_pipeline where application_id = p_app;
  select * into am from public.application_manager where application_id = p_app;
  select * into ca from public.counselling_assignments c
   where c.application_id = p_app and c.attempt_no = vp.attempt_no order by c.created_at desc limit 1;
  select * into ia from public.interview_assignments a
   where a.application_id = p_app and a.attempt_no = vp.attempt_no order by a.created_at desc limit 1;
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
  return f;
end $$;
revoke all on function public.vsat__profile_fields(text) from public, anon, authenticated;

-- ═════════════ 2. vsat_profile_start: 0173 body, the field list read from (1) ═════════════

create or replace function public.vsat_profile_start(p_application_id text)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  vp public.vsat_pipeline; am public.application_manager; ca public.counselling_assignments;
  v_campus text; run uuid; f jsonb;
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

  -- 0191: the sheet's fields, the same list the Profile Analysis page shows
  f := public.vsat__profile_fields(p_application_id);

  insert into public.vsat_profile_runs (application_id, attempt_no, user_id) values (p_application_id, vp.attempt_no, auth.uid())
  returning id into run;
  return jsonb_build_object('run_id', run, 'fields', f);
end $$;
revoke all on function public.vsat_profile_start(text) from public, anon;
grant execute on function public.vsat_profile_start(text) to authenticated;

-- ═════════════ 3. vsat_profile_lookup: the VSATs, and the students of one VSAT ═════════════
-- p: {exam_date_id?, q?}. Without exam_date_id: only the VSAT list.

create or replace function public.vsat_profile_lookup(p jsonb)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare v_date uuid; v_q text; v_like text; rows jsonb; n int;
begin
  if auth.uid() is null then raise exception 'NOT_SIGNED_IN' using errcode = '42501'; end if;
  perform public.vsat__check_keys(p, array['exam_date_id', 'q']);
  if not (coalesce(public.is_admin(), false) or exists (select 1 from public.vsat_team t
           where t.user_id = auth.uid() and t.active and t.role in ('admissions', 'counsellor'))) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p ? 'exam_date_id' and jsonb_typeof(p->'exam_date_id') <> 'null' then
    if jsonb_typeof(p->'exam_date_id') <> 'string' or (p->>'exam_date_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'BAD_VALUE: exam_date_id' using errcode = '22023';
    end if;
    v_date := (p->>'exam_date_id')::uuid;
  end if;
  if p ? 'q' and jsonb_typeof(p->'q') <> 'null' then
    if jsonb_typeof(p->'q') <> 'string' or char_length(p->>'q') > 80 then raise exception 'BAD_VALUE: q' using errcode = '22023'; end if;
    v_q := nullif(btrim(p->>'q'), '');
  end if;
  -- the search words are matched as text, never as a pattern
  v_like := '%' || replace(replace(replace(coalesce(v_q, ''), '\', '\\'), '%', '\%'), '_', '\_') || '%';

  if v_date is not null then
    with s as (
      select am.application_id, am.application_no, am.registered_name, public.vsat__campus_key(am.campus_applied) as campus,
             vp.stage, vp.status
        from public.vsat_pipeline vp
        join public.application_manager am on am.application_id = vp.application_id
       where am.exam_date_id = v_date
         and (v_q is null or am.application_id ilike v_like or coalesce(am.application_no, '') ilike v_like
              or coalesce(am.registered_name, '') ilike v_like)
         and (public.vsat__can_manage(public.vsat__campus_key(am.campus_applied))
              or public.vsat__is_assigned('counsellor', am.application_id, vp.attempt_no)))
    select (select count(*) from s),
           coalesce((select jsonb_agg(jsonb_build_object('application_id', x.application_id, 'application_no', x.application_no,
                       'name', x.registered_name, 'campus', x.campus, 'stage', x.stage, 'status', x.status)
                       order by x.registered_name nulls last, x.application_id)
                       from (select * from s order by registered_name nulls last, application_id limit 25) x), '[]'::jsonb)
      into n, rows;
  end if;

  return jsonb_build_object(
    'vsats', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'label', d.label, 'exam_date', d.exam_date)
                                        order by d.exam_date desc nulls last, d.label)
                         from public.vsat_exam_dates d), '[]'::jsonb),
    'students', coalesce(rows, '[]'::jsonb),
    'total', coalesce(n, 0));
end $$;
revoke all on function public.vsat_profile_lookup(jsonb) from public, anon;
grant execute on function public.vsat_profile_lookup(jsonb) to authenticated;

-- ═════════════ 4. vsat_profile_get: one student's profile ═════════════
-- p: {application_id, exam_date_id?}

create or replace function public.vsat_profile_get(p jsonb)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare
  v_app text; v_date uuid; vp public.vsat_pipeline; am public.application_manager; ca public.counselling_assignments;
  v_campus text; d public.vsat_exam_dates;
begin
  if auth.uid() is null then raise exception 'NOT_SIGNED_IN' using errcode = '42501'; end if;
  perform public.vsat__check_keys(p, array['application_id', 'exam_date_id']);
  if jsonb_typeof(p->'application_id') is distinct from 'string' or char_length(p->>'application_id') not between 1 and 64 then
    raise exception 'BAD_VALUE: application_id' using errcode = '22023';
  end if;
  v_app := btrim(p->>'application_id');
  if p ? 'exam_date_id' and jsonb_typeof(p->'exam_date_id') <> 'null' then
    if jsonb_typeof(p->'exam_date_id') <> 'string' or (p->>'exam_date_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'BAD_VALUE: exam_date_id' using errcode = '22023';
    end if;
    v_date := (p->>'exam_date_id')::uuid;
  end if;

  select * into vp from public.vsat_pipeline where application_id = v_app;
  if not found then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  select * into am from public.application_manager where application_id = v_app;
  v_campus := public.vsat__campus_key(am.campus_applied);
  if not public.vsat__can_manage(v_campus) and not public.vsat__is_assigned('counsellor', v_app, vp.attempt_no) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if v_date is not null and am.exam_date_id is distinct from v_date then raise exception 'WRONG_VSAT' using errcode = '22023'; end if;

  select * into d from public.vsat_exam_dates where id = am.exam_date_id;
  select * into ca from public.counselling_assignments c
   where c.application_id = v_app and c.attempt_no = vp.attempt_no order by c.created_at desc limit 1;

  return jsonb_build_object(
    'application_id', am.application_id,
    'application_no', am.application_no,
    'name', am.registered_name,
    'campus', v_campus,
    'vsat', case when d.id is null then null else jsonb_build_object('id', d.id, 'label', d.label, 'exam_date', d.exam_date) end,
    'stage', vp.stage,
    'status', vp.status,
    'fields', public.vsat__profile_fields(v_app),
    'has_counselling', ca.id is not null,
    'analysis', case when ca.profile_analysis ? 'text'
                     then jsonb_build_object('text', ca.profile_analysis->>'text', 'generated_at', ca.profile_analysis->>'generated_at',
                                             'model', ca.profile_analysis->>'model')
                end);
end $$;
revoke all on function public.vsat_profile_get(jsonb) from public, anon;
grant execute on function public.vsat_profile_get(jsonb) to authenticated;

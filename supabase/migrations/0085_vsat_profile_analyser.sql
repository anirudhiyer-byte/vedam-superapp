-- 0085 · VSAT pipeline — profile analyser (step 6 of the build plan)
--
-- Replaces the "Profile Analyzer" tabs of the VSAT Student Details sheet, where a gen() formula sends
-- 48 fields of one chosen student to an AI and writes a counsellor briefing. In Vedam One it is a
-- "Generate profile" button on the counselling record.
--
-- Flow (the AI call itself happens in the server route /api/vsat/profile, never in the browser):
--   1. vsat_profile_start(application_id)  — called AS THE USER. Checks the user may counsel this
--      student (admin / admissions for the campus, or the assigned counsellor), that a counselling
--      record exists, a per-user limit (30 an hour) and that no run for the same student is already
--      going. Logs a run and returns the run id + the student fields (label, value) for the prompt.
--   2. the route sends the fixed prompt + fields to the AI service with the server's key.
--   3. vsat_profile_save(run_id, text, model) / vsat_profile_fail(run_id, code) — SERVICE ROLE ONLY,
--      so the saved briefing can only ever be what the AI returned, not text typed into the API.
--      The briefing is saved in the existing counselling_assignments.profile_analysis (jsonb, empty
--      until now) as {text, model, generated_at, generated_by (the run's user)}.
--
-- Security: vsat_profile_runs has RLS on, no policies, no browser grants. start is SECURITY DEFINER,
-- search_path '', authenticated only. save / fail are service_role only. Only the selected
-- student's fields leave the database, only for staff who may counsel that student.
-- Rollback: supabase/rollback/0085_vsat_profile_analyser_down.sql.

create table if not exists public.vsat_profile_runs (
  id             uuid primary key default gen_random_uuid(),
  application_id text not null references public.application_manager (application_id) on delete cascade,
  attempt_no     int not null,
  user_id        uuid not null references auth.users (id) on delete cascade,
  status         text not null default 'started' check (status in ('started', 'done', 'failed')),
  error_code     text check (char_length(error_code) <= 40),
  model          text check (char_length(model) <= 80),
  created_at     timestamptz not null default now(),
  finished_at    timestamptz
);
create index if not exists vsat_profile_runs_user_time on public.vsat_profile_runs (user_id, created_at desc);
create index if not exists vsat_profile_runs_app_time on public.vsat_profile_runs (application_id, created_at desc);
alter table public.vsat_profile_runs enable row level security;
revoke all on table public.vsat_profile_runs from public, anon, authenticated;

-- 1 · start (as the user)
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
      (44, 'Final Verdict', coalesce(ia.interviewer_verdict, ia.result))
    ) x(n, label, val)
   where x.val is not null and btrim(x.val) <> '';

  insert into public.vsat_profile_runs (application_id, attempt_no, user_id) values (p_application_id, vp.attempt_no, auth.uid())
  returning id into run;
  return jsonb_build_object('run_id', run, 'fields', f);
end $$;
revoke all on function public.vsat_profile_start(text) from public, anon;
grant execute on function public.vsat_profile_start(text) to authenticated;

-- 2 · save (service role only: the text can only come from the server route)
create or replace function public.vsat_profile_save(p_run_id uuid, p_text text, p_model text)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare r public.vsat_profile_runs; ca_id uuid;
begin
  select * into r from public.vsat_profile_runs where id = p_run_id for update;
  if not found then raise exception 'NO_RUN' using errcode = 'P0002'; end if;
  if r.status <> 'started' or r.created_at < now() - interval '10 minutes' then raise exception 'RUN_CLOSED' using errcode = '55000'; end if;
  if p_text is null or char_length(btrim(p_text)) = 0 or char_length(p_text) > 20000 then raise exception 'BAD_VALUE: text' using errcode = '22023'; end if;
  if p_model is not null and char_length(p_model) > 80 then raise exception 'BAD_VALUE: model' using errcode = '22023'; end if;
  select c.id into ca_id from public.counselling_assignments c
   where c.application_id = r.application_id and c.attempt_no = r.attempt_no order by c.created_at desc limit 1;
  if ca_id is null then raise exception 'NEEDS_COUNSELLOR' using errcode = '22023'; end if;
  update public.counselling_assignments c
     set profile_analysis = jsonb_build_object('text', btrim(p_text), 'model', p_model, 'generated_at', now(), 'generated_by', r.user_id)
   where c.id = ca_id;
  update public.vsat_profile_runs set status = 'done', model = p_model, finished_at = now() where id = r.id;
  return jsonb_build_object('generated_at', now(), 'model', p_model);
end $$;
revoke all on function public.vsat_profile_save(uuid, text, text) from public, anon, authenticated;
grant execute on function public.vsat_profile_save(uuid, text, text) to service_role;

-- 3 · fail (service role only)
create or replace function public.vsat_profile_fail(p_run_id uuid, p_code text)
returns void language plpgsql security definer set search_path to '' as $$
begin
  update public.vsat_profile_runs set status = 'failed', error_code = left(coalesce(p_code, 'ERROR'), 40), finished_at = now()
   where id = p_run_id and status = 'started';
end $$;
revoke all on function public.vsat_profile_fail(uuid, text) from public, anon, authenticated;
grant execute on function public.vsat_profile_fail(uuid, text) to service_role;

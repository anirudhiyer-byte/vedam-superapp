-- VSAT pipeline · profile analyser (migration 0085, STAGING ONLY)
--
-- How to run: paste this whole file into the staging SQL editor, or run it through the
-- Supabase MCP. The last statement returns one row per test: test | pass | detail.
-- Covers: who may start a run, the fields sent (no contact details), limits, that only the
-- server (service role) can save a briefing, run expiry, and table / function access.
-- The AI call itself is tested in src/app/api/vsat/profile/route.test.ts.
--
-- Nothing is left behind: test data is created inside a block that is rolled back with a private
-- error code at the end. Fake data only (@example.invalid, ZZTEST names).

create or replace function pg_temp.mk_user(p_email text)
returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, aud, role, email_confirmed_at, raw_user_meta_data)
  values (v, p_email, 'authenticated', 'authenticated', now(), '{}'::jsonb);
  insert into public.profiles (id, email, full_name) values (v, p_email, 'ZZTEST ' || split_part(p_email, '@', 1))
  on conflict (id) do update set email = excluded.email, full_name = excluded.full_name;
  return v;
end $$;

-- applicant at "vsat_cleared", Pune, VSAT p_marks/50 (25 → 50% → category 6, steps 30/35; 40 → 80% → category 5, steps 35/45)
create or replace function pg_temp.mk_app(p_id text, p_date uuid, p_marks numeric)
returns text language plpgsql as $$
declare u uuid := pg_temp.mk_user(lower(p_id) || '@example.invalid');
begin
  insert into public.lead_manager (lead_id, registered_name, registered_email, lead_stage) values (u, 'ZZTEST ' || p_id, lower(p_id) || '@example.invalid', 'applicant_paid')
  on conflict (lead_id) do nothing;
  insert into public.application_manager (application_id, lead_id, application_no, registered_name, registered_email, campus_applied, exam_date_id,
    class10_year, class10_percentage, class10_maths_percentage, class12_year, class12_percentage, class12_maths_percentage,
    marks_physics_12, marks_chemistry_12, marks_maths_12, jee_registered, entrance_percentile, jee_main_maths_percentile,
    exam_percentile, exam_obtained_marks, exam_max_marks, vps_score)
  values (p_id, u, p_id, 'ZZTEST ' || p_id, lower(p_id) || '@example.invalid', 'Ajeenkya DY Patil University — Pune', p_date,
    2024, 90, 85, 2026, 80, 70, 70, 70, 70, false, null, null, 80, p_marks, 50, 8.43);
  update public.application_manager set exam_given = true where application_id = p_id;
  perform public.vsat__move(p_id, 'vsat_cleared', 'active', 'zz test', 'system', null, null);
  return p_id;
end $$;

create or replace function pg_temp.call_as(p_uid uuid, p_sql text, p_anon boolean default false)
returns jsonb language plpgsql as $$
declare r jsonb;
begin
  if p_anon then
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    set local role anon;
  else
    perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
    set local role authenticated;
  end if;
  execute p_sql into r;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return coalesce(r, 'null'::jsonb);
exception when others then
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return jsonb_build_object('sqlstate', sqlstate, 'message', sqlerrm);
end $$;

create or replace function pg_temp.rpc(p_fn text, p jsonb)
returns text language sql as $$ select format('select public.%I(%L::jsonb)', p_fn, p::text) $$;

-- interview (given achievements score) → pi_cleared → counselling_scheduled
create or replace function pg_temp.to_counselling(p_app text, p_ach int, p_n int, p_adm uuid, p_int uuid, p_cou uuid)
returns jsonb language plpgsql as $$
declare r jsonb; slot text := to_char(now() + make_interval(days => 10 + p_n), 'YYYY-MM-DD"T"HH24:00:00"Z"');
begin
  r := pg_temp.call_as(p_adm, pg_temp.rpc('vsat_assign_interview', jsonb_build_object('application_id', p_app, 'interviewer_id', p_int, 'slot_datetime', slot)));
  r := pg_temp.call_as(p_int, pg_temp.rpc('vsat_submit_interview', jsonb_build_object('application_id', p_app, 'communication', 4, 'logic', 4,
         'passion', 3, 'achievements', p_ach, 'why_program', 4, 'cheating_seen', false, 'interviewer_verdict', 'selected')));
  if r->>'stage' is distinct from 'pi_cleared' then return r; end if;
  return pg_temp.call_as(p_adm, pg_temp.rpc('vsat_assign_counsellor', jsonb_build_object('application_id', p_app, 'counsellor_id', p_cou, 'slot_datetime', slot)));
end $$;

create or replace function pg_temp.call_svc(p_sql text)
returns jsonb language plpgsql as $$
declare r jsonb;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  set local role service_role;
  execute p_sql into r;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return coalesce(r, 'null'::jsonb);
exception when others then
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return jsonb_build_object('sqlstate', sqlstate, 'message', sqlerrm);
end $$;

create or replace function pg_temp.run_vsat_profile_tests()
returns table (test text, pass boolean, detail text) language plpgsql as $$
declare
  t_name text[] := '{}'; t_pass boolean[] := '{}'; t_det text[] := '{}';
  adm uuid; int1 uuid; cou1 uuid; cou2 uuid; usr uuid; d uuid; b1 text; b2 text; b3 text;
  r jsonb; run uuid; s text; n int;
begin
  begin -- rolled back at the end (ZDONE)
    adm  := pg_temp.mk_user('zztest-pro-adm@example.invalid');
    int1 := pg_temp.mk_user('zztest-pro-int1@example.invalid');
    cou1 := pg_temp.mk_user('zztest-pro-cou1@example.invalid');
    cou2 := pg_temp.mk_user('zztest-pro-cou2@example.invalid');
    usr  := pg_temp.mk_user('zztest-pro-user@example.invalid');
    insert into public.vsat_team (user_id, role) values (adm, 'admissions'), (int1, 'interviewer'), (cou1, 'counsellor'), (cou2, 'counsellor');
    insert into public.vsat_exam_dates (label, wheebox_test_id, exam_date, start_at, end_at)
    values ('ZZTEST profile batch', 'zz-pro', current_date, now(), now() + interval '2 hours') returning id into d;
    b1 := pg_temp.mk_app('ZZT-PRO-1', d, 30::numeric);
    b2 := pg_temp.mk_app('ZZT-PRO-2', d, 30::numeric);
    b3 := pg_temp.mk_app('ZZT-PRO-3', d, 30::numeric);
    r := pg_temp.to_counselling(b1, 4, 1, adm, int1, cou1);
    r := pg_temp.to_counselling(b3, 4, 3, adm, int1, cou1);
    -- b2: interview only (PI cleared, no counsellor yet)
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_assign_interview', jsonb_build_object('application_id', b2, 'interviewer_id', int1,
           'slot_datetime', to_char(now() + interval '12 days', 'YYYY-MM-DD"T"HH24:00:00"Z"'))));
    r := pg_temp.call_as(int1, pg_temp.rpc('vsat_submit_interview', jsonb_build_object('application_id', b2, 'communication', 4, 'logic', 4,
           'passion', 3, 'achievements', 4, 'why_program', 4, 'cheating_seen', false, 'interviewer_verdict', 'selected')));
    t_name := t_name || text 'setup: b1, b3 counselling_scheduled; b2 pi_cleared';
    select string_agg(vp.stage, ',' order by vp.application_id) into s from public.vsat_pipeline vp where vp.application_id in (b1, b2, b3);
    t_det := t_det || s; t_pass := t_pass || (s = 'counselling_scheduled,pi_cleared,counselling_scheduled');

    -- ── A. start, as the assigned counsellor ──
    r := pg_temp.call_as(cou1, format('select public.vsat_profile_start(%L)', b1));
    run := (r->>'run_id')::uuid;
    t_name := t_name || text 'A assigned counsellor starts a run: run id + fields'; t_det := t_det || left(r::text, 300);
    t_pass := t_pass || (run is not null and jsonb_array_length(r->'fields') >= 20);
    t_name := t_name || text 'A fields carry scores and interview parts, labels with their scales';
    select string_agg(e->>0 || '=' || (e->>1), '; ') into s from jsonb_array_elements(r->'fields') e
     where e->>0 in ('VPS (out of 10)', 'Interview Score (out of 5)', 'Achievements & Extracurricular Activities (out of 5)', 'Final Verdict');
    t_det := t_det || s;
    t_pass := t_pass || (s like '%VPS (out of 10)=8.43%' and s like '%Achievements & Extracurricular Activities (out of 5)=4%' and s like '%Final Verdict=selected%');
    t_name := t_name || text 'A no email or phone in the fields; empty fields are left out';
    t_det := t_det || (r->'fields')::text;
    t_pass := t_pass || (position('@example.invalid' in (r->'fields')::text) = 0
                         and not exists (select 1 from jsonb_array_elements(r->'fields') e where btrim(e->>1) = ''));
    t_name := t_name || text 'A run logged as started, for this user and student';
    select format('%s|%s|%s', pr.status, pr.user_id = cou1, pr.application_id = b1) into s from public.vsat_profile_runs pr where pr.id = run;
    t_det := t_det || s; t_pass := t_pass || (s = 'started|t|t');

    -- ── B. who may not ──
    r := pg_temp.call_as(int1, format('select public.vsat_profile_start(%L)', b3));
    t_name := t_name || text 'B the interviewer cannot start'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'FORBIDDEN');
    r := pg_temp.call_as(cou2, format('select public.vsat_profile_start(%L)', b3));
    t_name := t_name || text 'B another counsellor cannot start'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'FORBIDDEN');
    r := pg_temp.call_as(usr, format('select public.vsat_profile_start(%L)', b3));
    t_name := t_name || text 'B a non-staff user cannot start'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'FORBIDDEN');
    r := pg_temp.call_as(null, format('select public.vsat_profile_start(%L)', b3), true);
    t_name := t_name || text 'B anon cannot call it at all'; t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = '42501');
    r := pg_temp.call_as(cou1, format('select public.vsat_profile_start(%L)', 'NOT-A-STUDENT'));
    t_name := t_name || text 'B unknown student → FORBIDDEN (no hint that it exists or not)'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'FORBIDDEN');
    t_name := t_name || text 'B refused calls logged no run';
    select count(*) into n from public.vsat_profile_runs pr where pr.application_id = b3; t_det := t_det || n::text; t_pass := t_pass || (n = 0);

    -- ── C. stage / limits ──
    r := pg_temp.call_as(adm, format('select public.vsat_profile_start(%L)', b2));
    t_name := t_name || text 'C no counselling record yet → NEEDS_COUNSELLOR'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'NEEDS_COUNSELLOR');
    r := pg_temp.call_as(adm, format('select public.vsat_profile_start(%L)', b1));
    t_name := t_name || text 'C second run for the same student within 2 minutes → IN_PROGRESS'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'IN_PROGRESS');
    insert into public.vsat_profile_runs (application_id, attempt_no, user_id, status, created_at)
      select b3, 1, adm, 'done', now() - interval '5 minutes' from generate_series(1, 30);
    r := pg_temp.call_as(adm, format('select public.vsat_profile_start(%L)', b3));
    t_name := t_name || text 'C 30 runs in the last hour → RATE_LIMITED'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'RATE_LIMITED');
    update public.vsat_profile_runs set created_at = now() - interval '2 hours' where user_id = adm;
    r := pg_temp.call_as(adm, format('select public.vsat_profile_start(%L)', b3));
    t_name := t_name || text 'C older runs do not count; admissions may start'; t_det := t_det || left(r::text, 120); t_pass := t_pass || (r ? 'run_id');

    -- ── D. save: service role only ──
    r := pg_temp.call_as(cou1, format('select public.vsat_profile_save(%L, %L, %L)', run, 'typed by hand', 'x'));
    t_name := t_name || text 'D a signed-in user cannot save text (server only)'; t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = '42501');
    r := pg_temp.call_as(cou1, format('select public.vsat_profile_fail(%L, %L)', run, 'x'));
    t_name := t_name || text 'D a signed-in user cannot call fail either'; t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = '42501');
    r := pg_temp.call_svc(format('select public.vsat_profile_save(%L, %L, %L)', run, '   ', 'm'));
    t_name := t_name || text 'D empty text refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'BAD_VALUE: text');
    r := pg_temp.call_svc(format('select public.vsat_profile_save(%L, %L, %L)', run, '• **Fit for Vedam** – moderate', 'claude-sonnet-5-5'));
    t_name := t_name || text 'D server saves the briefing'; t_det := t_det || r::text; t_pass := t_pass || (r->>'model' = 'claude-sonnet-5-5');
    t_name := t_name || text 'D saved on the counselling record with who (the run user), when, model; run done';
    select format('%s|%s|%s|%s|%s', ca.profile_analysis, ca.profile_generated_by = cou1, ca.profile_generated_at is not null, ca.profile_model,
                  (select pr.status from public.vsat_profile_runs pr where pr.id = run))
      into s from public.counselling_assignments ca where ca.application_id = b1;
    t_det := t_det || s; t_pass := t_pass || (s = '• **Fit for Vedam** – moderate|t|t|claude-sonnet-5-5|done');
    r := pg_temp.call_svc(format('select public.vsat_profile_save(%L, %L, %L)', run, 'again', 'm'));
    t_name := t_name || text 'D a run can be saved only once'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'RUN_CLOSED');
    r := pg_temp.call_svc(format('select public.vsat_profile_save(%L, %L, %L)', gen_random_uuid(), 'x', 'm'));
    t_name := t_name || text 'D unknown run refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'NO_RUN');
    r := pg_temp.call_as(cou1, format('select public.vsat_student(%L)', b1));
    t_name := t_name || text 'D the student page shows the saved briefing'; t_det := t_det || left((r->'counselling')::text, 200);
    t_pass := t_pass || (r->'counselling'->>'profile_analysis' = '• **Fit for Vedam** – moderate');

    -- ── E. fail / expiry ──
    r := pg_temp.call_as(cou1, format('select public.vsat_profile_start(%L)', b3));
    run := (r->>'run_id')::uuid;
    r := pg_temp.call_svc(format('select public.vsat_profile_fail(%L, %L)', run, 'AI_ERROR'));
    t_name := t_name || text 'E fail closes the run with its code'; select format('%s|%s', pr.status, pr.error_code) into s from public.vsat_profile_runs pr where pr.id = run;
    t_det := t_det || s; t_pass := t_pass || (s = 'failed|AI_ERROR');
    r := pg_temp.call_svc(format('select public.vsat_profile_save(%L, %L, %L)', run, 'late', 'm'));
    t_name := t_name || text 'E a failed run cannot be saved'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'RUN_CLOSED');
    r := pg_temp.call_as(cou1, format('select public.vsat_profile_start(%L)', b3));
    run := (r->>'run_id')::uuid;
    update public.vsat_profile_runs set created_at = now() - interval '11 minutes' where id = run;
    r := pg_temp.call_svc(format('select public.vsat_profile_save(%L, %L, %L)', run, 'late', 'm'));
    t_name := t_name || text 'E a run older than 10 minutes cannot be saved'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'RUN_CLOSED');

    -- ── F. access to the table and functions ──
    r := pg_temp.call_as(cou1, 'select to_jsonb(count(*)) from public.vsat_profile_runs');
    t_name := t_name || text 'F browsers cannot read the run log'; t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = '42501');
    t_name := t_name || text 'F start: authenticated only; save / fail: service_role only; all SECURITY DEFINER, empty search_path';
    select string_agg(format('%s:%s:%s:%s:%s:%s', p.proname, has_function_privilege('authenticated', p.oid, 'execute'), has_function_privilege('anon', p.oid, 'execute'),
                             has_function_privilege('service_role', p.oid, 'execute'), p.prosecdef, p.proconfig), ' ' order by p.proname)
      into s from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname in ('vsat_profile_start', 'vsat_profile_save', 'vsat_profile_fail');
    t_det := t_det || s;
    t_pass := t_pass || (s = 'vsat_profile_fail:f:f:t:t:{"search_path=\"\""} vsat_profile_save:f:f:t:t:{"search_path=\"\""} vsat_profile_start:t:f:t:t:{"search_path=\"\""}');
    t_name := t_name || text 'F run log: RLS on, no policies';
    select format('%s|%s', c.relrowsecurity, (select count(*) from pg_policies pp where pp.schemaname = 'public' and pp.tablename = 'vsat_profile_runs'))
      into s from pg_class c where c.oid = 'public.vsat_profile_runs'::regclass;
    t_det := t_det || s; t_pass := t_pass || (s = 't|0');

    raise exception 'done' using errcode = 'ZDONE';
  exception when sqlstate 'ZDONE' then null;
  end;
  return query select * from unnest(t_name, t_pass, t_det);
end $$;

select * from pg_temp.run_vsat_profile_tests();

-- VSAT · stages are changed by hand after the exam booking; Status = Done / No-show / Rescheduled — tests for 0164
-- (STAGING ONLY)
--
-- How to run: paste this whole file into the staging SQL editor, or run it through the Supabase MCP.
-- The last statement returns one row per test: test | pass | detail.
--
-- Nothing is left behind: all test data is created inside a block that is rolled back with a private error code at
-- the end. Fake data only (@example.invalid, ZZTEST names).

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

-- applicant moved (as the system) along the pipeline up to p_stage
create or replace function pg_temp.mk_app(p_id text, p_stage text)
returns text language plpgsql as $$
declare u uuid := pg_temp.mk_user(lower(p_id) || '@example.invalid'); s text;
begin
  insert into public.lead_manager (lead_id, registered_name, registered_email, lead_stage) values (u, 'ZZTEST ' || p_id, lower(p_id) || '@example.invalid', 'applicant_paid')
  on conflict (lead_id) do nothing;
  insert into public.application_manager (application_id, lead_id, application_no, registered_name, registered_email, campus_applied)
  values (p_id, u, p_id, 'ZZTEST ' || p_id, lower(p_id) || '@example.invalid', 'Ajeenkya DY Patil University — Pune');
  foreach s in array array['vsat_cleared', 'interview_scheduled', 'interviewed', 'pi_cleared', 'counselling_scheduled'] loop
    perform public.vsat__move(p_id, s, 'active', 'zz test', 'system', null, null);
    exit when s = p_stage;
  end loop;
  return p_id;
end $$;

create or replace function pg_temp.call_as(p_uid uuid, p_sql text, p_role text default 'authenticated')
returns jsonb language plpgsql as $$
declare r jsonb;
begin
  if p_role = 'anon' then
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
returns text language sql as $$ select format('select to_jsonb(public.%I(%L::jsonb))', p_fn, p::text) $$;

create or replace function pg_temp.st(p_app text)
returns text language sql as $$ select vp.stage || '/' || vp.status from public.vsat_pipeline vp where vp.application_id = p_app $$;

create or replace function pg_temp.run_vsat_manual_stages_tests()
returns table (test text, pass boolean, detail text) language plpgsql as $$
declare
  t_name text[] := '{}'; t_pass boolean[] := '{}'; t_det text[] := '{}';
  adm uuid; i1 uuid; i2 uuid; c1 uuid; nobody uuid;
  a1 text; a2 text; a3 text; a4 text; a5 text; a6 text; b0 text; k1 text; k2 text;
  r jsonb; s text; ia public.interview_assignments; many jsonb;
  form jsonb := '{"communication": 4, "logic": 3, "passion": 3, "achievements": 2, "why_program": 4, "cheating_seen": false}';
begin
  begin -- rolled back at the end (ZDONE)
    adm := pg_temp.mk_user('zztest-ms-adm@example.invalid');
    i1 := pg_temp.mk_user('zztest-ms-int1@example.invalid');
    i2 := pg_temp.mk_user('zztest-ms-int2@example.invalid');
    c1 := pg_temp.mk_user('zztest-ms-couns1@example.invalid');
    nobody := pg_temp.mk_user('zztest-ms-nobody@example.invalid');
    insert into public.vsat_team (user_id, role, campus) values (adm, 'admissions', null), (i1, 'interviewer', null), (i2, 'interviewer', null), (c1, 'counsellor', null);
    a1 := pg_temp.mk_app('ZZT-MS-1', 'vsat_cleared');
    a2 := pg_temp.mk_app('ZZT-MS-2', 'vsat_cleared');
    a3 := pg_temp.mk_app('ZZT-MS-3', 'vsat_cleared');
    a4 := pg_temp.mk_app('ZZT-MS-4', 'vsat_cleared');
    a5 := pg_temp.mk_app('ZZT-MS-5', 'vsat_cleared');
    a6 := pg_temp.mk_app('ZZT-MS-6', 'interview_scheduled');
    k1 := pg_temp.mk_app('ZZT-MS-K1', 'pi_cleared');
    k2 := pg_temp.mk_app('ZZT-MS-K2', 'pi_cleared');
    -- a student still at the exam step (left where the application trigger puts them)
    b0 := 'ZZT-MS-B0';
    s := pg_temp.mk_user('zzt-ms-b0@example.invalid')::text;
    insert into public.lead_manager (lead_id, registered_name, registered_email, lead_stage) values (s::uuid, 'ZZTEST B0', 'zzt-ms-b0@example.invalid', 'applicant_paid');
    insert into public.application_manager (application_id, lead_id, application_no, registered_name, registered_email, campus_applied)
    values (b0, s::uuid, b0, 'ZZTEST B0', 'zzt-ms-b0@example.invalid', 'Ajeenkya DY Patil University — Pune');

    -- ════ B. booking, rescheduling and cancelling never move the stage ════
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_assign_interview', jsonb_build_object('application_id', a1, 'interviewer_id', i1,
           'slot_datetime', now() + interval '3 days', 'duration_min', 30, 'auto_meet', true)));
    t_name := t_name || text 'B booking an interview keeps the stage (VSAT cleared)';
    t_det := t_det || format('%s | %s', pg_temp.st(a1), left(coalesce(r->>'message', 'ok'), 80));
    t_pass := t_pass || (pg_temp.st(a1) = 'vsat_cleared/active' and not (r ? 'sqlstate')
                         and exists (select 1 from public.interview_assignments x where x.application_id = a1 and x.interviewer_id = i1));

    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_assign_interview', jsonb_build_object('application_id', a1, 'interviewer_id', i1,
           'slot_datetime', now() + interval '4 days', 'duration_min', 30, 'auto_meet', true)));
    select * into ia from public.interview_assignments x where x.application_id = a1;
    t_name := t_name || text 'B rescheduling keeps the stage and counts the reschedule';
    t_det := t_det || format('%s count=%s | %s', pg_temp.st(a1), ia.reschedule_count, left(coalesce(r->>'message', 'ok'), 80));
    t_pass := t_pass || (pg_temp.st(a1) = 'vsat_cleared/active' and ia.reschedule_count = 1);

    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_set_attendance_bulk', jsonb_build_object('track', 'interview', 'application_ids', jsonb_build_array(a1), 'attendance', 'rescheduled')));
    select * into ia from public.interview_assignments x where x.application_id = a1;
    t_name := t_name || text 'S "Rescheduled" can be set before the slot, stage unchanged';
    t_det := t_det || format('%s att=%s %s', pg_temp.st(a1), ia.attendance, r);
    t_pass := t_pass || (ia.attendance = 'rescheduled' and pg_temp.st(a1) = 'vsat_cleared/active' and r->'updated' = jsonb_build_array(a1));

    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_set_attendance_bulk', jsonb_build_object('track', 'interview', 'application_ids', jsonb_build_array(a1), 'attendance', 'no_show')));
    t_name := t_name || text 'S Done / No-show wait for the slot to start (TOO_EARLY, row skipped)';
    t_det := t_det || (r::text);
    t_pass := t_pass || (r->'skipped'->0->>'code' = 'TOO_EARLY' and jsonb_array_length(r->'updated') = 0);

    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_cancel_interview', jsonb_build_object('application_id', a1, 'reason', 'zz test cancel')));
    t_name := t_name || text 'B cancelling keeps the stage (no move back)';
    t_det := t_det || format('%s | %s', pg_temp.st(a1), left(coalesce(r->>'message', 'ok'), 80));
    t_pass := t_pass || (pg_temp.st(a1) = 'vsat_cleared/active'
                         and exists (select 1 from public.interview_assignments x where x.application_id = a1 and x.cancelled_at is not null));

    -- ════ S. the status, set by hand ════
    perform pg_temp.call_as(adm, pg_temp.rpc('vsat_assign_interview', jsonb_build_object('application_id', a2, 'interviewer_id', i1,
           'slot_datetime', now() + interval '5 days', 'duration_min', 30, 'auto_meet', true)));
    update public.interview_assignments x set slot_datetime = now() - interval '2 hours' where x.application_id = a2;
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_set_interview_attendance', jsonb_build_object('application_id', a2, 'attendance', 'no_show')));
    select * into ia from public.interview_assignments x where x.application_id = a2;
    t_name := t_name || text 'S No-show by hand: status column only, stage and pipeline status unchanged';
    t_det := t_det || format('%s att=%s | %s', pg_temp.st(a2), ia.attendance, left(coalesce(r->>'message', 'ok'), 80));
    t_pass := t_pass || (ia.attendance = 'no_show' and pg_temp.st(a2) = 'vsat_cleared/active');

    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_set_interview_attendance', jsonb_build_object('application_id', a2, 'attendance', 'done')));
    s := r->>'message';
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_set_interview_attendance', jsonb_build_object('application_id', a2, 'attendance', 'done', 'reason', 'zz joined late')));
    select * into ia from public.interview_assignments x where x.application_id = a2;
    t_name := t_name || text 'S changing a marked status needs a reason; then Done, stage unchanged';
    t_det := t_det || format('%s → %s att=%s', s, pg_temp.st(a2), ia.attendance);
    t_pass := t_pass || (s = 'REASON_REQUIRED' and ia.attendance = 'done' and pg_temp.st(a2) = 'vsat_cleared/active');

    -- Google Meet's automatic no-show
    perform pg_temp.call_as(adm, pg_temp.rpc('vsat_assign_interview', jsonb_build_object('application_id', a3, 'interviewer_id', i1,
           'slot_datetime', now() + interval '6 days', 'duration_min', 30, 'auto_meet', true)));
    update public.interview_assignments x set slot_datetime = now() - interval '3 hours' where x.application_id = a3;
    select * into ia from public.interview_assignments x where x.application_id = a3;
    r := public.vsat_interview_attendance_apply(jsonb_build_object('id', ia.id, 'version', ia.version, 'result', 'no_show',
           'detail', jsonb_build_object('people', 1, 'reason', 'one_joined')));
    select * into ia from public.interview_assignments x where x.application_id = a3;
    t_name := t_name || text 'S Meet''s automatic no-show sets the status only (stage and status unchanged)';
    t_det := t_det || format('%s att=%s src=%s %s', pg_temp.st(a3), ia.attendance, ia.attendance_source, r);
    t_pass := t_pass || (ia.attendance = 'no_show' and ia.attendance_source = 'auto' and pg_temp.st(a3) = 'vsat_cleared/active');

    -- ════ F. submitting the interview form ════
    perform pg_temp.call_as(adm, pg_temp.rpc('vsat_assign_interview', jsonb_build_object('application_id', a4, 'interviewer_id', i1,
           'slot_datetime', now() + interval '7 days', 'duration_min', 30, 'auto_meet', true)));
    -- checked before a4's real submit: a refused call saves nothing, and the form can be sent only once
    r := pg_temp.call_as(i1, pg_temp.rpc('vsat_submit_interview', form || jsonb_build_object('application_id', a4, 'interviewer_verdict', 'great')));
    t_name := t_name || text 'F an older client''s verdict must still be a known value';
    t_det := t_det || coalesce(r->>'message', 'not refused'); t_pass := t_pass || (r->>'message' = 'BAD_VALUE: interviewer_verdict');

    r := pg_temp.call_as(i1, pg_temp.rpc('vsat_submit_interview', form || jsonb_build_object('application_id', a4)));
    select * into ia from public.interview_assignments x where x.application_id = a4;
    t_name := t_name || text 'F the interviewer submits without a verdict; the form is saved, stage unchanged';
    t_det := t_det || format('%s submitted=%s verdict=%s score=%s | %s', pg_temp.st(a4), ia.submitted_at is not null, ia.interviewer_verdict, ia.weighted_avg, left(coalesce(r->>'message', 'ok'), 80));
    t_pass := t_pass || (ia.submitted_at is not null and ia.interviewer_verdict is null and ia.weighted_avg is not null and pg_temp.st(a4) = 'vsat_cleared/active');

    r := pg_temp.call_as(i1, pg_temp.rpc('vsat_submit_interview', form || jsonb_build_object('application_id', a4, 'communication', 1, 'logic', 1)));
    t_name := t_name || text 'F the form can be sent only once (ALREADY_INTERVIEWED), the saved scores stay';
    t_det := t_det || format('%s | rubric=%s/%s score=%s', coalesce(r->>'message', 'not refused'),
             (select x.rubric_behavioural from public.interview_assignments x where x.application_id = a4),
             (select x.rubric_math from public.interview_assignments x where x.application_id = a4), ia.weighted_avg);
    t_pass := t_pass || (r->>'message' = 'ALREADY_INTERVIEWED'
                         and (select x.rubric_behavioural = 4 and x.rubric_math = 3 and x.weighted_avg = ia.weighted_avg
                                from public.interview_assignments x where x.application_id = a4));

    perform pg_temp.call_as(adm, pg_temp.rpc('vsat_assign_interview', jsonb_build_object('application_id', a6, 'interviewer_id', i2,
           'slot_datetime', now() + interval '8 days', 'duration_min', 30, 'auto_meet', true)));
    r := pg_temp.call_as(i2, pg_temp.rpc('vsat_submit_interview', form || jsonb_build_object('application_id', a6, 'cheating_seen', true)));
    select * into ia from public.interview_assignments x where x.application_id = a6;
    t_name := t_name || text 'F cheating is recorded (result Not selected) but the stage and status stay';
    t_det := t_det || format('%s result=%s | %s', pg_temp.st(a6), ia.result, left(coalesce(r->>'message', 'ok'), 80));
    t_pass := t_pass || (ia.result = 'not_selected' and ia.cheating_seen and pg_temp.st(a6) = 'interview_scheduled/active');

    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_submit_interview', form || jsonb_build_object('application_id', b0)));
    t_name := t_name || text 'F a student still at the exam step can''t get an interview form (WRONG_STAGE)';
    t_det := t_det || coalesce(r->>'message', 'not refused'); t_pass := t_pass || (r->>'message' = 'WRONG_STAGE');

    -- ════ K. counselling ════
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_assign_counsellor', jsonb_build_object('application_id', k1, 'counsellor_id', c1,
           'slot_datetime', now() + interval '3 days', 'duration_min', 30, 'auto_meet', true)));
    t_name := t_name || text 'K booking counselling keeps the stage (PI cleared)';
    t_det := t_det || format('%s | %s', pg_temp.st(k1), left(coalesce(r->>'message', 'ok'), 80));
    t_pass := t_pass || (pg_temp.st(k1) = 'pi_cleared/active' and exists (select 1 from public.counselling_assignments x where x.application_id = k1));

    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_cancel_counselling', jsonb_build_object('application_id', k1, 'reason', 'zz test cancel')));
    t_name := t_name || text 'K cancelling counselling keeps the stage';
    t_det := t_det || format('%s | %s', pg_temp.st(k1), left(coalesce(r->>'message', 'ok'), 80));
    t_pass := t_pass || (pg_temp.st(k1) = 'pi_cleared/active');

    perform pg_temp.call_as(adm, pg_temp.rpc('vsat_assign_counsellor', jsonb_build_object('application_id', k2, 'counsellor_id', c1,
           'slot_datetime', now() + interval '4 days', 'duration_min', 30, 'auto_meet', true)));
    r := pg_temp.call_as(c1, pg_temp.rpc('vsat_submit_counselling', jsonb_build_object('application_id', k2, 'remarks', 'zz test')));
    t_name := t_name || text 'K submitting counselling saves it, stage unchanged (and the reply says the real stage)';
    t_det := t_det || format('%s reply_stage=%s | %s', pg_temp.st(k2), r->>'stage', left(coalesce(r->>'message', 'ok'), 120));
    t_pass := t_pass || (pg_temp.st(k2) = 'pi_cleared/active' and r->>'stage' = 'pi_cleared'
                         and exists (select 1 from public.counselling_assignments x where x.application_id = k2 and x.submitted_at is not null));

    r := pg_temp.call_as(c1, pg_temp.rpc('vsat_submit_counselling', jsonb_build_object('application_id', k2, 'remarks', 'zz changed')));
    t_name := t_name || text 'K counselling can be saved only once (ALREADY_COUNSELLED), the saved remarks stay';
    t_det := t_det || format('%s | remarks=%s', coalesce(r->>'message', 'not refused'),
             (select x.counsellor_remarks from public.counselling_assignments x where x.application_id = k2));
    t_pass := t_pass || (r->>'message' = 'ALREADY_COUNSELLED'
                         and (select x.counsellor_remarks from public.counselling_assignments x where x.application_id = k2) = 'zz test');

    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_set_attendance_bulk', jsonb_build_object('track', 'counselling', 'application_ids', jsonb_build_array(k1, k2), 'attendance', 'rescheduled')));
    t_name := t_name || text 'K bulk status: a cancelled booking and a submitted one are skipped with their reasons';
    t_det := t_det || (r::text);
    t_pass := t_pass || (jsonb_array_length(r->'updated') = 0 and r->'skipped' @> jsonb_build_array(jsonb_build_object('application_id', k1, 'code', 'NO_COUNSELLING'))
                         and r->'skipped' @> jsonb_build_array(jsonb_build_object('application_id', k2, 'code', 'WRONG_STAGE')));

    -- ════ M. several students at once ════
    perform pg_temp.call_as(adm, pg_temp.rpc('vsat_assign_interview', jsonb_build_object('application_id', a5, 'interviewer_id', i2,
           'slot_datetime', now() + interval '9 days', 'duration_min', 30, 'auto_meet', true)));
    update public.interview_assignments x set slot_datetime = now() - interval '1 hour' where x.application_id = a5;
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_set_attendance_bulk', jsonb_build_object('track', 'interview', 'application_ids', jsonb_build_array(a5, a5, 'ZZT-MS-NOPE'), 'attendance', 'done')));
    t_name := t_name || text 'M bulk: each row on its own (duplicates once; an unknown student skipped)';
    t_det := t_det || (r::text);
    t_pass := t_pass || (r->'updated' = jsonb_build_array(a5) and jsonb_array_length(r->'skipped') = 1 and r->'skipped'->0->>'application_id' = 'ZZT-MS-NOPE'
                         and (select x.attendance from public.interview_assignments x where x.application_id = a5) = 'done');

    r := pg_temp.call_as(i1, pg_temp.rpc('vsat_set_attendance_bulk', jsonb_build_object('track', 'interview', 'application_ids', jsonb_build_array(a5), 'attendance', 'no_show', 'reason', 'zz')));
    t_name := t_name || text 'M an interviewer can''t set the status of someone else''s student (skipped FORBIDDEN)';
    t_det := t_det || (r::text);
    t_pass := t_pass || (r->'skipped'->0->>'code' = 'FORBIDDEN' and (select x.attendance from public.interview_assignments x where x.application_id = a5) = 'done');

    select jsonb_agg('ZZT-X-' || g) into many from generate_series(1, 101) g;
    s := '';
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_set_attendance_bulk', jsonb_build_object('track', 'exam', 'application_ids', jsonb_build_array(a5), 'attendance', 'done'))); s := s || (r->>'message') || ' | ';
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_set_attendance_bulk', jsonb_build_object('track', 'interview', 'application_ids', '[]'::jsonb, 'attendance', 'done'))); s := s || (r->>'message') || ' | ';
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_set_attendance_bulk', jsonb_build_object('track', 'interview', 'application_ids', many, 'attendance', 'done'))); s := s || (r->>'message') || ' | ';
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_set_attendance_bulk', jsonb_build_object('track', 'interview', 'application_ids', jsonb_build_array(5), 'attendance', 'done'))); s := s || (r->>'message') || ' | ';
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_set_attendance_bulk', jsonb_build_object('track', 'interview', 'application_ids', jsonb_build_array(a5), 'attendance', 'joined'))); s := s || (r->>'message') || ' | ';
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_set_attendance_bulk', jsonb_build_object('track', 'interview', 'application_ids', jsonb_build_array(a5), 'attendance', 'done', 'stage', 'pi_cleared'))); s := s || (r->>'message');
    t_name := t_name || text 'M bad input is refused (track, empty, >100, not text, unknown status, unknown key)';
    t_det := t_det || s;
    t_pass := t_pass || (s = 'BAD_VALUE: track | BAD_VALUE: application_ids | BAD_VALUE: application_ids | BAD_VALUE: application_ids | BAD_VALUE: attendance | UNKNOWN_KEY: stage');

    r := pg_temp.call_as(null, pg_temp.rpc('vsat_set_attendance_bulk', jsonb_build_object('track', 'interview', 'application_ids', jsonb_build_array(a5), 'attendance', 'done')), 'anon');
    t_name := t_name || text 'M signed out → refused'; t_det := t_det || (r::text); t_pass := t_pass || (r ? 'sqlstate');
    r := pg_temp.call_as(nobody, pg_temp.rpc('vsat_set_attendance_bulk', jsonb_build_object('track', 'interview', 'application_ids', jsonb_build_array(a5), 'attendance', 'done')));
    t_name := t_name || text 'M no VSAT role → every row skipped'; t_det := t_det || (r::text);
    t_pass := t_pass || (jsonb_array_length(r->'updated') = 0 and r->'skipped'->0->>'code' = 'FORBIDDEN');

    t_name := t_name || text 'M the bulk function: security definer, empty search_path, signed-in only';
    select string_agg(p.proname, ',') into s from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname = 'vsat_set_attendance_bulk'
       and (not p.prosecdef or p.proconfig is distinct from array['search_path=""']
            or has_function_privilege('anon', p.oid, 'execute') or not has_function_privilege('authenticated', p.oid, 'execute'));
    t_det := t_det || coalesce(s, 'ok'); t_pass := t_pass || (s is null);

    -- ════ X. nothing of 0164 moves a stage any more ════
    t_name := t_name || text 'X none of the ten changed functions calls the stage engine';
    select string_agg(p.proname, ',') into s from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname in ('vsat__iv_schedule', 'vsat__cs_schedule', 'vsat_cancel_interview', 'vsat_cancel_counselling',
             'vsat_set_interview_attendance', 'vsat_set_counselling_attendance', 'vsat_interview_attendance_apply',
             'vsat_counselling_attendance_apply', 'vsat_submit_interview', 'vsat_submit_counselling')
       and p.prosrc ~ 'vsat__move(_checked)?\(';
    t_det := t_det || coalesce(s, 'ok'); t_pass := t_pass || (s is null);

    raise exception using errcode = 'ZDONE';
  exception when sqlstate 'ZDONE' then null;
  end;

  return query select x.n, x.p, x.d from unnest(t_name, t_pass, t_det) as x(n, p, d);
end $$;

select test, coalesce(pass, false) as pass, detail from pg_temp.run_vsat_manual_stages_tests();

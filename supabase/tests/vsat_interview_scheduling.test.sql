-- VSAT Phase 2 · interview scheduling tests for migration 0140 (STAGING ONLY)
--
-- How to run: paste this whole file into the staging SQL editor, or run it through the
-- Supabase MCP. The last statement returns one row per test: test | pass | detail.
-- Also run vsat_pipeline_panels.test.sql, vsat_grid.test.sql and vsat_pipeline_stage_engine.test.sql.
--
-- Nothing is left behind: all test data is created inside a block that is rolled back with a
-- private error code at the end. Fake data only (@example.invalid, ZZTEST names). Time is simulated
-- by moving a slot directly in the table (the tests cannot wait for an interview to end).

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

-- applicant at "vsat_cleared"
create or replace function pg_temp.mk_app(p_id text, p_campus text, p_date uuid)
returns text language plpgsql as $$
declare u uuid := pg_temp.mk_user(lower(p_id) || '@example.invalid');
begin
  insert into public.lead_manager (lead_id, registered_name, registered_email, lead_stage) values (u, 'ZZTEST ' || p_id, lower(p_id) || '@example.invalid', 'applicant_paid')
  on conflict (lead_id) do nothing;
  insert into public.application_manager (application_id, lead_id, application_no, registered_name, registered_email, campus_applied, exam_date_id,
    class10_year, class10_percentage, class10_maths_percentage, class12_year, class12_percentage, class12_maths_percentage,
    marks_physics_12, marks_chemistry_12, marks_maths_12, exam_percentile, exam_obtained_marks, exam_max_marks, vps_score)
  values (p_id, u, p_id, 'ZZTEST ' || p_id, lower(p_id) || '@example.invalid', p_campus, p_date,
    2024, 90, 85, 2026, 80, 70, 70, 70, 70, 80, 40, 50, 8.43);
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

-- the server (cron / sync route) calls these as service_role
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

create or replace function pg_temp.rpc(p_fn text, p jsonb)
returns text language sql as $$ select format('select public.%I(%L::jsonb)', p_fn, p::text) $$;

create or replace function pg_temp.iso(t timestamptz)
returns text language sql as $$ select to_char(t at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') $$;

create or replace function pg_temp.assign(p_who uuid, p_app text, p_int uuid, p_t timestamptz, p_extra jsonb default '{}'::jsonb)
returns jsonb language sql as $$
  select pg_temp.call_as(p_who, pg_temp.rpc('vsat_assign_interview',
    jsonb_build_object('application_id', p_app, 'interviewer_id', p_int, 'slot_datetime', pg_temp.iso(p_t)) || p_extra))
$$;

create or replace function pg_temp.run_vsat_interview_tests()
returns table (test text, pass boolean, detail text) language plpgsql as $$
declare
  t_name text[] := '{}'; t_pass boolean[] := '{}'; t_det text[] := '{}';
  adm uuid; adm_all uuid; adm_pune uuid; int1 uuid; int2 uuid; cou1 uuid; d uuid;
  a1 text; a2 text; a3 text; a4 text; a5 text; a6 text; a7 text; a8 text;
  ta timestamptz := date_trunc('hour', now()) + interval '2 days';
  r jsonb; s text; n int; ids jsonb; job jsonb; iv public.interview_assignments; lead uuid; row jsonb;
  scope jsonb := '["vsat_cleared", "interview_scheduled", "interviewed", "pi_cleared"]'::jsonb;
begin
  begin -- rolled back at the end (ZDONE)
    adm := pg_temp.mk_user('zztest-ivs-admin@example.invalid');
    insert into public.user_roles (user_id, role) values (adm, 'admin');
    adm_all  := pg_temp.mk_user('zztest-ivs-adm@example.invalid');
    adm_pune := pg_temp.mk_user('zztest-ivs-admpune@example.invalid');
    int1 := pg_temp.mk_user('zztest-ivs-int1@example.invalid');
    int2 := pg_temp.mk_user('zztest-ivs-int2@example.invalid');
    cou1 := pg_temp.mk_user('zztest-ivs-cou1@example.invalid');
    insert into public.vsat_team (user_id, role) values (adm_all, 'admissions'), (int1, 'interviewer'), (int2, 'interviewer'), (cou1, 'counsellor');
    insert into public.vsat_team (user_id, role, campus) values (adm_pune, 'admissions', 'pune');
    insert into public.vsat_exam_dates (label, wheebox_test_id, exam_date, start_at, end_at)
    values ('ZZTEST interview batch', 'zz-ivs', current_date, now(), now() + interval '2 hours') returning id into d;
    a1 := pg_temp.mk_app('ZZT-IVS-1', 'Ajeenkya DY Patil University — Pune', d);
    a2 := pg_temp.mk_app('ZZT-IVS-2', 'Ajeenkya DY Patil University — Pune', d);
    a3 := pg_temp.mk_app('ZZT-IVS-3', 'Sushant University — Gurugram', d);
    a4 := pg_temp.mk_app('ZZT-IVS-4', 'Ajeenkya DY Patil University — Pune', d);
    a5 := pg_temp.mk_app('ZZT-IVS-5', 'Ajeenkya DY Patil University — Pune', d);
    a6 := pg_temp.mk_app('ZZT-IVS-6', 'Sushant University — Gurugram', d);
    a7 := pg_temp.mk_app('ZZT-IVS-7', 'Sushant University — Gurugram', d);
    a8 := pg_temp.mk_app('ZZT-IVS-8', 'Ajeenkya DY Patil University — Pune', d);

    -- ════ A. schedule one ════
    r := pg_temp.assign(int1, a1, int1, ta);
    t_name := t_name || text 'A interviewers cannot schedule'; t_det := t_det || (r::text); t_pass := t_pass || (r->>'message' = 'FORBIDDEN');
    r := pg_temp.assign(adm_pune, a3, int1, ta);
    t_name := t_name || text 'A Pune admissions cannot schedule a Gurugram student'; t_det := t_det || (r::text); t_pass := t_pass || (r->>'message' = 'FORBIDDEN');
    r := pg_temp.assign(adm_all, a1, int1, now() - interval '1 hour');
    t_name := t_name || text 'A a slot in the past is refused'; t_det := t_det || (r::text); t_pass := t_pass || (r->>'message' = 'SLOT_IN_PAST');
    r := pg_temp.assign(adm_all, a1, int1, ta, '{"duration_min": 5}');
    t_name := t_name || text 'A duration under 10 minutes refused'; t_det := t_det || (r::text); t_pass := t_pass || (r->>'message' = 'BAD_VALUE: duration_min');
    r := pg_temp.assign(adm_all, a1, int1, ta, '{"duration_min": 30.5}');
    t_name := t_name || text 'A duration must be whole minutes'; t_det := t_det || (r::text); t_pass := t_pass || (r->>'message' = 'BAD_VALUE: duration_min');
    r := pg_temp.assign(adm_all, a1, int1, ta, '{"meet_link": "https://meet.google.com/zzt-aaaa-bbb", "auto_meet": true}');
    t_name := t_name || text 'A own link + Google Meet together refused'; t_det := t_det || (r::text); t_pass := t_pass || (r->>'message' = 'BAD_VALUE: meet_link');
    r := pg_temp.assign(adm_all, a1, int1, ta, '{"auto_meet": false}');
    t_name := t_name || text 'A "own link" without a link refused'; t_det := t_det || (r::text); t_pass := t_pass || (r->>'message' = 'BAD_VALUE: meet_link');
    r := pg_temp.assign(adm_all, a1, int1, ta, '{"duration_min": "30"}');
    t_name := t_name || text 'A duration as text refused'; t_det := t_det || (r::text); t_pass := t_pass || (r->>'message' = 'BAD_VALUE: duration_min');

    r := pg_temp.assign(adm_all, a1, int1, ta);
    t_name := t_name || text 'A admissions schedules a1 → interview_scheduled, Google Meet queued, 30 min, version 1';
    t_det := t_det || (left(coalesce(r->'interview', r)::text, 300));
    t_pass := t_pass || (r->'pipeline'->>'stage' = 'interview_scheduled' and r->'interview'->>'meet_mode' = 'auto'
                         and r->'interview'->>'meet_sync' = 'pending' and (r->'interview'->>'duration_min')::int = 30
                         and (r->'interview'->>'version')::int = 1 and r->'interview'->>'meet_link' is null);
    t_name := t_name || text 'A one "scheduled" event with a pending email; old field interview_selected';
    select format('%s|%s|%s|%s', count(*), min(e.kind), min(e.notify_status), min(am.application_stage_1::text)) into s
      from public.vsat_interview_events e join public.application_manager am using (application_id) where e.application_id = a1;
    t_det := t_det || (s); t_pass := t_pass || (s = '1|scheduled|pending|interview_selected');

    r := pg_temp.assign(adm_all, a2, int1, ta + interval '15 minutes');
    t_name := t_name || text 'A overlapping slot for the same interviewer → SLOT_TAKEN'; t_det := t_det || (r::text); t_pass := t_pass || (r->>'message' = 'SLOT_TAKEN');
    r := pg_temp.assign(adm_all, a3, int1, ta);
    t_name := t_name || text 'A exactly the same slot → SLOT_TAKEN'; t_det := t_det || (r::text); t_pass := t_pass || (r->>'message' = 'SLOT_TAKEN');
    r := pg_temp.assign(adm_all, a2, int1, ta + interval '30 minutes');
    t_name := t_name || text 'A back-to-back slot (starts when the last ends) is fine'; t_det := t_det || (left(r::text, 120));
    t_pass := t_pass || (r->'pipeline'->>'stage' = 'interview_scheduled');

    r := pg_temp.assign(adm_all, a1, int1, ta);
    t_name := t_name || text 'A saving the same interview again adds no event (no email)';
    select count(*) into n from public.vsat_interview_events where application_id = a1;
    t_det := t_det || (n::text); t_pass := t_pass || (n = 1 and r->'pipeline'->>'stage' = 'interview_scheduled');

    r := pg_temp.assign(adm_all, a1, int1, ta + interval '2 hours');
    t_name := t_name || text 'A moving a1 → "rescheduled" event (old time kept), version 2, reschedule_count 1';
    select format('%s|%s|%s|%s', e.kind, (e.prev_slot_start = ta)::text, (r->'interview'->>'version'), (r->'interview'->>'reschedule_count'))
      into s from public.vsat_interview_events e where e.application_id = a1 order by e.created_at desc, e.version desc limit 1;
    t_det := t_det || (s); t_pass := t_pass || (s = 'rescheduled|true|2|1');

    r := pg_temp.assign(adm_all, a3, int2, ta, '{"duration_min": 45}');
    t_name := t_name || text 'A 45-minute interview saved'; t_det := t_det || (left(coalesce(r->'interview', r)::text, 200));
    t_pass := t_pass || ((r->'interview'->>'duration_min')::int = 45);

    r := pg_temp.assign(adm_all, a4, int2, ta + interval '3 hours', '{"meet_link": "https://meet.google.com/zzt-abcd-efg"}');
    t_name := t_name || text 'A own link → manual, nothing for Google to do';
    t_det := t_det || (left(coalesce(r->'interview', r)::text, 200));
    t_pass := t_pass || (r->'interview'->>'meet_mode' = 'manual' and r->'interview'->>'meet_sync' = 'none'
                         and r->'interview'->>'meet_link' = 'https://meet.google.com/zzt-abcd-efg');
    r := pg_temp.assign(adm_all, a4, int2, ta + interval '4 hours');
    t_name := t_name || text 'A moving an own-link interview keeps the link';
    t_det := t_det || (left(coalesce(r->'interview', r)::text, 200));
    t_pass := t_pass || (r->'interview'->>'meet_mode' = 'manual' and r->'interview'->>'meet_link' = 'https://meet.google.com/zzt-abcd-efg');
    r := pg_temp.assign(adm_all, a4, int2, ta + interval '4 hours', '{"auto_meet": true}');
    t_name := t_name || text 'A switching to Google Meet clears the own link and queues Google';
    t_det := t_det || (left(coalesce(r->'interview', r)::text, 200));
    t_pass := t_pass || (r->'interview'->>'meet_mode' = 'auto' and r->'interview'->>'meet_link' is null and r->'interview'->>'meet_sync' = 'pending');

    -- pretend Google made a3's event
    update public.interview_assignments set calendar_event_id = 'vizztest3', meet_link = 'https://meet.google.com/zzt-goog-aaa',
           meet_code = 'zzt-goog-aaa', meet_sync = 'ok' where application_id = a3;
    r := pg_temp.assign(adm_all, a3, int2, ta + interval '5 hours', '{"duration_min": 45}');
    t_name := t_name || text 'A moving a Google interview keeps its Meet link and queues the event move';
    t_det := t_det || (left(coalesce(r->'interview', r)::text, 200));
    t_pass := t_pass || (r->'interview'->>'meet_link' = 'https://meet.google.com/zzt-goog-aaa' and r->'interview'->>'meet_sync' = 'pending'
                         and r->'interview'->>'calendar_event_id' = 'vizztest3');
    -- pretend Google made a1's event, then switch it to an own link
    update public.interview_assignments set calendar_event_id = 'vizztest1', meet_link = 'https://meet.google.com/zzt-goog-bbb',
           meet_code = 'zzt-goog-bbb', meet_sync = 'ok' where application_id = a1;
    r := pg_temp.assign(adm_all, a1, int1, ta + interval '2 hours', '{"meet_link": "https://meet.google.com/zzt-own1-abc"}');
    t_name := t_name || text 'A switching a Google interview to an own link queues removing the Google event';
    t_det := t_det || (left(coalesce(r->'interview', r)::text, 200));
    t_pass := t_pass || (r->'interview'->>'meet_mode' = 'manual' and r->'interview'->>'meet_sync' = 'pending'
                         and r->'interview'->>'meet_link' = 'https://meet.google.com/zzt-own1-abc');

    -- ════ B. bulk ════
    r := pg_temp.call_as(int1, pg_temp.rpc('vsat_schedule_interviews_bulk',
           jsonb_build_object('application_ids', jsonb_build_array(a5), 'interviewer_id', int2, 'start', pg_temp.iso(ta))));
    t_name := t_name || text 'B interviewers cannot bulk schedule'; t_det := t_det || (r::text); t_pass := t_pass || (r->>'message' = 'FORBIDDEN');
    -- int2 is busy 4h00–4h30 (a4) and 5h00–5h45 (a3)
    r := pg_temp.call_as(adm_all, pg_temp.rpc('vsat_schedule_interviews_bulk',
           jsonb_build_object('application_ids', jsonb_build_array(a5, a6, a1, 'ZZT-NOPE'), 'interviewer_id', int2,
                              'start', pg_temp.iso(ta + interval '4 hours'), 'dry_run', true)));
    t_name := t_name || text 'B preview: busy times skipped (4h30, then 5h45), scheduled ones and unknown ones listed as skipped';
    t_det := t_det || (left(r::text, 400));
    t_pass := t_pass || ((r->'scheduled'->0->>'slot')::timestamptz = ta + interval '4 hours 30 minutes'
                         and (r->'scheduled'->1->>'slot')::timestamptz = ta + interval '5 hours 45 minutes'
                         and (r->>'ends_at')::timestamptz = ta + interval '6 hours 15 minutes'
                         and r->'skipped' @> jsonb_build_array(jsonb_build_object('application_id', a1, 'code', 'ALREADY_SCHEDULED'))
                         and r->'skipped' @> jsonb_build_array(jsonb_build_object('application_id', 'ZZT-NOPE', 'code', 'NOT_IN_PIPELINE'))
                         and (r->>'dry_run')::boolean);
    t_name := t_name || text 'B preview saves nothing';
    select vp.stage into s from public.vsat_pipeline vp where vp.application_id = a5;
    t_det := t_det || (s); t_pass := t_pass || (s = 'vsat_cleared');
    r := pg_temp.call_as(adm_all, pg_temp.rpc('vsat_schedule_interviews_bulk',
           jsonb_build_object('application_ids', jsonb_build_array(a5, a6, a1, 'ZZT-NOPE'), 'interviewer_id', int2,
                              'start', pg_temp.iso(ta + interval '4 hours'))));
    t_name := t_name || text 'B save: both scheduled at the previewed times, Google queued, events + history marked bulk';
    select format('%s|%s|%s|%s', string_agg(vp.stage, ',' order by vp.application_id),
                  bool_and(ia.meet_sync = 'pending' and ia.meet_mode = 'auto')::text,
                  (select string_agg(distinct e.source, ',') from public.vsat_interview_events e where e.application_id in (a5, a6)),
                  (select string_agg(distinct h.source, ',') from public.vsat_stage_history h where h.application_id in (a5, a6) and h.to_stage = 'interview_scheduled'))
      into s from public.vsat_pipeline vp join public.interview_assignments ia using (application_id) where vp.application_id in (a5, a6);
    t_det := t_det || (s || ' ' || left(r::text, 200));
    t_pass := t_pass || (s = 'interview_scheduled,interview_scheduled|true|bulk|bulk'
                         and (r->'scheduled'->1->>'slot')::timestamptz = ta + interval '5 hours 45 minutes');
    select jsonb_agg(to_jsonb('ZZT-X-' || g)) into ids from generate_series(1, 41) g;
    r := pg_temp.call_as(adm_all, pg_temp.rpc('vsat_schedule_interviews_bulk',
           jsonb_build_object('application_ids', ids, 'interviewer_id', int2, 'start', pg_temp.iso(ta))));
    t_name := t_name || text 'B more than 40 students refused'; t_det := t_det || (r::text); t_pass := t_pass || (r->>'message' = 'BAD_VALUE: application_ids');
    r := pg_temp.call_as(adm_pune, pg_temp.rpc('vsat_schedule_interviews_bulk',
           jsonb_build_object('application_ids', jsonb_build_array(a7, a8), 'interviewer_id', int1, 'start', pg_temp.iso(ta + interval '1 day'), 'dry_run', true)));
    t_name := t_name || text 'B Pune admissions: the Gurugram student is skipped (FORBIDDEN, no name shown), the Pune one planned';
    t_det := t_det || (left(r::text, 300));
    t_pass := t_pass || (r->'skipped' @> jsonb_build_array(jsonb_build_object('application_id', a7, 'code', 'FORBIDDEN'))
                         and r->'skipped'->0->>'name' is null and r->'scheduled'->0->>'application_id' = a8);

    -- ════ C. cancel ════
    r := pg_temp.call_as(adm_all, pg_temp.rpc('vsat_cancel_interview', jsonb_build_object('application_id', a6)));
    t_name := t_name || text 'C cancel needs a reason'; t_det := t_det || (r::text); t_pass := t_pass || (r->>'message' = 'REASON_REQUIRED');
    r := pg_temp.call_as(int2, pg_temp.rpc('vsat_cancel_interview', jsonb_build_object('application_id', a6, 'reason', 'zz no')));
    t_name := t_name || text 'C interviewers cannot cancel'; t_det := t_det || (r::text); t_pass := t_pass || (r->>'message' = 'FORBIDDEN');
    r := pg_temp.call_as(adm_all, pg_temp.rpc('vsat_cancel_interview', jsonb_build_object('application_id', a6, 'reason', 'zz student asked')));
    t_name := t_name || text 'C cancel → back to VSAT cleared; slot + interviewer cleared; old field vsat_cleared';
    select * into iv from public.interview_assignments where application_id = a6;
    select am.application_stage_1::text into s from public.application_manager am where am.application_id = a6;
    t_det := t_det || (left(coalesce(r->'pipeline', r)::text, 200) || ' ' || s);
    t_pass := t_pass || (r->'pipeline'->>'stage' = 'vsat_cleared' and r->'pipeline'->>'status' = 'active' and iv.cancelled_at is not null
                         and iv.slot_datetime is null and iv.interviewer_id is null and iv.cancel_reason = 'zz student asked'
                         and iv.meet_sync = 'none' and s = 'vsat_cleared');
    t_name := t_name || text 'C cancel event keeps the old time + interviewer; history has the reason';
    select format('%s|%s|%s|%s', e.kind, (e.prev_slot_start = ta + interval '5 hours 45 minutes')::text, (e.prev_interviewer_id = int2)::text, e.notify_status)
      into s from public.vsat_interview_events e where e.application_id = a6 and e.kind = 'cancelled';
    t_det := t_det || (s);
    t_pass := t_pass || (s = 'cancelled|true|true|pending'
                         and exists (select 1 from public.vsat_stage_history h where h.application_id = a6 and h.to_stage = 'vsat_cleared'
                                        and h.reason = 'Interview cancelled: zz student asked'));
    r := pg_temp.call_as(adm_all, pg_temp.rpc('vsat_cancel_interview', jsonb_build_object('application_id', a6, 'reason', 'zz again')));
    t_name := t_name || text 'C cancelling twice → NO_INTERVIEW'; t_det := t_det || (r::text); t_pass := t_pass || (r->>'message' = 'NO_INTERVIEW');
    r := pg_temp.call_as(int2, format('select public.vsat_student(%L)', a6));
    t_name := t_name || text 'C the interviewer loses access to a cancelled student'; t_det := t_det || (left(r::text, 120)); t_pass := t_pass || (r->>'message' = 'FORBIDDEN');
    r := pg_temp.call_as(adm_all, pg_temp.rpc('vsat_cancel_interview', jsonb_build_object('application_id', a3, 'reason', 'zz clash')));
    t_name := t_name || text 'C cancelling a Google interview queues deleting the event';
    select * into iv from public.interview_assignments where application_id = a3;
    t_det := t_det || (iv.meet_sync || '|' || coalesce(iv.calendar_event_id, '-'));
    t_pass := t_pass || (iv.meet_sync = 'pending' and iv.calendar_event_id = 'vizztest3' and iv.meet_link is null);
    r := pg_temp.assign(adm_all, a6, int1, ta + interval '6 hours');
    t_name := t_name || text 'C scheduling again after a cancel is a new "scheduled" event';
    select e.kind into s from public.vsat_interview_events e where e.application_id = a6 order by e.created_at desc, e.version desc limit 1;
    t_det := t_det || (coalesce(s, '-')); t_pass := t_pass || (s = 'scheduled' and r->'pipeline'->>'stage' = 'interview_scheduled');

    -- ════ D. attendance by hand ════
    r := pg_temp.call_as(int2, pg_temp.rpc('vsat_set_interview_attendance', jsonb_build_object('application_id', a5, 'attendance', 'no_show')));
    t_name := t_name || text 'D cannot mark before the interview starts'; t_det := t_det || (r::text); t_pass := t_pass || (r->>'message' = 'TOO_EARLY');
    update public.interview_assignments set slot_datetime = now() - interval '1 hour' where application_id = a5;  -- time passes
    r := pg_temp.call_as(int1, pg_temp.rpc('vsat_set_interview_attendance', jsonb_build_object('application_id', a5, 'attendance', 'no_show')));
    t_name := t_name || text 'D another interviewer cannot mark'; t_det := t_det || (r::text); t_pass := t_pass || (r->>'message' = 'FORBIDDEN');
    r := pg_temp.call_as(int2, pg_temp.rpc('vsat_set_interview_attendance', jsonb_build_object('application_id', a5, 'attendance', 'maybe')));
    t_name := t_name || text 'D unknown attendance value refused'; t_det := t_det || (r::text); t_pass := t_pass || (r->>'message' = 'BAD_VALUE: attendance');
    r := pg_temp.call_as(int2, pg_temp.rpc('vsat_set_interview_attendance', jsonb_build_object('application_id', a5, 'attendance', 'no_show')));
    t_name := t_name || text 'D the interviewer marks no-show → student absent';
    t_det := t_det || (left(coalesce(r->'pipeline', r)::text, 150));
    t_pass := t_pass || (r->'interview'->>'attendance' = 'no_show' and r->'interview'->>'attendance_source' = 'manual' and r->'pipeline'->>'status' = 'absent');
    r := pg_temp.call_as(int2, pg_temp.rpc('vsat_set_interview_attendance', jsonb_build_object('application_id', a5, 'attendance', 'done', 'reason', 'zz oops')));
    t_name := t_name || text 'D the interviewer cannot change a mark'; t_det := t_det || (r::text); t_pass := t_pass || (r->>'message' = 'FORBIDDEN');
    r := pg_temp.call_as(adm_all, pg_temp.rpc('vsat_set_interview_attendance', jsonb_build_object('application_id', a5, 'attendance', 'done')));
    t_name := t_name || text 'D admissions changing a mark needs a reason'; t_det := t_det || (r::text); t_pass := t_pass || (r->>'message' = 'REASON_REQUIRED');
    r := pg_temp.call_as(adm_all, pg_temp.rpc('vsat_set_interview_attendance', jsonb_build_object('application_id', a5, 'attendance', 'done', 'reason', 'zz joined late')));
    t_name := t_name || text 'D admissions sets joined with a reason → student active again; event logged';
    select count(*) into n from public.vsat_interview_events e where e.application_id = a5 and e.kind = 'attendance' and e.notify_status = 'none';
    t_det := t_det || (left(coalesce(r->'pipeline', r)::text, 150) || ' events=' || n);
    t_pass := t_pass || (r->'interview'->>'attendance' = 'done' and r->'pipeline'->>'status' = 'active' and n = 2);

    -- ════ E. the student ════
    select am.lead_id into lead from public.application_manager am where am.application_id = a1;
    r := pg_temp.call_as(lead, 'select public.vsat_my_interview()');
    t_name := t_name || text 'E before the window: upcoming, no link handed out, opens 10 min early';
    t_det := t_det || (r::text);
    t_pass := t_pass || (r->>'state' = 'upcoming' and r->'meet_link' = 'null'::jsonb and (r->>'has_link')::boolean
                         and (r->>'opens_at')::timestamptz = ta + interval '1 hour 50 minutes' and (r->>'end')::timestamptz = ta + interval '2 hours 30 minutes');
    update public.interview_assignments set slot_datetime = now() + interval '5 minutes' where application_id = a1;
    r := pg_temp.call_as(lead, 'select public.vsat_my_interview()');
    t_name := t_name || text 'E inside the window: open, with the Meet link'; t_det := t_det || (r::text);
    t_pass := t_pass || (r->>'state' = 'open' and r->>'meet_link' = 'https://meet.google.com/zzt-own1-abc');
    update public.interview_assignments set slot_datetime = now() - interval '40 minutes' where application_id = a1;
    r := pg_temp.call_as(lead, 'select public.vsat_my_interview()');
    t_name := t_name || text 'E after the end: ended, no link'; t_det := t_det || (r::text);
    t_pass := t_pass || (r->>'state' = 'ended' and r->'meet_link' = 'null'::jsonb);
    select am.lead_id into lead from public.application_manager am where am.application_id = a7;
    r := pg_temp.call_as(lead, 'select public.vsat_my_interview()');
    t_name := t_name || text 'E a student with no interview: none'; t_det := t_det || (r::text); t_pass := t_pass || (r->>'state' = 'none');
    r := pg_temp.call_as(null, 'select public.vsat_my_interview()', true);
    t_name := t_name || text 'E anon cannot call it'; t_det := t_det || (r::text); t_pass := t_pass || (r->>'sqlstate' = '42501');

    -- ════ F. attendance from Meet (server) ════
    r := pg_temp.call_as(adm, 'select public.vsat_interview_attendance_due(10)');
    t_name := t_name || text 'F browsers cannot read the attendance work list'; t_det := t_det || (r::text); t_pass := t_pass || (r->>'sqlstate' = '42501');
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_interview_attendance_apply', '{"id": "00000000-0000-0000-0000-000000000000", "version": 1, "result": "done"}'));
    t_name := t_name || text 'F browsers cannot write attendance results'; t_det := t_det || (r::text); t_pass := t_pass || (r->>'sqlstate' = '42501');
    update public.interview_assignments set meet_mode = 'auto', meet_sync = 'ok', meet_code = 'zzt-abcd-efg', meet_link = 'https://meet.google.com/zzt-abcd-efg',
           slot_datetime = now() - interval '1 hour' where application_id = a2;
    select * into iv from public.interview_assignments where application_id = a2;
    r := pg_temp.call_svc('select public.vsat_interview_attendance_due(50)');
    t_name := t_name || text 'F the server sees a2 (Google, ended > 10 min ago, unmarked)'; t_det := t_det || (left(r::text, 200));
    t_pass := t_pass || exists (select 1 from jsonb_array_elements(r) e where e->>'id' = iv.id::text);
    r := pg_temp.call_svc(pg_temp.rpc('vsat_interview_attendance_apply', jsonb_build_object('id', iv.id, 'version', iv.version + 1, 'result', 'no_show')));
    t_name := t_name || text 'F a stale version is ignored'; t_det := t_det || (r::text); t_pass := t_pass || (r->>'applied' = 'false');
    r := pg_temp.call_svc(pg_temp.rpc('vsat_interview_attendance_apply', jsonb_build_object('id', iv.id, 'version', iv.version, 'result', 'no_show',
           'detail', jsonb_build_object('people', 1, 'overlap_min', 0, 'records', 1, 'reason', 'one_joined'))));
    t_name := t_name || text 'F Meet says only one person joined → no-show (auto), student absent, history source auto';
    select * into iv from public.interview_assignments where application_id = a2;
    select format('%s|%s|%s|%s', iv.attendance, iv.attendance_source, vp.status,
                  (select string_agg(h.source, ',') from public.vsat_stage_history h where h.application_id = a2 and h.to_status = 'absent'))
      into s from public.vsat_pipeline vp where vp.application_id = a2;
    t_det := t_det || (s || ' ' || r::text);
    t_pass := t_pass || (r->>'applied' = 'true' and s = 'no_show|auto|absent|auto' and iv.attendance_detail->>'reason' = 'one_joined');
    r := pg_temp.call_svc(pg_temp.rpc('vsat_interview_attendance_apply', jsonb_build_object('id', iv.id, 'version', iv.version, 'result', 'done')));
    t_name := t_name || text 'F an already marked interview is not overwritten'; t_det := t_det || (r::text); t_pass := t_pass || (r->>'applied' = 'false');
    select am.lead_id into lead from public.application_manager am where am.application_id = a2;
    r := pg_temp.call_as(lead, 'select public.vsat_my_interview()');
    t_name := t_name || text 'F the student now sees "missed"'; t_det := t_det || (r::text); t_pass := t_pass || (r->>'state' = 'missed');
    update public.interview_assignments set meet_sync = 'ok', meet_code = 'zzt-wxyz-abc', meet_link = 'https://meet.google.com/zzt-wxyz-abc',
           slot_datetime = now() - interval '2 hours' where application_id = a4;
    select * into iv from public.interview_assignments where application_id = a4;
    r := pg_temp.call_svc(pg_temp.rpc('vsat_interview_attendance_apply', jsonb_build_object('id', iv.id, 'version', iv.version, 'result', 'needs_marking',
           'detail', jsonb_build_object('people', 'x', 'reason', 'evil', 'records', 0))));
    t_name := t_name || text 'F no Meet record → left for an admin (attendance unchanged), only known values kept, off the work list';
    select * into iv from public.interview_assignments where application_id = a4;
    r := pg_temp.call_svc('select public.vsat_interview_attendance_due(50)');
    t_det := t_det || (coalesce(iv.attendance_detail::text, '-'));
    t_pass := t_pass || (iv.attendance = 'scheduled' and iv.attendance_source is null and iv.attendance_detail->>'result' = 'needs_marking'
                         and iv.attendance_detail->'people' = 'null'::jsonb and iv.attendance_detail->'reason' = 'null'::jsonb
                         and (iv.attendance_detail->>'records')::int = 0
                         and not exists (select 1 from jsonb_array_elements(r) e where e->>'id' = iv.id::text));

    -- ════ G. email outbox (server) ════
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_interview_notices_claim', '{}'));
    t_name := t_name || text 'G browsers cannot claim email jobs'; t_det := t_det || (r::text); t_pass := t_pass || (r->>'sqlstate' = '42501');
    r := pg_temp.call_svc(pg_temp.rpc('vsat_interview_notices_claim', jsonb_build_object('wait_for_meet', false, 'application_ids', jsonb_build_array(a1))));
    job := r->0;
    t_name := t_name || text 'G only the newest job per interview is sent; it carries the student + current link; no baseline yet';
    select string_agg(e.notify_status || ':' || coalesce(e.notify_detail->>'why', '-'), ',' order by e.created_at, e.version) into s
      from public.vsat_interview_events e where e.application_id = a1;
    t_det := t_det || (s || ' ' || left(r::text, 250));
    t_pass := t_pass || (jsonb_array_length(r) = 1 and job->>'kind' = 'rescheduled' and job->'baseline' = 'null'::jsonb
                         and job->'student'->>'email' = 'zzt-ivs-1@example.invalid' and job->>'meet_link' = 'https://meet.google.com/zzt-own1-abc'
                         and job->'interviewer'->>'email' = 'zztest-ivs-int1@example.invalid'
                         and s = 'skipped:superseded,skipped:superseded,sending:-');
    r := pg_temp.call_svc(pg_temp.rpc('vsat_interview_notice_done', jsonb_build_object('id', job->>'id', 'status', 'sent',
           'detail', jsonb_build_object('sent_to', jsonb_build_array('student', 'interviewer')))));
    t_name := t_name || text 'G job marked sent'; t_det := t_det || (r::text); t_pass := t_pass || (r->>'updated' = 'true');
    r := pg_temp.call_svc(pg_temp.rpc('vsat_interview_notice_done', jsonb_build_object('id', job->>'id', 'status', 'sent')));
    t_name := t_name || text 'G a job that is not being sent cannot be marked again'; t_det := t_det || (r::text); t_pass := t_pass || (r->>'updated' = 'false');
    r := pg_temp.assign(adm_all, a1, int1, ta + interval '7 hours', '{"meet_link": "https://meet.google.com/zzt-own1-abc"}');
    r := pg_temp.call_svc(pg_temp.rpc('vsat_interview_notices_claim', jsonb_build_object('wait_for_meet', false, 'application_ids', jsonb_build_array(a1))));
    job := r->0;
    t_name := t_name || text 'G next move: the baseline is what was last emailed (old time), so the email says "moved"';
    t_det := t_det || (left(r::text, 300));
    t_pass := t_pass || (jsonb_array_length(r) = 1 and job->'baseline'->>'kind' = 'rescheduled'
                         and (job->'baseline'->>'slot_start')::timestamptz = ta + interval '2 hours'
                         and (job->>'slot_start')::timestamptz = ta + interval '7 hours');
    r := pg_temp.call_svc(pg_temp.rpc('vsat_interview_notice_done', jsonb_build_object('id', job->>'id', 'status', 'failed',
           'detail', jsonb_build_object('sent_to', jsonb_build_array('student')))));
    r := pg_temp.call_svc(pg_temp.rpc('vsat_interview_notices_claim', jsonb_build_object('wait_for_meet', false, 'application_ids', jsonb_build_array(a1))));
    t_name := t_name || text 'G a failed job is retried and remembers who already got it';
    t_det := t_det || (left(r::text, 200));
    t_pass := t_pass || (jsonb_array_length(r) = 1 and r->0->>'id' = job->>'id' and r->0->'sent_to' = '["student"]'::jsonb and (r->0->>'attempts')::int = 2);
    r := pg_temp.call_svc(pg_temp.rpc('vsat_interview_notices_claim', jsonb_build_object('application_ids', jsonb_build_array(a5))));
    t_name := t_name || text 'G a fresh Google interview waits for its Meet link before emailing'; t_det := t_det || (r::text);
    t_pass := t_pass || (r = '[]'::jsonb);
    r := pg_temp.call_svc(pg_temp.rpc('vsat_interview_notices_claim', jsonb_build_object('wait_for_meet', false, 'application_ids', jsonb_build_array(a5))));
    t_name := t_name || text 'G …and goes out when not waiting (Google not set up)'; t_det := t_det || (left(r::text, 150));
    t_pass := t_pass || (jsonb_array_length(r) = 1 and r->0->>'kind' = 'scheduled');
    update public.vsat_interview_events set slot_start = now() - interval '2 hours' where application_id = a6 and kind = 'scheduled';
    r := pg_temp.call_svc(pg_temp.rpc('vsat_interview_notices_claim', jsonb_build_object('wait_for_meet', false, 'application_ids', jsonb_build_array(a6))));
    t_name := t_name || text 'G jobs for a time that has passed are skipped; the cancel before the new booking is superseded';
    select string_agg(e.kind || ':' || e.notify_status || ':' || coalesce(e.notify_detail->>'why', '-'), ',' order by e.created_at, e.version) into s
      from public.vsat_interview_events e where e.application_id = a6;
    t_det := t_det || (s); t_pass := t_pass || (r = '[]'::jsonb and s = 'scheduled:skipped:superseded,cancelled:skipped:superseded,scheduled:skipped:time_passed');
    r := pg_temp.call_svc(pg_temp.rpc('vsat_interview_notices_claim', '{"role": "admin"}'));
    t_name := t_name || text 'G unknown keys refused'; t_det := t_det || (r::text); t_pass := t_pass || (r->>'message' like 'UNKNOWN_KEY%');

    -- ════ H. grid: interviewer dropdown + Meet column ════
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_grid_list', jsonb_build_object('scope', scope, 'interviewer_ids', jsonb_build_array(int1),
           'search', jsonb_build_object('column', '_any', 'values', '["ZZT-IVS"]'::jsonb), 'columns', '["registered_name", "interviewer", "interview_meet"]'::jsonb)));
    t_name := t_name || text 'H interviewer filter: only int1''s students (a1, a2, a6)';
    t_det := t_det || (left(r::text, 300));
    t_pass := t_pass || ((r->>'total')::int = 3
                         and (select string_agg(x->>'application_id', ',' order by x->>'application_id') from jsonb_array_elements(r->'rows') x) = 'ZZT-IVS-1,ZZT-IVS-2,ZZT-IVS-6');
    t_name := t_name || text 'H interviewer counts per option (none = no interviewer / cancelled) and names';
    t_det := t_det || (left((r->'facets'->'interviewer')::text || ' ' || (r->'facets'->'interviewer_name')::text, 300));
    t_pass := t_pass || ((r->'facets'->'interviewer'->>(int1::text))::int = 3 and (r->'facets'->'interviewer'->>(int2::text))::int = 2
                         and (r->'facets'->'interviewer'->>'none')::int = 3
                         and r->'facets'->'interviewer_name'->>(int1::text) = 'ZZTEST zztest-ivs-int1'
                         and (r->'facets'->'stage'->>'interview_scheduled')::int = 3);
    t_name := t_name || text 'H Interview Meet column: own link / ready / creating';
    select string_agg(x->>'application_id' || '=' || coalesce(x->>'interview_meet', '-'), ',' order by x->>'application_id') into s from jsonb_array_elements(r->'rows') x;
    t_det := t_det || (s); t_pass := t_pass || (s = 'ZZT-IVS-1=own_link,ZZT-IVS-2=ready,ZZT-IVS-6=creating');
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_grid_list', jsonb_build_object('scope', scope, 'interviewer_ids', '["none"]'::jsonb,
           'search', jsonb_build_object('column', '_any', 'values', '["ZZT-IVS"]'::jsonb), 'columns', '["interview_meet"]'::jsonb)));
    t_name := t_name || text 'H "no interviewer" option: a3 (cancelled), a7, a8';
    select string_agg(x->>'application_id' || '=' || coalesce(x->>'interview_meet', '-'), ',' order by x->>'application_id') into s from jsonb_array_elements(r->'rows') x;
    t_det := t_det || (coalesce(s, '-')); t_pass := t_pass || (s = 'ZZT-IVS-3=cancelled,ZZT-IVS-7=-,ZZT-IVS-8=-');
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_grid_list', jsonb_build_object('interviewer_ids', '["nope"]'::jsonb)));
    t_name := t_name || text 'H a bad interviewer id is refused'; t_det := t_det || (r::text); t_pass := t_pass || (r->>'message' = 'BAD_VALUE: interviewer_ids');
    r := pg_temp.call_as(int1, pg_temp.rpc('vsat_grid_list', jsonb_build_object('scope', scope,
           'search', jsonb_build_object('column', '_any', 'values', '["ZZT-IVS"]'::jsonb), 'columns', '["registered_name"]'::jsonb)));
    t_name := t_name || text 'H an interviewer still sees only their own students'; t_det := t_det || (left(r::text, 200));
    t_pass := t_pass || ((r->>'total')::int = 3);

    -- ════ I. retry, keys, integrity ════
    update public.interview_assignments set meet_sync = 'failed', meet_attempts = 5, meet_error = 'zz google down' where application_id = a5;
    r := pg_temp.call_as(int2, pg_temp.rpc('vsat_interview_meet_retry', jsonb_build_object('application_id', a5)));
    t_name := t_name || text 'I interviewers cannot retry Google'; t_det := t_det || (r::text); t_pass := t_pass || (r->>'message' = 'FORBIDDEN');
    r := pg_temp.call_as(adm_all, pg_temp.rpc('vsat_interview_meet_retry', jsonb_build_object('application_id', a5)));
    t_name := t_name || text 'I admissions retry → queued again with a fresh try budget';
    t_det := t_det || (left(coalesce(r->'interview', r)::text, 200));
    t_pass := t_pass || (r->'interview'->>'meet_sync' = 'pending' and (r->'interview'->>'meet_attempts')::int = 0 and r->'interview'->>'meet_error' is null);
    r := pg_temp.call_as(adm_all, pg_temp.rpc('vsat_interview_meet_retry', jsonb_build_object('application_id', a5)));
    t_name := t_name || text 'I nothing to retry → NOTHING_TO_RETRY'; t_det := t_det || (r::text); t_pass := t_pass || (r->>'message' = 'NOTHING_TO_RETRY');
    r := pg_temp.assign(adm_all, a8, int1, ta + interval '1 day', '{"role": "admin"}');
    t_name := t_name || text 'I unknown key refused'; t_det := t_det || (r::text); t_pass := t_pass || (r->>'message' like 'UNKNOWN_KEY%');
    t_name := t_name || text 'I one interview row per student + attempt (unique)';
    begin
      insert into public.interview_assignments (application_id, attempt_no) values (a1, 1);
      t_det := t_det || text 'inserted'; t_pass := t_pass || false;
    exception when unique_violation then
      t_det := t_det || text 'unique_violation'; t_pass := t_pass || true;
    end;

    -- ════ K. Google sync claim / release (server) ════
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_interview_sync_claim', '{}'));
    t_name := t_name || text 'K browsers cannot claim Google work'; t_det := t_det || (r::text); t_pass := t_pass || (r->>'sqlstate' = '42501');
    r := pg_temp.call_svc(pg_temp.rpc('vsat_interview_sync_claim', jsonb_build_object('application_ids', jsonb_build_array(a5))));
    row := r->0;
    t_name := t_name || text 'K claim: the queued interview comes with both emails, its version and a claim token';
    select * into iv from public.interview_assignments where application_id = a5;
    t_det := t_det || (left(r::text, 300));
    t_pass := t_pass || (jsonb_array_length(r) = 1 and row->'student'->>'email' = 'zzt-ivs-5@example.invalid'
                         and row->'interviewer'->>'email' = 'zztest-ivs-int2@example.invalid' and (row->>'version')::int = iv.version
                         and iv.meet_sync = 'syncing' and iv.meet_attempts = 1 and row->>'claimed_at' is not null);
    r := pg_temp.call_svc(pg_temp.rpc('vsat_interview_sync_claim', jsonb_build_object('application_ids', jsonb_build_array(a5))));
    t_name := t_name || text 'K a held claim is not handed out twice'; t_det := t_det || (r::text); t_pass := t_pass || (r = '[]'::jsonb);
    r := pg_temp.call_svc(pg_temp.rpc('vsat_interview_sync_release', jsonb_build_object('id', row->>'id', 'version', (row->>'version')::int,
           'claimed_at', '2001-01-01T00:00:00Z', 'outcome', 'ok')));
    t_name := t_name || text 'K a release with the wrong claim token changes nothing'; t_det := t_det || (r::text);
    t_pass := t_pass || (r->>'applied' = 'false' and (select meet_sync from public.interview_assignments where application_id = a5) = 'syncing');
    -- Google event ids use base32hex only (a–v, 0–9): an id with "z" can't have come from our own id scheme
    r := pg_temp.call_svc(pg_temp.rpc('vsat_interview_sync_release', jsonb_build_object('id', row->>'id', 'version', (row->>'version')::int,
           'claimed_at', row->>'claimed_at', 'outcome', 'ok', 'calendar_event_id', 'vizz5g0', 'meet_link', 'https://meet.google.com/zzt-five-abc')));
    t_name := t_name || text 'K an event id Google would never accept (letters past v) is refused'; t_det := t_det || (r::text);
    t_pass := t_pass || (r->>'message' = 'BAD_VALUE: calendar_event_id' and (select meet_sync from public.interview_assignments where application_id = a5) = 'syncing');
    r := pg_temp.call_svc(pg_temp.rpc('vsat_interview_sync_release', jsonb_build_object('id', row->>'id', 'version', (row->>'version')::int,
           'claimed_at', row->>'claimed_at', 'outcome', 'ok', 'calendar_event_id', 'vi0005g0', 'meet_link', 'javascript:alert(1)', 'meet_code', 'zzt-five-abc')));
    t_name := t_name || text 'K a non-Meet link from the server is refused'; t_det := t_det || (r::text); t_pass := t_pass || (r->>'message' = 'BAD_VALUE: meet_link');
    r := pg_temp.call_svc(pg_temp.rpc('vsat_interview_sync_release', jsonb_build_object('id', row->>'id', 'version', (row->>'version')::int,
           'claimed_at', row->>'claimed_at', 'outcome', 'ok', 'calendar_event_id', 'vi0005g0', 'meet_link', 'https://meet.google.com/zzt-five-abc', 'meet_code', 'zzt-five-abc')));
    t_name := t_name || text 'K release ok: event, link and code saved; marked in step with this version; tries reset';
    select * into iv from public.interview_assignments where application_id = a5;
    t_det := t_det || (r::text || ' ' || iv.meet_sync || '|' || coalesce(iv.meet_link, '-'));
    t_pass := t_pass || (r->>'applied' = 'true' and iv.meet_sync = 'ok' and iv.calendar_event_id = 'vi0005g0' and iv.meet_link = 'https://meet.google.com/zzt-five-abc'
                         and iv.meet_code = 'zzt-five-abc' and iv.meet_event_version = iv.version and iv.meet_attempts = 0 and iv.meet_claimed_at is null);
    r := pg_temp.assign(adm_all, a8, int2, ta + interval '2 days');
    r := pg_temp.call_svc(pg_temp.rpc('vsat_interview_sync_claim', jsonb_build_object('application_ids', jsonb_build_array(a8))));
    row := r->0;
    r := pg_temp.assign(adm_all, a8, int2, ta + interval '2 days 1 hour');
    r := pg_temp.call_svc(pg_temp.rpc('vsat_interview_sync_release', jsonb_build_object('id', row->>'id', 'version', (row->>'version')::int,
           'claimed_at', row->>'claimed_at', 'outcome', 'ok', 'calendar_event_id', 'vi0008g0', 'meet_link', 'https://meet.google.com/zzt-eigh-abc', 'meet_code', 'zzt-eigh-abc')));
    t_name := t_name || text 'K moved while Google was working: the made event is remembered, the move stays queued';
    select * into iv from public.interview_assignments where application_id = a8;
    t_det := t_det || (r::text || ' ' || iv.meet_sync || '|' || coalesce(iv.calendar_event_id, '-'));
    t_pass := t_pass || (r->>'applied' = 'false' and iv.calendar_event_id = 'vi0008g0' and iv.meet_sync = 'pending' and iv.meet_link is null);
    r := pg_temp.call_svc(pg_temp.rpc('vsat_interview_sync_claim', jsonb_build_object('application_ids', jsonb_build_array(a3))));
    row := r->0;
    r := pg_temp.call_svc(pg_temp.rpc('vsat_interview_sync_release', jsonb_build_object('id', row->>'id', 'version', (row->>'version')::int,
           'claimed_at', row->>'claimed_at', 'outcome', 'none', 'deleted_event_id', 'vizztest3')));
    t_name := t_name || text 'K cancelled interview: the deleted event is forgotten, the next event gets a new id generation';
    select * into iv from public.interview_assignments where application_id = a3;
    t_det := t_det || (r::text || ' ' || iv.meet_sync || '|' || coalesce(iv.calendar_event_id, '-') || '|' || iv.event_gen);
    t_pass := t_pass || (row->>'cancelled' = 'true' and r->>'applied' = 'true' and iv.meet_sync = 'none' and iv.calendar_event_id is null and iv.event_gen = 1);
    r := pg_temp.call_svc(pg_temp.rpc('vsat_interview_sync_claim', jsonb_build_object('application_ids', jsonb_build_array(a8))));
    row := r->0;
    r := pg_temp.call_svc(pg_temp.rpc('vsat_interview_sync_release', jsonb_build_object('id', row->>'id', 'version', (row->>'version')::int,
           'claimed_at', row->>'claimed_at', 'outcome', 'failed', 'final', true, 'error', 'test_mode: not on the list')));
    t_name := t_name || text 'K a final failure stops the retries and keeps the reason for the admin';
    select * into iv from public.interview_assignments where application_id = a8;
    r := pg_temp.call_svc(pg_temp.rpc('vsat_interview_sync_claim', jsonb_build_object('application_ids', jsonb_build_array(a8))));
    t_det := t_det || (iv.meet_sync || '|' || iv.meet_attempts || '|' || coalesce(iv.meet_error, '-'));
    t_pass := t_pass || (iv.meet_sync = 'failed' and iv.meet_attempts >= 5 and iv.meet_error = 'test_mode: not on the list' and r = '[]'::jsonb);
    update public.interview_assignments set meet_sync = 'syncing', meet_claimed_at = now() - interval '10 minutes' where application_id = a8;
    r := pg_temp.call_svc(pg_temp.rpc('vsat_interview_sync_claim', jsonb_build_object('application_ids', jsonb_build_array(a8))));
    t_name := t_name || text 'K a claim left behind by a crashed run is taken over after 3 minutes'; t_det := t_det || (left(r::text, 120));
    t_pass := t_pass || (jsonb_array_length(r) = 1);

    -- ════ J. security + setup ════
    t_name := t_name || text 'J staff / student RPCs: authenticated only, security definer, empty search_path';
    select string_agg(p.proname, ',') into s from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname in ('vsat_assign_interview', 'vsat_schedule_interviews_bulk', 'vsat_cancel_interview',
                                                   'vsat_set_interview_attendance', 'vsat_interview_meet_retry', 'vsat_my_interview')
       and not (has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
                and p.prosecdef and p.proconfig = array['search_path=""']);
    t_det := t_det || (coalesce(s, 'all ok')); t_pass := t_pass || (s is null);
    t_name := t_name || text 'J server-only and private functions: no browser role can run them';
    select string_agg(p.proname, ',') into s from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname in ('vsat_interview_attendance_due', 'vsat_interview_attendance_apply', 'vsat_interview_notices_claim',
                                                   'vsat_interview_notice_done', 'vsat_interview_sync_claim', 'vsat_interview_sync_release', 'vsat__iv_ts', 'vsat__iv_dur', 'vsat__iv_busy_until', 'vsat__iv_event',
                                                   'vsat__iv_managed', 'vsat__iv_schedule', 'vsat__grid', 'vsat__grid_catalog')
       and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute')
            or p.proconfig is distinct from array['search_path=""']);
    t_det := t_det || (coalesce(s, 'all ok')); t_pass := t_pass || (s is null);
    t_name := t_name || text 'J the server role can run the server-only functions';
    select string_agg(p.proname, ',') into s from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname in ('vsat_interview_attendance_due', 'vsat_interview_attendance_apply', 'vsat_interview_notices_claim',
                                                   'vsat_interview_notice_done', 'vsat_interview_sync_claim', 'vsat_interview_sync_release')
       and not has_function_privilege('service_role', p.oid, 'execute');
    t_det := t_det || (coalesce(s, 'all ok')); t_pass := t_pass || (s is null);
    t_name := t_name || text 'J history table: RLS on, no browser access';
    t_det := t_det || (select relrowsecurity::text from pg_class where oid = 'public.vsat_interview_events'::regclass);
    t_pass := t_pass || ((select relrowsecurity from pg_class where oid = 'public.vsat_interview_events'::regclass)
                         and not has_table_privilege('authenticated', 'public.vsat_interview_events', 'select')
                         and not has_table_privilege('anon', 'public.vsat_interview_events', 'select'));
    t_name := t_name || text 'J 6 interview email steps exist, all off, test mode, email only';
    select format('%s|%s', count(*), bool_and(not enabled and test_mode and email_enabled and not wa_enabled)::text) into s
      from public.vsat_comm_steps where step_key like 'interview%';
    t_det := t_det || (s); t_pass := t_pass || (s = '6|true');
    t_name := t_name || text 'J existing interviews with a pasted link are own-link (no Google, no email)';
    select count(*) into n from public.interview_assignments a where a.meet_link is not null and a.meet_mode = 'auto' and a.calendar_event_id is null
       and a.application_id not like 'ZZT-%';
    t_det := t_det || (n::text); t_pass := t_pass || (n = 0);

    raise exception using errcode = 'ZDONE';
  exception when sqlstate 'ZDONE' then null;
  end;

  return query select x.n, x.p, x.d from unnest(t_name, t_pass, t_det) as x(n, p, d);
end $$;

select test, coalesce(pass, false) as pass, detail from pg_temp.run_vsat_interview_tests();

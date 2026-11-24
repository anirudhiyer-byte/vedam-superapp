-- VSAT interviews · booking from the Interview panel rows — tests for migration 0143 (STAGING ONLY)
--
-- How to run: paste this whole file into the staging SQL editor, or run it through the Supabase MCP.
-- The last statement returns one row per test: test | pass | detail.
-- Also run vsat_interview_scheduling.test.sql (0140): the booking rules themselves are tested there.
--
-- Nothing is left behind: all test data is created inside a block that is rolled back with a private
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

create or replace function pg_temp.rpc(p_fn text, p jsonb)
returns text language sql as $$ select format('select public.%I(%L::jsonb)', p_fn, p::text) $$;

create or replace function pg_temp.iso(t timestamptz)
returns text language sql as $$ select to_char(t at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') $$;

-- save what a row shows: interviewer (or null) + time (or null)
create or replace function pg_temp.draft(p_who uuid, p_app text, p_int uuid, p_t timestamptz)
returns jsonb language sql as $$
  select pg_temp.call_as(p_who, pg_temp.rpc('vsat_interview_draft_set',
    jsonb_build_object('application_id', p_app, 'interviewer_id', p_int::text, 'slot_datetime', pg_temp.iso(p_t))))
$$;

create or replace function pg_temp.plan(p_who uuid, p_apps text[])
returns jsonb language sql as $$
  select pg_temp.call_as(p_who, pg_temp.rpc('vsat_interview_plan', jsonb_build_object('application_ids', to_jsonb(p_apps))))
$$;

-- one student's plan entry (as the admin sees it)
create or replace function pg_temp.row1(p_who uuid, p_app text)
returns jsonb language sql as $$ select pg_temp.plan(p_who, array[p_app]) -> 0 $$;

create or replace function pg_temp.send(p_who uuid, p_apps text[])
returns jsonb language sql as $$
  select pg_temp.call_as(p_who, pg_temp.rpc('vsat_interview_drafts_send', jsonb_build_object('application_ids', to_jsonb(p_apps))))
$$;

create or replace function pg_temp.run_vsat_inline_tests()
returns table (test text, pass boolean, detail text) language plpgsql as $$
declare
  t_name text[] := '{}'; t_pass boolean[] := '{}'; t_det text[] := '{}';
  adm uuid; adm_pune uuid; int1 uuid; int2 uuid; int3 uuid; stu uuid; d uuid;
  a1 text; a2 text; a3 text; a4 text; a5 text; a6 text; a7 text; a8 text; g1 text; s1 text; s2 text;
  t0 timestamptz := date_trunc('hour', now()) + interval '3 days';
  r jsonb; s text; n int; iv public.interview_assignments;
  pune constant text := 'Ajeenkya DY Patil University — Pune';
  ggn constant text := 'Sushant University — Gurugram';
begin
  begin -- rolled back at the end (ZDONE)
    adm := pg_temp.mk_user('zztest-ivd-adm@example.invalid');
    adm_pune := pg_temp.mk_user('zztest-ivd-admpune@example.invalid');
    int1 := pg_temp.mk_user('zztest-ivd-int1@example.invalid');
    int2 := pg_temp.mk_user('zztest-ivd-int2@example.invalid');
    int3 := pg_temp.mk_user('zztest-ivd-int3@example.invalid');
    stu := pg_temp.mk_user('zztest-ivd-student@example.invalid');
    insert into public.vsat_team (user_id, role) values (adm, 'admissions'), (int1, 'interviewer'), (int2, 'interviewer');
    insert into public.vsat_team (user_id, role, active) values (int3, 'interviewer', false);
    insert into public.vsat_team (user_id, role, campus) values (adm_pune, 'admissions', 'pune');
    insert into public.vsat_exam_dates (label, wheebox_test_id, exam_date, start_at, end_at)
    values ('ZZTEST inline batch', 'zz-ivd', current_date, now(), now() + interval '2 hours') returning id into d;
    a1 := pg_temp.mk_app('ZZT-IVD-1', pune, d);
    a2 := pg_temp.mk_app('ZZT-IVD-2', pune, d);
    a3 := pg_temp.mk_app('ZZT-IVD-3', pune, d);
    a4 := pg_temp.mk_app('ZZT-IVD-4', pune, d);
    a5 := pg_temp.mk_app('ZZT-IVD-5', pune, d);
    a6 := pg_temp.mk_app('ZZT-IVD-6', pune, d);
    a7 := pg_temp.mk_app('ZZT-IVD-7', pune, d);
    a8 := pg_temp.mk_app('ZZT-IVD-8', pune, d);
    s1 := pg_temp.mk_app('ZZT-IVD-S1', pune, d);
    s2 := pg_temp.mk_app('ZZT-IVD-S2', pune, d);
    g1 := pg_temp.mk_app('ZZT-IVD-G1', ggn, d);

    -- ════ A. who may use it ════
    r := pg_temp.call_as(null, pg_temp.rpc('vsat_interview_plan', jsonb_build_object('application_ids', jsonb_build_array(a1))), true);
    t_name := t_name || text 'A anon cannot read the plan'; t_det := t_det || (r::text); t_pass := t_pass || (r->>'sqlstate' = '42501');
    r := pg_temp.plan(int1, array[a1]);
    t_name := t_name || text 'A an interviewer cannot read the plan'; t_det := t_det || (r::text); t_pass := t_pass || (r->>'message' = 'FORBIDDEN');
    r := pg_temp.plan(stu, array[a1]);
    t_name := t_name || text 'A a student cannot read the plan'; t_det := t_det || (r::text); t_pass := t_pass || (r->>'message' = 'FORBIDDEN');
    r := pg_temp.draft(int1, a1, int1, t0);
    t_name := t_name || text 'A an interviewer cannot type a row'; t_det := t_det || (r::text); t_pass := t_pass || (r->>'message' = 'FORBIDDEN');
    r := pg_temp.call_as(int1, pg_temp.rpc('vsat_interview_drafts_fill', jsonb_build_object('application_ids', jsonb_build_array(a1), 'interviewer_id', int1::text, 'start', pg_temp.iso(t0))));
    t_name := t_name || text 'A an interviewer cannot fill times'; t_det := t_det || (r::text); t_pass := t_pass || (r->>'message' = 'FORBIDDEN');
    r := pg_temp.send(int1, array[a1]);
    t_name := t_name || text 'A an interviewer cannot send'; t_det := t_det || (r::text); t_pass := t_pass || (r->>'message' = 'FORBIDDEN');
    r := pg_temp.plan(adm_pune, array[a1, g1]);
    t_name := t_name || text 'A Pune admissions: the Gurugram student is left out of the plan';
    t_det := t_det || (r::text); t_pass := t_pass || (jsonb_array_length(r) = 1 and r->0->>'application_id' = a1);
    r := pg_temp.draft(adm_pune, g1, int1, t0);
    t_name := t_name || text 'A Pune admissions cannot type a Gurugram row'; t_det := t_det || (r::text); t_pass := t_pass || (r->>'message' = 'FORBIDDEN');
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_interview_plan', '{"application_ids": ["x"], "evil": 1}'::jsonb));
    t_name := t_name || text 'A unknown request keys are refused'; t_det := t_det || (r::text); t_pass := t_pass || (r->>'message' = 'UNKNOWN_KEY: evil');
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_interview_plan', '{"application_ids": "x"}'::jsonb));
    t_name := t_name || text 'A application_ids must be a list'; t_det := t_det || (r::text); t_pass := t_pass || (r->>'message' = 'BAD_VALUE: application_ids');
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_interview_plan', '{"application_ids": [1]}'::jsonb));
    t_name := t_name || text 'A application_ids must be text'; t_det := t_det || (r::text); t_pass := t_pass || (r->>'message' = 'BAD_VALUE: application_ids');
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_interview_plan', jsonb_build_object('application_ids', (select jsonb_agg('ZZ-' || g) from generate_series(1, 101) g))));
    t_name := t_name || text 'A at most 100 rows per plan'; t_det := t_det || (r::text); t_pass := t_pass || (r->>'message' = 'BAD_VALUE: application_ids');
    r := pg_temp.send(adm, (select array_agg('ZZ-' || g) from generate_series(1, 41) g));
    t_name := t_name || text 'A at most 40 rows per send'; t_det := t_det || (r::text); t_pass := t_pass || (r->>'message' = 'BAD_VALUE: application_ids');

    -- ════ B. typing a row ════
    r := pg_temp.row1(adm, a1);
    t_name := t_name || text 'B a new student starts empty'; t_det := t_det || (r::text);
    t_pass := t_pass || (r->>'state' = 'empty' and r->'booked' = 'null'::jsonb and r->'draft' = 'null'::jsonb);
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_interview_draft_set', jsonb_build_object('application_id', a1, 'interviewer_id', int1::text, 'slot_datetime', null)));
    t_name := t_name || text 'B interviewer only → incomplete (saved)'; t_det := t_det || (r::text);
    t_pass := t_pass || (r->>'state' = 'incomplete' and r->'draft'->>'interviewer_id' = int1::text);
    r := pg_temp.draft(adm, a1, int1, t0);
    t_name := t_name || text 'B interviewer + future time → ready'; t_det := t_det || (r::text);
    t_pass := t_pass || (r->>'state' = 'ready' and r->>'problem' is null and (r->'draft'->>'slot')::timestamptz = t0);
    select count(*) into n from public.interview_assignments where application_id = a1;
    t_name := t_name || text 'B typing books nothing'; t_det := t_det || (n::text); t_pass := t_pass || (n = 0);
    r := pg_temp.draft(adm, a1, int3, t0);
    t_name := t_name || text 'B an inactive interviewer is refused'; t_det := t_det || (r::text); t_pass := t_pass || (r->>'message' = 'NOT_AN_INTERVIEWER');
    r := pg_temp.draft(adm, a1, stu, t0);
    t_name := t_name || text 'B someone who is not an interviewer is refused'; t_det := t_det || (r::text); t_pass := t_pass || (r->>'message' = 'NOT_AN_INTERVIEWER');
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_interview_draft_set', jsonb_build_object('application_id', a1, 'interviewer_id', 'not-a-uuid', 'slot_datetime', null)));
    t_name := t_name || text 'B a bad interviewer id is refused'; t_det := t_det || (r::text); t_pass := t_pass || (r->>'message' = 'BAD_VALUE: interviewer_id');
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_interview_draft_set', jsonb_build_object('application_id', a1, 'interviewer_id', int1::text, 'slot_datetime', 'tomorrow')));
    t_name := t_name || text 'B a time that is not ISO is refused'; t_det := t_det || (r::text); t_pass := t_pass || (r->>'message' = 'BAD_VALUE: slot_datetime');
    r := pg_temp.draft(adm, a1, int1, now() + interval '400 days');
    t_name := t_name || text 'B a time more than a year away is refused'; t_det := t_det || (r::text); t_pass := t_pass || (r->>'message' = 'BAD_VALUE: slot_datetime');
    r := pg_temp.draft(adm, a1, int1, t0);
    t_name := t_name || text 'B refused values keep the last saved row'; t_det := t_det || (r::text);
    t_pass := t_pass || (r->>'state' = 'ready' and r->'draft'->>'interviewer_id' = int1::text);
    r := pg_temp.draft(adm, a8, int1, now() - interval '2 hours');
    t_name := t_name || text 'B a time in the past is saved but flagged SLOT_IN_PAST'; t_det := t_det || (r::text);
    t_pass := t_pass || (r->>'state' = 'problem' and r->>'problem' = 'SLOT_IN_PAST');
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_interview_draft_set', jsonb_build_object('application_id', a8, 'interviewer_id', null, 'slot_datetime', null)));
    t_name := t_name || text 'B clearing both → empty and nothing kept'; t_det := t_det || (r::text);
    t_pass := t_pass || (r->>'state' = 'empty' and not exists (select 1 from public.vsat_interview_drafts where application_id = a8));
    update public.vsat_pipeline set status = 'not_selected' where application_id = a8;
    r := pg_temp.draft(adm, a8, int1, t0 + interval '1 day');
    t_name := t_name || text 'B a not-selected student cannot be typed (WRONG_STAGE)'; t_det := t_det || (r::text); t_pass := t_pass || (r->>'message' = 'WRONG_STAGE');
    r := pg_temp.row1(adm, a8);
    t_name := t_name || text 'B a not-selected student shows as locked'; t_det := t_det || (r::text); t_pass := t_pass || (r->>'state' = 'locked');
    update public.vsat_pipeline set status = 'active' where application_id = a8;

    -- ════ C. clashes ════
    r := pg_temp.draft(adm, a2, int1, t0 + interval '15 minutes');
    t_name := t_name || text 'C two typed rows of one interviewer that overlap → both CLASH, naming each other';
    t_det := t_det || (r::text || ' | ' || pg_temp.row1(adm, a1)::text);
    t_pass := t_pass || (r->>'problem' = 'CLASH' and r->'clash_with'->>'application_id' = a1 and r->'clash_with'->>'name' = 'ZZTEST ' || a1
                         and pg_temp.row1(adm, a1)->>'problem' = 'CLASH' and pg_temp.row1(adm, a1)->'clash_with'->>'application_id' = a2);
    r := pg_temp.draft(adm, a2, int2, t0 + interval '15 minutes');
    t_name := t_name || text 'C another interviewer at the same time is fine'; t_det := t_det || (r::text);
    t_pass := t_pass || (r->>'state' = 'ready' and pg_temp.row1(adm, a1)->>'state' = 'ready');
    r := pg_temp.draft(adm, a2, int1, t0 + interval '30 minutes');
    t_name := t_name || text 'C back to back (ends 10:30, next 10:30) is fine'; t_det := t_det || (r::text); t_pass := t_pass || (r->>'state' = 'ready');
    -- a booking of int1 + a typed row on top of it
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_assign_interview', jsonb_build_object('application_id', a3, 'interviewer_id', int1::text,
                                    'slot_datetime', pg_temp.iso(t0 + interval '1 day'), 'auto_meet', true)));
    r := pg_temp.draft(adm, a4, int1, t0 + interval '1 day 10 minutes');
    t_name := t_name || text 'C a typed row on top of a booking → CLASH with the booked student'; t_det := t_det || (r::text);
    t_pass := t_pass || (r->>'problem' = 'CLASH' and r->'clash_with'->>'application_id' = a3);
    r := pg_temp.row1(adm, a3);
    t_name := t_name || text 'C the booked student shows as booked (with its values)'; t_det := t_det || (r::text);
    t_pass := t_pass || (r->>'state' = 'booked' and r->'booked'->>'interviewer_id' = int1::text and (r->'booked'->>'duration_min')::int = 30);
    r := pg_temp.draft(adm, a3, int1, t0 + interval '1 day');
    t_name := t_name || text 'C typing the same values as the booking keeps nothing (booked)'; t_det := t_det || (r::text);
    t_pass := t_pass || (r->>'state' = 'booked' and not exists (select 1 from public.vsat_interview_drafts where application_id = a3));
    r := pg_temp.draft(adm, a3, int1, t0 + interval '1 day 2 hours');
    t_name := t_name || text 'C a booked student with a new time → changed'; t_det := t_det || (r::text); t_pass := t_pass || (r->>'state' = 'changed');
    r := pg_temp.row1(adm, a4);
    t_name := t_name || text 'C the booked student moving away frees the time (effective plan) → ready'; t_det := t_det || (r::text);
    t_pass := t_pass || (r->>'state' = 'ready');
    r := pg_temp.draft(adm, g1, int1, t0 + interval '5 days');
    r := pg_temp.draft(adm, a8, int1, t0 + interval '5 days');
    t_name := t_name || text 'C Pune admissions sees a clash with a Gurugram student without the name';
    t_det := t_det || (pg_temp.row1(adm_pune, a8)::text);
    t_pass := t_pass || (pg_temp.row1(adm_pune, a8)->>'problem' = 'CLASH' and pg_temp.row1(adm_pune, a8)->'clash_with'->>'name' is null
                         and pg_temp.row1(adm_pune, a8)->'clash_with'->>'application_id' is null
                         and pg_temp.row1(adm, a8)->'clash_with'->>'application_id' = g1);

    -- ════ D. send ════
    r := pg_temp.send(adm, array[g1, a8]);
    t_name := t_name || text 'D clashing rows are not sent (CLASH), nothing booked'; t_det := t_det || (r::text);
    t_pass := t_pass || (jsonb_array_length(r->'sent') = 0 and jsonb_array_length(r->'skipped') = 2 and r->'skipped'->0->>'code' = 'CLASH'
                         and not exists (select 1 from public.interview_assignments where application_id in (g1, a8)));
    r := pg_temp.send(adm_pune, array[g1]);
    t_name := t_name || text 'D Pune admissions cannot send a Gurugram row'; t_det := t_det || (r::text);
    t_pass := t_pass || (r->'skipped'->0->>'code' = 'FORBIDDEN' and jsonb_array_length(r->'sent') = 0);
    r := pg_temp.send(adm, array[a5]);
    t_name := t_name || text 'D a row with nothing typed is skipped (NO_DRAFT)'; t_det := t_det || (r::text); t_pass := t_pass || (r->'skipped'->0->>'code' = 'NO_DRAFT');
    r := pg_temp.send(adm, array[a1, a2]);
    t_name := t_name || text 'D two ready rows are booked with their own times (scheduled)'; t_det := t_det || (r::text);
    t_pass := t_pass || (jsonb_array_length(r->'sent') = 2 and r->'sent'->0->>'kind' = 'scheduled' and r->'sent'->1->>'kind' = 'scheduled'
                         and (select slot_datetime from public.interview_assignments where application_id = a1) = t0
                         and (select slot_datetime from public.interview_assignments where application_id = a2) = t0 + interval '30 minutes');
    select * into iv from public.interview_assignments where application_id = a1;
    t_name := t_name || text 'D a sent row: Google Meet queued, 30 min, typed values cleared (0164: stage stays VSAT cleared)';
    t_det := t_det || (format('%s|%s|%s|%s', iv.meet_mode, iv.meet_sync, iv.duration_min, (select stage from public.vsat_pipeline where application_id = a1)));
    t_pass := t_pass || (iv.meet_mode = 'auto' and iv.meet_sync = 'pending' and iv.duration_min = 30
                         and (select stage from public.vsat_pipeline where application_id = a1) = 'vsat_cleared'
                         and not exists (select 1 from public.vsat_interview_drafts where application_id in (a1, a2)));
    select count(*) into n from public.vsat_interview_events where application_id in (a1, a2) and kind = 'scheduled' and source = 'bulk' and notify_status = 'pending';
    t_name := t_name || text 'D each sent row has its own email job (invite)'; t_det := t_det || (n::text); t_pass := t_pass || (n = 2);
    -- a4 wants a3's old time; a3 moves away in the same send, listed AFTER a4
    r := pg_temp.send(adm, array[a4, a3]);
    t_name := t_name || text 'D rows wait for each other: a4 takes a3''s old time once a3 has moved (one send)'; t_det := t_det || (r::text);
    t_pass := t_pass || (jsonb_array_length(r->'sent') = 2 and jsonb_array_length(r->'skipped') = 0
                         and (select slot_datetime from public.interview_assignments where application_id = a4) = t0 + interval '1 day 10 minutes'
                         and (select slot_datetime from public.interview_assignments where application_id = a3) = t0 + interval '1 day 2 hours');
    select count(*) into n from public.vsat_interview_events where application_id = a3 and kind = 'rescheduled';
    t_name := t_name || text 'D the booked student who moved gets a "moved" email job'; t_det := t_det || (n::text); t_pass := t_pass || (n = 1);
    -- own-link booking moved from the row keeps its own link
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_assign_interview', jsonb_build_object('application_id', a6, 'interviewer_id', int2::text,
                                    'slot_datetime', pg_temp.iso(t0 + interval '2 days'), 'meet_link', 'https://zoom.us/j/zztest6')));
    r := pg_temp.draft(adm, a6, int2, t0 + interval '2 days 1 hour');
    r := pg_temp.send(adm, array[a6]);
    select * into iv from public.interview_assignments where application_id = a6;
    t_name := t_name || text 'D an own-link booking moved from the row keeps its own link'; t_det := t_det || (r::text || ' | ' || iv.meet_mode || ' ' || coalesce(iv.meet_link, '-'));
    t_pass := t_pass || (r->'sent'->0->>'kind' = 'rescheduled' and iv.meet_mode = 'manual' and iv.meet_link = 'https://zoom.us/j/zztest6');
    -- swap: two booked students exchanging times can't be done in one send (each waits for the other)
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_assign_interview', jsonb_build_object('application_id', s1, 'interviewer_id', int2::text,
                                    'slot_datetime', pg_temp.iso(t0 + interval '4 days'), 'auto_meet', true)));
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_assign_interview', jsonb_build_object('application_id', s2, 'interviewer_id', int2::text,
                                    'slot_datetime', pg_temp.iso(t0 + interval '4 days 1 hour'), 'auto_meet', true)));
    r := pg_temp.draft(adm, s1, int2, t0 + interval '4 days 1 hour');
    r := pg_temp.draft(adm, s2, int2, t0 + interval '4 days');
    r := pg_temp.send(adm, array[s1, s2]);
    t_name := t_name || text 'D a swap of two booked times is refused (SLOT_TAKEN), both keep their old times'; t_det := t_det || (r::text);
    t_pass := t_pass || (jsonb_array_length(r->'sent') = 0 and r->'skipped'->0->>'code' = 'SLOT_TAKEN' and r->'skipped'->1->>'code' = 'SLOT_TAKEN'
                         and (select slot_datetime from public.interview_assignments where application_id = s1) = t0 + interval '4 days');

    -- ════ E. fill times ════
    -- int2 is busy at t0+6d 10:30 (a booking); fill a5, a6 (booked → skipped), a7 from t0+6d 10:00
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_assign_interview', jsonb_build_object('application_id', a8, 'interviewer_id', int2::text,
                                    'slot_datetime', pg_temp.iso(t0 + interval '6 days 30 minutes'), 'auto_meet', true)));
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_interview_drafts_fill', jsonb_build_object('application_ids', jsonb_build_array(a5, a6, a7),
                                    'interviewer_id', int2::text, 'start', pg_temp.iso(t0 + interval '6 days'))));
    t_name := t_name || text 'E fill: back to back, busy time skipped, booked student skipped'; t_det := t_det || (r::text);
    t_pass := t_pass || (jsonb_array_length(r->'filled') = 2 and (r->'filled'->0->>'slot')::timestamptz = t0 + interval '6 days'
                         and (r->'filled'->1->>'slot')::timestamptz = t0 + interval '6 days 1 hour'
                         and r->'skipped'->0->>'application_id' = a6 and r->'skipped'->0->>'code' = 'ALREADY_SCHEDULED');
    t_name := t_name || text 'E fill only types the rows (nothing booked)';
    select count(*) into n from public.interview_assignments where application_id in (a5, a7);
    t_det := t_det || (n::text || ' ' || (pg_temp.row1(adm, a5)->>'state'));
    t_pass := t_pass || (n = 0 and pg_temp.row1(adm, a5)->>'state' = 'ready' and pg_temp.row1(adm, a7)->>'state' = 'ready');
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_interview_drafts_fill', jsonb_build_object('application_ids', jsonb_build_array(a5, a7),
                                    'interviewer_id', int2::text, 'start', pg_temp.iso(t0 + interval '6 days'))));
    t_name := t_name || text 'E filling the same rows again gives the same times (they don''t block themselves)'; t_det := t_det || (r::text);
    t_pass := t_pass || ((r->'filled'->0->>'slot')::timestamptz = t0 + interval '6 days' and (r->'filled'->1->>'slot')::timestamptz = t0 + interval '6 days 1 hour');
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_interview_drafts_fill', jsonb_build_object('application_ids', jsonb_build_array(a5),
                                    'interviewer_id', int2::text, 'start', pg_temp.iso(now() - interval '1 hour'))));
    t_name := t_name || text 'E fill from a past time is refused'; t_det := t_det || (r::text); t_pass := t_pass || (r->>'message' = 'SLOT_IN_PAST');
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_interview_drafts_fill', jsonb_build_object('application_ids', jsonb_build_array(a5),
                                    'interviewer_id', int3::text, 'start', pg_temp.iso(t0))));
    t_name := t_name || text 'E fill with an inactive interviewer is refused'; t_det := t_det || (r::text); t_pass := t_pass || (r->>'message' = 'NOT_AN_INTERVIEWER');
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_interview_drafts_fill', jsonb_build_object('application_ids', jsonb_build_array(a5),
                                    'interviewer_id', int2::text, 'start', pg_temp.iso(t0), 'dry_run', true)));
    t_name := t_name || text 'E fill refuses unknown keys'; t_det := t_det || (r::text); t_pass := t_pass || (r->>'message' = 'UNKNOWN_KEY: dry_run');

    -- ════ F. typed values are cleared by any other change ════
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_assign_interview', jsonb_build_object('application_id', a5, 'interviewer_id', int1::text,
                                    'slot_datetime', pg_temp.iso(t0 + interval '7 days'), 'auto_meet', true)));
    t_name := t_name || text 'F booking from the student page clears the typed row';
    t_det := t_det || (pg_temp.row1(adm, a5)::text);
    t_pass := t_pass || (not exists (select 1 from public.vsat_interview_drafts where application_id = a5) and pg_temp.row1(adm, a5)->>'state' = 'booked');
    r := pg_temp.draft(adm, a5, int1, t0 + interval '7 days 3 hours');
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_cancel_interview', jsonb_build_object('application_id', a5, 'reason', 'zz test cancel')));
    t_name := t_name || text 'F cancelling clears the typed row'; t_det := t_det || (pg_temp.row1(adm, a5)::text);
    t_pass := t_pass || (not exists (select 1 from public.vsat_interview_drafts where application_id = a5) and pg_temp.row1(adm, a5)->>'state' = 'empty');
    r := pg_temp.draft(adm, a7, int1, t0 + interval '8 days');
    delete from public.vsat_pipeline where application_id = a7;
    t_name := t_name || text 'F removing a student from the pipeline removes the typed row';
    select count(*) into n from public.vsat_interview_drafts where application_id = a7;
    t_det := t_det || (n::text); t_pass := t_pass || (n = 0);

    -- ════ G. access rules in the database ════
    t_name := t_name || text 'G typed-values table: RLS on, no browser access';
    t_det := t_det || ((select relrowsecurity::text from pg_class where oid = 'public.vsat_interview_drafts'::regclass));
    t_pass := t_pass || ((select relrowsecurity from pg_class where oid = 'public.vsat_interview_drafts'::regclass)
                         and not has_table_privilege('authenticated', 'public.vsat_interview_drafts', 'select')
                         and not has_table_privilege('authenticated', 'public.vsat_interview_drafts', 'insert')
                         and not has_table_privilege('anon', 'public.vsat_interview_drafts', 'select'));
    t_name := t_name || text 'G staff functions: signed-in only, security definer, empty search_path';
    select string_agg(p.proname, ',') into s from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname in ('vsat_interview_plan', 'vsat_interview_draft_set', 'vsat_interview_drafts_fill', 'vsat_interview_drafts_send')
       and not (has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
                and p.prosecdef and p.proconfig = array['search_path=""']);
    t_det := t_det || (coalesce(s, 'all ok')); t_pass := t_pass || (s is null);
    select count(*) into n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname in ('vsat_interview_plan', 'vsat_interview_draft_set', 'vsat_interview_drafts_fill', 'vsat_interview_drafts_send');
    t_name := t_name || text 'G all 4 staff functions exist'; t_det := t_det || (n::text); t_pass := t_pass || (n = 4);
    t_name := t_name || text 'G helpers: no browser role can run them';
    select string_agg(p.proname, ',') into s from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname in ('vsat__iv_ids', 'vsat__iv_eff_busy', 'vsat__iv_drafts_clear')
       and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute')
            or p.proconfig is distinct from array['search_path=""']);
    t_det := t_det || (coalesce(s, 'all ok')); t_pass := t_pass || (s is null);

    raise exception using errcode = 'ZDONE';
  exception when sqlstate 'ZDONE' then null;
  end;

  return query select x.n, x.p, x.d from unnest(t_name, t_pass, t_det) as x(n, p, d);
end $$;

select test, coalesce(pass, false) as pass, detail from pg_temp.run_vsat_inline_tests();

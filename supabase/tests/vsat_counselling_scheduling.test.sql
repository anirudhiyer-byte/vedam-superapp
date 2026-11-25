-- VSAT counselling scheduling (Google Meet, row booking, attendance, emails) — tests for migration 0145 (STAGING ONLY)
--
-- How to run: paste this whole file into the staging SQL editor, or run it through the Supabase MCP.
-- The last statement returns one row per test: test | pass | detail.
-- The rules are the interview ones (0140 / 0143, tested in vsat_interview_scheduling / vsat_interview_inline_schedule);
-- this file checks they hold for counselling: table, stage, role, link column, student view, server jobs and access.
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

-- applicant at "pi_cleared" (the student's login id is returned through the lead)
create or replace function pg_temp.mk_app(p_id text, p_campus text, p_date uuid)
returns text language plpgsql as $$
declare u uuid := pg_temp.mk_user(lower(p_id) || '@example.invalid'); s text;
begin
  insert into public.lead_manager (lead_id, registered_name, registered_email, lead_stage) values (u, 'ZZTEST ' || p_id, lower(p_id) || '@example.invalid', 'applicant_paid')
  on conflict (lead_id) do nothing;
  insert into public.application_manager (application_id, lead_id, application_no, registered_name, registered_email, campus_applied, exam_date_id,
    class10_year, class10_percentage, class10_maths_percentage, class12_year, class12_percentage, class12_maths_percentage,
    marks_physics_12, marks_chemistry_12, marks_maths_12, exam_percentile, exam_obtained_marks, exam_max_marks, vps_score)
  values (p_id, u, p_id, 'ZZTEST ' || p_id, lower(p_id) || '@example.invalid', p_campus, p_date,
    2024, 90, 85, 2026, 80, 70, 70, 70, 70, 80, 40, 50, 8.43);
  update public.application_manager set counselling_mode = 'online', counselling_mode_at = now() where application_id = p_id;  -- 0184 test setup: counselling is booked for online students only
  update public.application_manager set exam_given = true where application_id = p_id;
  foreach s in array array['vsat_cleared', 'interview_scheduled', 'interviewed', 'pi_cleared'] loop
    perform public.vsat__move(p_id, s, 'active', 'zz test', 'system', null, null);
  end loop;
  return p_id;
end $$;

create or replace function pg_temp.lead_of(p_app text)
returns uuid language sql as $$ select am.lead_id from public.application_manager am where am.application_id = p_app $$;

create or replace function pg_temp.call_as(p_uid uuid, p_sql text, p_role text default 'authenticated')
returns jsonb language plpgsql as $$
declare r jsonb;
begin
  if p_role = 'anon' then
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    set local role anon;
  elsif p_role = 'service_role' then
    perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
    set local role service_role;
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

create or replace function pg_temp.assign(p_who uuid, p_app text, p_cs uuid, p_t timestamptz, p_extra jsonb default '{}'::jsonb)
returns jsonb language sql as $$
  select pg_temp.call_as(p_who, pg_temp.rpc('vsat_assign_counsellor',
    jsonb_build_object('application_id', p_app, 'counsellor_id', p_cs::text, 'slot_datetime', pg_temp.iso(p_t)) || p_extra))
$$;

create or replace function pg_temp.stage(p_app text)
returns text language sql as $$ select vp.stage || ':' || vp.status from public.vsat_pipeline vp where vp.application_id = p_app $$;

create or replace function pg_temp.ca(p_app text)
returns public.counselling_assignments language sql as $$
  select a from public.counselling_assignments a join public.vsat_pipeline vp on vp.application_id = a.application_id and vp.attempt_no = a.attempt_no
   where a.application_id = p_app $$;

-- 0166: booking no longer moves the stage, so admissions moves it by hand (as staff do now)
create or replace function pg_temp.move_to(p_adm uuid, p_app text, p_stage text)
returns jsonb language sql as $$
  select pg_temp.call_as(p_adm, pg_temp.rpc('vsat_move_stage', jsonb_build_object('application_id', p_app, 'to_stage', p_stage)))
$$;

create or replace function pg_temp.run_vsat_cs_tests()
returns table (test text, pass boolean, detail text) language plpgsql as $$
declare
  t_name text[] := '{}'; t_pass boolean[] := '{}'; t_det text[] := '{}';
  adm uuid; adm_ggn uuid; cs1 uuid; cs2 uuid; cs_off uuid; intv uuid; d uuid;
  a1 text; a2 text; a3 text; a4 text; a5 text; a6 text; a7 text; g1 text;
  t0 timestamptz := date_trunc('hour', now()) + interval '3 days';
  r jsonb; r2 jsonb; s text; n int; c public.counselling_assignments;
  pune constant text := 'Ajeenkya DY Patil University — Pune';
  ggn constant text := 'Sushant University — Gurugram';
begin
  begin -- rolled back at the end (ZDONE)
    adm := pg_temp.mk_user('zztest-cs-adm@example.invalid');
    adm_ggn := pg_temp.mk_user('zztest-cs-admggn@example.invalid');
    cs1 := pg_temp.mk_user('zztest-cs-c1@example.invalid');
    cs2 := pg_temp.mk_user('zztest-cs-c2@example.invalid');
    cs_off := pg_temp.mk_user('zztest-cs-coff@example.invalid');
    intv := pg_temp.mk_user('zztest-cs-int@example.invalid');
    insert into public.vsat_team (user_id, role) values (adm, 'admissions'), (cs1, 'counsellor'), (cs2, 'counsellor'), (intv, 'interviewer');
    insert into public.vsat_counsellor_zoom (counsellor_id, zoom_link) values (cs1, 'https://zoom.us/j/zztest-cs1'), (cs2, 'https://zoom.us/j/zztest-cs2');  -- 0184 test setup: counselling runs on the counsellor's own Zoom link
    insert into public.vsat_team (user_id, role, active) values (cs_off, 'counsellor', false);
    insert into public.vsat_counsellor_zoom (counsellor_id, zoom_link) values (cs_off, 'https://zoom.us/j/zztest-cs-off');  -- 0184 test setup: counselling runs on the counsellor's own Zoom link
    insert into public.vsat_team (user_id, role, campus) values (adm_ggn, 'admissions', 'gurugram');
    insert into public.vsat_exam_dates (label, wheebox_test_id, exam_date, start_at, end_at)
    values ('ZZTEST counselling batch', 'zz-cs', current_date, now(), now() + interval '2 hours') returning id into d;
    a1 := pg_temp.mk_app('ZZT-CS-1', pune, d);
    a2 := pg_temp.mk_app('ZZT-CS-2', pune, d);
    a3 := pg_temp.mk_app('ZZT-CS-3', pune, d);
    a4 := pg_temp.mk_app('ZZT-CS-4', pune, d);
    a5 := pg_temp.mk_app('ZZT-CS-5', pune, d);
    a6 := pg_temp.mk_app('ZZT-CS-6', pune, d);
    a7 := pg_temp.mk_app('ZZT-CS-7', pune, d);
    g1 := pg_temp.mk_app('ZZT-CS-G1', ggn, d);

    -- ════ A. one student from the drawer (vsat_assign_counsellor) ════
    r := pg_temp.assign(adm, a1, cs1, t0, '{"auto_meet": true}');
    c := pg_temp.ca(a1);
    t_name := t_name || text 'A booking on the counsellor''s Zoom link (0184): calendar work queued, 30 min (0166: stage stays PI cleared)';
    t_det := t_det || (format('%s mode=%s sync=%s dur=%s ver=%s link=%s', pg_temp.stage(a1), c.meet_mode, c.meet_sync, c.duration_min, c.version, c.zoom_link));
    t_pass := t_pass || (pg_temp.stage(a1) = 'pi_cleared:active' and c.meet_mode = 'zoom' and c.meet_sync = 'pending'
                         and c.duration_min = 30 and c.version = 1 and c.counsellor_id = cs1 and c.zoom_link = 'https://zoom.us/j/zztest-cs1');
    t_name := t_name || text 'A history + one email job (scheduled)';
    select string_agg(kind || '/' || notify_status, ',') into s from public.vsat_counselling_events where application_id = a1;
    t_det := t_det || (coalesce(s, '∅')); t_pass := t_pass || (s = 'scheduled/pending');

    r := pg_temp.assign(adm, a2, cs1, t0 + interval '15 minutes');
    t_name := t_name || text 'A overlapping time for the same counsellor → refused'; t_det := t_det || (r::text);
    t_pass := t_pass || (r->>'message' = 'SLOT_TAKEN' and pg_temp.stage(a2) = 'pi_cleared:active');
    r := pg_temp.assign(adm, a2, cs1, now() - interval '1 hour');
    t_name := t_name || text 'A a time in the past → refused'; t_det := t_det || (r::text);
    t_pass := t_pass || (r->>'message' = 'SLOT_IN_PAST');
    r := pg_temp.assign(adm, a2, cs_off, t0 + interval '2 hours');
    t_name := t_name || text 'A an inactive counsellor → refused'; t_det := t_det || (r::text);
    t_pass := t_pass || (r->>'message' = 'NOT_A_COUNSELLOR');
    r := pg_temp.assign(adm, a2, intv, t0 + interval '2 hours');
    t_name := t_name || text 'A an interviewer is not a counsellor'; t_det := t_det || (r::text);
    t_pass := t_pass || (r->>'message' = 'NOT_A_COUNSELLOR');
    r := pg_temp.assign(adm, a2, cs1, t0 + interval '1 hour', '{"meeting_link": "https://zoom.us/j/123"}');
    c := pg_temp.ca(a2);
    t_name := t_name || text 'A a pasted link is refused (0167: Google Meet only); nothing booked';
    t_det := t_det || (format('%s | %s', coalesce(r->>'message', 'not refused'), coalesce(c.id::text, 'no row')));
    t_pass := t_pass || (r->>'message' = 'BAD_VALUE: meet_link' and c.id is null);
    r := pg_temp.assign(adm, a1, cs2, t0 + interval '2 hours', '{"duration_min": 45}');
    c := pg_temp.ca(a1);
    t_name := t_name || text 'A move: new counsellor, time and length; rescheduled event, now on the new counsellor''s Zoom link (0184)';
    select string_agg(kind, ',' order by version) into s from public.vsat_counselling_events where application_id = a1;
    t_det := t_det || (format('%s ver=%s dur=%s mode=%s link=%s', s, c.version, c.duration_min, c.meet_mode, c.zoom_link));
    t_pass := t_pass || (s = 'scheduled,rescheduled' and c.version = 2 and c.duration_min = 45 and c.counsellor_id = cs2 and c.meet_mode = 'zoom'
                         and c.zoom_link = 'https://zoom.us/j/zztest-cs2');
    r := pg_temp.assign(cs1, a3, cs1, t0 + interval '5 hours');
    t_name := t_name || text 'A a counsellor cannot book'; t_det := t_det || (r::text);
    t_pass := t_pass || (r->>'message' = 'FORBIDDEN' and pg_temp.stage(a3) = 'pi_cleared:active');
    r := pg_temp.assign(adm_ggn, a3, cs1, t0 + interval '5 hours');
    t_name := t_name || text 'A campus rule: Gurugram admissions cannot book a Pune student'; t_det := t_det || (r::text);
    t_pass := t_pass || (r->>'message' = 'FORBIDDEN');
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_assign_counsellor', jsonb_build_object('application_id', a3, 'counsellor_id', cs1, 'slot_datetime', 'tomorrow')));
    t_name := t_name || text 'A only a real ISO time is accepted'; t_det := t_det || (r::text);
    t_pass := t_pass || (r->>'message' = 'BAD_VALUE: slot_datetime');

    -- ════ B. booking from the rows (plan / typed values / fill / send) ════
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_counselling_draft_set', jsonb_build_object('application_id', a3, 'counsellor_id', cs1, 'slot_datetime', pg_temp.iso(t0 + interval '1 day'))));
    t_name := t_name || text 'B typed row: ready, nothing booked yet'; t_det := t_det || (r::text);
    t_pass := t_pass || (r->>'state' = 'ready' and r->'draft'->>'counsellor_id' = cs1::text and pg_temp.stage(a3) = 'pi_cleared:active');
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_counselling_draft_set', jsonb_build_object('application_id', a4, 'counsellor_id', cs1, 'slot_datetime', pg_temp.iso(t0 + interval '1 day 10 minutes'))));
    t_name := t_name || text 'B two typed rows on top of each other → clash shown'; t_det := t_det || (r::text);
    t_pass := t_pass || (r->>'state' = 'problem' and r->>'problem' = 'CLASH' and r->'clash_with'->>'application_id' = a3);
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_counselling_drafts_fill', jsonb_build_object('application_ids', jsonb_build_array(a4, a5), 'counsellor_id', cs2, 'start', pg_temp.iso(t0 + interval '1 day'))));
    t_name := t_name || text 'B Fill times: back to back for the selection'; t_det := t_det || (r::text);
    t_pass := t_pass || (jsonb_array_length(r->'filled') = 2
                         and (r->'filled'->1->>'slot')::timestamptz - (r->'filled'->0->>'slot')::timestamptz = interval '30 minutes');
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_counselling_drafts_send', jsonb_build_object('application_ids', jsonb_build_array(a3, a4, a5, a6))));
    t_name := t_name || text 'B one Send books every ready row; an empty row is left out (NO_DRAFT); 0166: stages stay';
    t_pass := t_pass || (jsonb_array_length(r->'sent') = 3 and r->'skipped'->0->>'code' = 'NO_DRAFT'
                         and pg_temp.stage(a3) = 'pi_cleared:active' and pg_temp.stage(a5) = 'pi_cleared:active');
    t_det := t_det || (r::text || ' ' || pg_temp.stage(a3) || ' ' || pg_temp.stage(a5));
    t_name := t_name || text 'B booked rows: typed values cleared, Google work + email queued';
    select count(*) into n from public.vsat_counselling_drafts where application_id in (a3, a4, a5);
    t_det := t_det || (format('drafts=%s mode=%s jobs=%s', n, (pg_temp.ca(a3)).meet_mode,
                              (select count(*) from public.vsat_counselling_events where application_id in (a3, a4, a5) and notify_status = 'pending')));
    t_pass := t_pass || (n = 0 and (pg_temp.ca(a3)).meet_mode = 'zoom' and (pg_temp.ca(a3)).meet_sync = 'pending'  -- 0184: Zoom, not Google Meet
                         and (select count(*) from public.vsat_counselling_events where application_id in (a3, a4, a5) and notify_status = 'pending') = 3);
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_counselling_plan', jsonb_build_object('application_ids', jsonb_build_array(a3, g1))));
    t_name := t_name || text 'B plan: booked row shows the booking (counsellor_id key)'; t_det := t_det || (r::text);
    t_pass := t_pass || (r->0->>'state' = 'booked' and r->0->'booked'->>'counsellor_id' = cs1::text);
    r := pg_temp.call_as(adm_ggn, pg_temp.rpc('vsat_counselling_plan', jsonb_build_object('application_ids', jsonb_build_array(a3, g1))));
    t_name := t_name || text 'B plan: another campus is left out'; t_det := t_det || (r::text);
    t_pass := t_pass || (jsonb_array_length(r) = 1 and r->0->>'application_id' = g1);
    -- 0166: admissions moves the booked students to Counselling scheduled by hand (a5 is left at PI cleared)
    t_name := t_name || text 'B admissions moves the booked students to counselling_scheduled by hand';
    s := coalesce(pg_temp.move_to(adm, a1, 'counselling_scheduled')->>'message', 'ok') || ' | '
      || coalesce(pg_temp.move_to(adm, a3, 'counselling_scheduled')->>'message', 'ok') || ' | '
      || coalesce(pg_temp.move_to(adm, a4, 'counselling_scheduled')->>'message', 'ok');
    t_det := t_det || s;
    t_pass := t_pass || (pg_temp.stage(a1) = 'counselling_scheduled:active' and pg_temp.stage(a3) = 'counselling_scheduled:active'
                         and pg_temp.stage(a4) = 'counselling_scheduled:active');

    -- ════ C. cancel and attendance ════
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_cancel_counselling', jsonb_build_object('application_id', a5, 'reason', 'zz student asked')));
    c := pg_temp.ca(a5);
    t_name := t_name || text 'C cancel: slot removed, stage stays PI cleared (0166), Google event removal queued, cancel email job';
    select string_agg(kind || '/' || notify_status, ',' order by version) into s from public.vsat_counselling_events where application_id = a5;
    t_det := t_det || (format('%s %s %s %s', pg_temp.stage(a5), c.slot_datetime, c.cancel_reason, s));
    t_pass := t_pass || (pg_temp.stage(a5) = 'pi_cleared:active' and c.slot_datetime is null and c.cancelled_at is not null
                         and s like '%cancelled/pending');
    r := pg_temp.call_as(cs1, pg_temp.rpc('vsat_set_counselling_attendance', jsonb_build_object('application_id', a3, 'attendance', 'done')));
    t_name := t_name || text 'C attendance before the start → refused'; t_det := t_det || (r::text);
    t_pass := t_pass || (r->>'message' = 'TOO_EARLY');
    update public.counselling_assignments set slot_datetime = now() - interval '1 hour' where application_id in (a3, a4);
    r := pg_temp.call_as(cs1, pg_temp.rpc('vsat_set_counselling_attendance', jsonb_build_object('application_id', a3, 'attendance', 'done')));
    t_name := t_name || text 'C the assigned counsellor marks the first attendance'; t_det := t_det || ((pg_temp.ca(a3)).attendance::text);
    t_pass := t_pass || ((pg_temp.ca(a3)).attendance::text = 'done' and (pg_temp.ca(a3)).attendance_source = 'manual');
    r := pg_temp.call_as(cs1, pg_temp.rpc('vsat_set_counselling_attendance', jsonb_build_object('application_id', a3, 'attendance', 'no_show')));
    t_name := t_name || text 'C a counsellor cannot change a mark'; t_det := t_det || (r::text);
    t_pass := t_pass || (r->>'message' = 'FORBIDDEN');
    r := pg_temp.call_as(cs1, pg_temp.rpc('vsat_set_counselling_attendance', jsonb_build_object('application_id', a4, 'attendance', 'done')));
    t_name := t_name || text 'C a counsellor cannot mark another counsellor''s student'; t_det := t_det || (r::text);
    t_pass := t_pass || (r->>'message' = 'FORBIDDEN');
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_set_counselling_attendance', jsonb_build_object('application_id', a4, 'attendance', 'no_show', 'reason', 'zz did not join')));
    t_name := t_name || text 'C no-show → status No-show (0166: stage and pipeline status unchanged)'; t_det := t_det || (pg_temp.stage(a4));
    t_pass := t_pass || (pg_temp.stage(a4) = 'counselling_scheduled:active' and (pg_temp.ca(a4)).attendance::text = 'no_show');

    -- ════ D. the student ════
    r := pg_temp.call_as(pg_temp.lead_of(a6), 'select public.vsat_my_counselling()');
    t_name := t_name || text 'D cleared, not booked yet → step pi_cleared, nothing else'; t_det := t_det || (r::text);
    t_pass := t_pass || (r->>'step' = 'pi_cleared' and r->>'state' = 'none' and not r ? 'meet_link');
    perform public.vsat__move(a7, 'interviewed', 'active', 'zz back', 'system', null, null);
    r := pg_temp.call_as(pg_temp.lead_of(a7), 'select public.vsat_my_counselling()');
    t_name := t_name || text 'D waiting for the interview result → step interviewed'; t_det := t_det || (r::text);
    t_pass := t_pass || (r->>'step' = 'interviewed');
    update public.vsat_pipeline set status = 'on_hold' where application_id = a7;
    perform public.vsat__move(a7, 'pi_cleared', 'on_hold', 'zz hold', 'system', null, null);
    r := pg_temp.call_as(pg_temp.lead_of(a7), 'select public.vsat_my_counselling()');
    t_name := t_name || text 'D PI cleared but on hold → not told "cleared"'; t_det := t_det || (r::text);
    t_pass := t_pass || (r->>'step' = 'interviewed');
    r := pg_temp.call_as(pg_temp.lead_of(a1), 'select public.vsat_my_counselling()');
    t_name := t_name || text 'D booked → upcoming, the link is not handed out yet'; t_det := t_det || (r::text);
    t_pass := t_pass || (r->>'step' = 'counselling' and r->>'state' = 'upcoming' and r->>'meet_link' is null and r->>'duration_min' = '45');
    update public.counselling_assignments set slot_datetime = now() - interval '5 minutes', zoom_link = 'https://meet.google.com/abc-defg-hij' where application_id = a1;
    r := pg_temp.call_as(pg_temp.lead_of(a1), 'select public.vsat_my_counselling()');
    t_name := t_name || text 'D during the session → open, with the link'; t_det := t_det || (r::text);
    t_pass := t_pass || (r->>'state' = 'open' and r->>'meet_link' = 'https://meet.google.com/abc-defg-hij');
    r := pg_temp.call_as(pg_temp.lead_of(a4), 'select public.vsat_my_counselling()');
    t_name := t_name || text 'D no-show → missed'; t_det := t_det || (r::text);
    t_pass := t_pass || (r->>'state' = 'missed' and r->>'meet_link' is null);
    r := pg_temp.call_as(null, 'select public.vsat_my_counselling()', 'anon');
    t_name := t_name || text 'D signed out → refused'; t_det := t_det || (r::text);
    t_pass := t_pass || (r ? 'sqlstate');

    -- ════ E. server jobs (service role) ════
    r := pg_temp.call_as(null, pg_temp.rpc('vsat_counselling_sync_claim', jsonb_build_object('application_ids', jsonb_build_array(a3))), 'service_role');
    t_name := t_name || text 'E Google claim: the session with the counsellor (key "counsellor")'; t_det := t_det || (r::text);
    t_pass := t_pass || (jsonb_array_length(r) = 1 and r->0->'counsellor'->>'id' = cs1::text and r->0->'student'->>'email' = lower(a3) || '@example.invalid');
    r2 := pg_temp.call_as(null, pg_temp.rpc('vsat_counselling_sync_release', jsonb_build_object('id', r->0->>'id', 'version', (r->0->>'version')::int,
            'claimed_at', r->0->>'claimed_at', 'outcome', 'ok', 'calendar_event_id', 'vc0123456789abcdefg0', 'meet_link', 'https://meet.google.com/xyz-abcd-efg', 'meet_code', 'xyz-abcd-efg')), 'service_role');
    c := pg_temp.ca(a3);
    -- 0184: a Zoom booking keeps the counsellor's Zoom link; only the calendar event is saved
    t_name := t_name || text 'E calendar result saved into the counselling row; the counsellor''s Zoom link is kept (0184)'; t_det := t_det || (format('%s %s %s %s', r2, c.meet_sync, c.zoom_link, c.calendar_event_id));
    t_pass := t_pass || (r2->>'applied' = 'true' and c.meet_sync = 'ok' and c.zoom_link = 'https://zoom.us/j/zztest-cs1' and c.calendar_event_id = 'vc0123456789abcdefg0');
    r := pg_temp.call_as(null, pg_temp.rpc('vsat_counselling_notices_claim', jsonb_build_object('application_ids', jsonb_build_array(a3), 'wait_for_meet', false)), 'service_role');
    t_name := t_name || text 'E email job: counsellor, student and the counsellor''s Zoom link (0184)'; t_det := t_det || (r::text);
    t_pass := t_pass || (jsonb_array_length(r) = 1 and r->0->>'kind' = 'scheduled' and r->0->'counsellor'->>'id' = cs1::text
                         and r->0->>'meet_link' = 'https://zoom.us/j/zztest-cs1' and r->0->'student'->>'lead_id' = pg_temp.lead_of(a3)::text);
    r2 := pg_temp.call_as(null, pg_temp.rpc('vsat_counselling_notice_done', jsonb_build_object('id', r->0->>'id', 'status', 'sent')), 'service_role');
    t_name := t_name || text 'E email job closed'; t_det := t_det || (r2::text); t_pass := t_pass || (r2->>'updated' = 'true');
    r := pg_temp.call_as(null, pg_temp.rpc('vsat_counselling_attendance_apply', jsonb_build_object('id', (pg_temp.ca(a3)).id, 'version', 0, 'result', 'no_show')), 'service_role');
    t_name := t_name || text 'E attendance from Meet with an old version → ignored'; t_det := t_det || (r::text);
    t_pass := t_pass || (r->>'applied' = 'false');
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_counselling_sync_claim', '{}'::jsonb));
    t_name := t_name || text 'E staff browsers cannot run server jobs'; t_det := t_det || (r::text);
    t_pass := t_pass || (r->>'sqlstate' = '42501');

    -- ════ F. access rules in the database ════
    t_name := t_name || text 'F new tables: RLS on, no browser access';
    select string_agg(c2.relname, ',') into s from pg_class c2
     where c2.oid in ('public.vsat_counselling_events'::regclass, 'public.vsat_counselling_drafts'::regclass)
       and (not c2.relrowsecurity or has_table_privilege('authenticated', c2.oid, 'select') or has_table_privilege('anon', c2.oid, 'select')
            or has_table_privilege('authenticated', c2.oid, 'insert'));
    t_det := t_det || (coalesce(s, 'ok')); t_pass := t_pass || (s is null);
    t_name := t_name || text 'F staff / student functions: signed-in only, security definer, empty search_path';
    select string_agg(p.proname, ',') into s from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname in ('vsat_assign_counsellor', 'vsat_cancel_counselling', 'vsat_set_counselling_attendance',
             'vsat_counselling_meet_retry', 'vsat_my_counselling', 'vsat_counselling_plan', 'vsat_counselling_draft_set',
             'vsat_counselling_drafts_fill', 'vsat_counselling_drafts_send')
       and not (has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
                and p.prosecdef and p.proconfig = array['search_path=""']);
    t_det := t_det || (coalesce(s, 'ok')); t_pass := t_pass || (s is null);
    t_name := t_name || text 'F server functions and helpers: no browser role can run them';
    select string_agg(p.proname, ',') into s from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and (p.proname like 'vsat__cs_%' or p.proname in ('vsat_counselling_sync_claim', 'vsat_counselling_sync_release',
             'vsat_counselling_attendance_due', 'vsat_counselling_attendance_apply', 'vsat_counselling_notices_claim', 'vsat_counselling_notice_done'))
       and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute')
            or p.proconfig is distinct from array['search_path=""']);
    t_det := t_det || (coalesce(s, 'ok')); t_pass := t_pass || (s is null);
    t_name := t_name || text 'F six counselling email steps, OFF and in test mode';
    select count(*) into n from public.vsat_comm_steps where step_key in ('counselling_invite', 'counselling_rescheduled', 'counselling_cancelled',
             'counsellor_invite', 'counsellor_rescheduled', 'counsellor_cancelled') and not enabled and test_mode and not wa_enabled;
    t_det := t_det || (n::text); t_pass := t_pass || (n = 6);
    t_name := t_name || text 'F one row per student + attempt';
    t_det := t_det || (coalesce(to_regclass('public.counselling_assignments_app_attempt_key')::text, '∅'));
    t_pass := t_pass || (to_regclass('public.counselling_assignments_app_attempt_key') is not null);

    raise exception using errcode = 'ZDONE';
  exception when sqlstate 'ZDONE' then null;
  end;

  return query select x.n, x.p, x.d from unnest(t_name, t_pass, t_det) as x(n, p, d);
end $$;

select test, coalesce(pass, false) as pass, detail from pg_temp.run_vsat_cs_tests();

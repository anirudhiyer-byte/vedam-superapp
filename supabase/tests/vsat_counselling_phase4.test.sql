-- VSAT Phase 4 · counselling: Zoom link per counsellor, offline dates, the counselling mode set by admissions, invites
-- for online students only on the counsellor's Zoom link, the counselling sheet's counsellor fields and ±5 adjustment,
-- the sheet's columns on the Counselling table, the PI-cleared email's offline dates and Counselling Evaluation —
-- tests for migration 0184 (STAGING ONLY)
--
-- How to run: paste this whole file into the staging SQL editor, or run it through the Supabase MCP.
-- The last statement returns one row per test: test | pass | detail.
--
-- A. Zoom link per counsellor · B. offline counselling dates · C. mode set by admissions · D. booking (online only, Zoom)
-- E. counselling form (sheet fields, ±5) · F. Counselling table columns and filter · G. PI-cleared email offline dates
-- H. Counselling Evaluation · I. access and grants.
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

-- a student of VSAT p_date (with the academics the scholarship needs), moved as the system to p_stage
create or replace function pg_temp.mk_app(p_id text, p_campus text, p_date uuid, p_stage text)
returns text language plpgsql as $$
declare u uuid := pg_temp.mk_user(lower(p_id) || '@example.invalid'); s text;
begin
  insert into public.lead_manager (lead_id, registered_name, registered_email, lead_stage) values (u, 'ZZTEST ' || p_id, lower(p_id) || '@example.invalid', 'applicant_paid')
  on conflict (lead_id) do nothing;
  insert into public.application_manager (application_id, lead_id, application_no, registered_name, registered_email, campus_applied, exam_date_id,
    class10_year, class10_percentage, class10_maths_percentage, class12_year, class12_percentage, class12_maths_percentage,
    marks_physics_12, marks_chemistry_12, marks_maths_12, jee_registered, entrance_percentile, jee_main_maths_percentile,
    exam_percentile, exam_obtained_marks, exam_max_marks, vps_score)
  values (p_id, u, p_id, 'ZZTEST ' || p_id, lower(p_id) || '@example.invalid', p_campus, p_date,
    2024, 90, 85, 2026, 80, 70, 70, 70, 70, false, null, null, 80, 40, 50, 8.43);
  update public.application_manager set exam_given = true where application_id = p_id;
  foreach s in array array['vsat_cleared', 'interview_scheduled', 'interviewed', 'pi_cleared'] loop
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
returns text language sql as $$ select format('select to_jsonb(public.%I(%L::jsonb))', p_fn, p::text) $$;
create or replace function pg_temp.rpc0(p_fn text)
returns text language sql as $$ select format('select to_jsonb(public.%I())', p_fn) $$;

create or replace function pg_temp.run_vsat_counselling_phase4_tests()
returns table (test text, pass boolean, detail text) language plpgsql as $$
declare
  t_name text[] := '{}'; t_pass boolean[] := '{}'; t_det text[] := '{}';
  adm uuid; adm_pune uuid; ad uuid; i1 uuid; c1 uuid; c2 uuid; nobody uuid; d uuid;
  a1 text; a2 text; a3 text; a4 text; g1 text; v1 text;
  r jsonb; s text; n int; dt date := (now() at time zone 'Asia/Kolkata')::date + 3; slot text; ca public.counselling_assignments;
  -- the interview form (weights 0.25 / 0.25 / 0.20 / 0.15 / 0.15): weighted 3.65 → PI × 20 = 73; CS (passion 3) × 20 = 60; LR (logic 4) × 20 = 80
  form jsonb := '{"communication": 4, "logic": 4, "passion": 3, "achievements": 3, "why_program": 4, "cheating_seen": false,
                  "coding_talent": false, "cert_asked": true, "drop_year": false, "previous_jee": "N/A", "jee_pct": 91.5, "other_exams": "N/A",
                  "class10_pct": 88, "class11_pct": 80, "class12_pct": 85, "financial_capability": "medium", "financial_reason": "zz salaried",
                  "why_accept": "zz why"}';
  zl1 text := 'https://us06web.zoom.us/j/11111111111?pwd=zztest1';
  zl2 text := 'https://us06web.zoom.us/j/22222222222?pwd=zztest2';
begin
  begin -- rolled back at the end (ZDONE)
    adm := pg_temp.mk_user('zztest-p4-adm@example.invalid');
    adm_pune := pg_temp.mk_user('zztest-p4-admpune@example.invalid');
    ad := pg_temp.mk_user('zztest-p4-admin@example.invalid');
    i1 := pg_temp.mk_user('zztest-p4-int1@example.invalid');
    c1 := pg_temp.mk_user('zztest-p4-cou1@example.invalid');
    c2 := pg_temp.mk_user('zztest-p4-cou2@example.invalid');
    nobody := pg_temp.mk_user('zztest-p4-nobody@example.invalid');
    insert into public.user_roles (user_id, role) values (ad, 'admin');
    insert into public.vsat_team (user_id, role, campus) values (adm, 'admissions', null), (adm_pune, 'admissions', 'pune'),
      (i1, 'interviewer', null), (c1, 'counsellor', null), (c2, 'counsellor', null);
    insert into public.vsat_exam_dates (label, wheebox_test_id, exam_date, start_at, end_at)
    values ('ZZTEST P4 VSAT', 'zz-p4', current_date, now(), now() + interval '2 hours') returning id into d;
    a1 := pg_temp.mk_app('ZZT-P4-1', 'Ajeenkya DY Patil University — Pune', d, 'interview_scheduled');
    a2 := pg_temp.mk_app('ZZT-P4-2', 'Ajeenkya DY Patil University — Pune', d, 'pi_cleared');
    a3 := pg_temp.mk_app('ZZT-P4-3', 'Ajeenkya DY Patil University — Pune', d, 'pi_cleared');
    a4 := pg_temp.mk_app('ZZT-P4-4', 'Ajeenkya DY Patil University — Pune', d, 'pi_cleared');
    g1 := pg_temp.mk_app('ZZT-P4-G1', 'Sushant University — Gurugram', d, 'pi_cleared');
    v1 := pg_temp.mk_app('ZZT-P4-V1', 'Ajeenkya DY Patil University — Pune', d, 'vsat_cleared');

    -- ── A. Zoom link per counsellor ──
    r := pg_temp.call_as(adm, pg_temp.rpc0('vsat_counsellor_zoom_list'));
    t_name := t_name || text 'A admissions see every active counsellor, no link yet';
    t_det := t_det || left(r::text, 200);
    t_pass := t_pass || (r @> jsonb_build_array(jsonb_build_object('counsellor_id', c1, 'zoom_link', null))
                         and r @> jsonb_build_array(jsonb_build_object('counsellor_id', c2)));
    r := pg_temp.call_as(i1, pg_temp.rpc0('vsat_counsellor_zoom_list'));
    t_name := t_name || text 'A an interviewer cannot read the Zoom links'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'FORBIDDEN');
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_counsellor_zoom_set', jsonb_build_object('counsellor_id', c1, 'zoom_link', zl1)));
    t_name := t_name || text 'A only admins set a Zoom link (admissions refused)'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'FORBIDDEN');
    s := '';
    r := pg_temp.call_as(ad, pg_temp.rpc('vsat_counsellor_zoom_set', jsonb_build_object('counsellor_id', c1, 'zoom_link', 'http://us06web.zoom.us/j/1'))); s := s || (r->>'message') || ' | ';
    r := pg_temp.call_as(ad, pg_temp.rpc('vsat_counsellor_zoom_set', jsonb_build_object('counsellor_id', c1, 'zoom_link', 'https://meet.google.com/abc-defg-hij'))); s := s || (r->>'message') || ' | ';
    r := pg_temp.call_as(ad, pg_temp.rpc('vsat_counsellor_zoom_set', jsonb_build_object('counsellor_id', c1, 'zoom_link', 'https://evilzoom.us/j/1'))); s := s || (r->>'message') || ' | ';
    r := pg_temp.call_as(ad, pg_temp.rpc('vsat_counsellor_zoom_set', jsonb_build_object('counsellor_id', i1, 'zoom_link', zl1))); s := s || (r->>'message') || ' | ';
    r := pg_temp.call_as(ad, pg_temp.rpc('vsat_counsellor_zoom_set', jsonb_build_object('counsellor_id', c1))); s := s || (r->>'message') || ' | ';
    r := pg_temp.call_as(ad, pg_temp.rpc('vsat_counsellor_zoom_set', jsonb_build_object('counsellor_id', c1, 'zoom_link', zl1, 'campus', 'pune'))); s := s || (r->>'message');
    t_name := t_name || text 'A bad links refused: http, Google Meet, a look-alike domain; not a counsellor; link missing; unknown key';
    t_det := t_det || s;
    t_pass := t_pass || (s = 'BAD_VALUE: zoom_link | BAD_VALUE: zoom_link | BAD_VALUE: zoom_link | NOT_A_COUNSELLOR | BAD_VALUE: zoom_link | UNKNOWN_KEY: campus');
    r := pg_temp.call_as(ad, pg_temp.rpc('vsat_counsellor_zoom_set', jsonb_build_object('counsellor_id', c1, 'zoom_link', zl1)));
    r := pg_temp.call_as(ad, pg_temp.rpc('vsat_counsellor_zoom_set', jsonb_build_object('counsellor_id', c2, 'zoom_link', zl2)));
    t_name := t_name || text 'A an admin sets both links; the change is in the settings audit';
    select count(*) into n from public.vsat_settings_audit sa where sa.area = 'team' and sa.target in (c1::text, c2::text) and sa.after ? 'zoom_link';
    t_det := t_det || format('%s audit=%s', r, n);
    t_pass := t_pass || (r->>'zoom_link' = zl2 and n = 2
                         and (select z.zoom_link from public.vsat_counsellor_zoom z where z.counsellor_id = c1) = zl1);
    r := pg_temp.call_as(ad, pg_temp.rpc('vsat_counsellor_zoom_set', jsonb_build_object('counsellor_id', c2, 'zoom_link', '')));
    t_name := t_name || text 'A an empty link removes it';
    t_det := t_det || r::text;
    t_pass := t_pass || ((select z.zoom_link from public.vsat_counsellor_zoom z where z.counsellor_id = c2) is null);

    -- ── B. offline counselling dates ──
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_offline_date_add', jsonb_build_object('campus', 'pune', 'date', dt::text, 'note', 'Campus, 10 am')));
    t_name := t_name || text 'B admissions add an offline date for Pune'; t_det := t_det || r::text; t_pass := t_pass || (r->>'date' = dt::text);
    s := '';
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_offline_date_add', jsonb_build_object('campus', 'pune', 'date', dt::text))); s := s || (r->>'message') || ' | ';
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_offline_date_add', jsonb_build_object('campus', 'pune', 'date', (dt - 10)::text))); s := s || (r->>'message') || ' | ';
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_offline_date_add', jsonb_build_object('campus', 'bangalore', 'date', dt::text))); s := s || (r->>'message') || ' | ';
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_offline_date_add', jsonb_build_object('campus', 'pune', 'date', '25-12-2026'))); s := s || (r->>'message') || ' | ';
    r := pg_temp.call_as(adm_pune, pg_temp.rpc('vsat_offline_date_add', jsonb_build_object('campus', 'gurugram', 'date', dt::text))); s := s || (r->>'message') || ' | ';
    r := pg_temp.call_as(c1, pg_temp.rpc('vsat_offline_date_add', jsonb_build_object('campus', 'pune', 'date', (dt + 1)::text))); s := s || (r->>'message');
    t_name := t_name || text 'B refused: same date twice, a past date, unknown campus, bad date, another campus, a counsellor';
    t_det := t_det || s;
    t_pass := t_pass || (s = 'ALREADY_EXISTS | BAD_VALUE: date | BAD_VALUE: campus | BAD_VALUE: date | FORBIDDEN | FORBIDDEN');
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_offline_date_add', jsonb_build_object('campus', 'gurugram', 'date', (dt + 2)::text)));
    r := pg_temp.call_as(adm_pune, pg_temp.rpc('vsat_offline_dates_list', '{}'::jsonb));
    t_name := t_name || text 'B a Pune-only admissions member lists Pune dates only';
    t_det := t_det || r::text;
    t_pass := t_pass || (jsonb_array_length(r) >= 1 and not exists (select 1 from jsonb_array_elements(r) e where e->>'campus' <> 'pune'));
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_offline_date_add', jsonb_build_object('campus', 'pune', 'date', (dt + 5)::text)));
    s := r->>'id';
    r := pg_temp.call_as(adm_pune, pg_temp.rpc('vsat_offline_date_remove', jsonb_build_object('id', s)));
    t_name := t_name || text 'B removing a date hides it from the list (and it can be added again)';
    t_det := t_det || r::text;
    t_pass := t_pass || ((r->>'removed')::boolean
                         and not exists (select 1 from jsonb_array_elements(pg_temp.call_as(adm, pg_temp.rpc('vsat_offline_dates_list', '{}'::jsonb))) e where e->>'id' = s)
                         and (pg_temp.call_as(adm, pg_temp.rpc('vsat_offline_date_add', jsonb_build_object('campus', 'pune', 'date', (dt + 5)::text))) ? 'id'));

    -- ── C. mode set by admissions ──
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_counselling_mode_staff', jsonb_build_object('application_ids', jsonb_build_array(a2, a3, v1, 'ZZT-NOPE'), 'mode', 'online')));
    t_name := t_name || text 'C admissions set Online for PI-cleared students; a VSAT-cleared one and an unknown one are skipped';
    t_det := t_det || r::text;
    t_pass := t_pass || (r->'updated' = jsonb_build_array(a2, a3)
                         and r->'skipped' @> jsonb_build_array(jsonb_build_object('application_id', v1, 'code', 'WRONG_STAGE'))
                         and r->'skipped' @> jsonb_build_array(jsonb_build_object('application_id', 'ZZT-NOPE', 'code', 'NOT_IN_PIPELINE'))
                         and (select am.counselling_mode from public.application_manager am where am.application_id = a2) = 'online');
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_counselling_mode_staff', jsonb_build_object('application_ids', jsonb_build_array(a4), 'mode', 'offline')));
    t_name := t_name || text 'C Offline is saved, with the time and an activity log line';
    t_det := t_det || r::text;
    t_pass := t_pass || ((select am.counselling_mode = 'offline' and am.counselling_mode_at is not null from public.application_manager am where am.application_id = a4)
                         and exists (select 1 from public.crm_activity_log l where l.application_id = a4 and l.action = 'counselling_mode' and l.actor = 'staff'));
    s := '';
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_counselling_mode_staff', jsonb_build_object('application_ids', jsonb_build_array(a4), 'mode', 'hybrid'))); s := s || (r->>'message') || ' | ';
    r := pg_temp.call_as(c1, pg_temp.rpc('vsat_counselling_mode_staff', jsonb_build_object('application_ids', jsonb_build_array(a4), 'mode', 'online'))); s := s || (r->>'message') || ' | ';
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_counselling_mode_staff', jsonb_build_object('application_ids', '[]'::jsonb, 'mode', 'online'))); s := s || (r->>'message');
    t_name := t_name || text 'C refused: unknown mode, a counsellor, no students';
    t_det := t_det || s; t_pass := t_pass || (s = 'BAD_VALUE: mode | FORBIDDEN | BAD_VALUE: application_ids');
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_counselling_mode_staff', jsonb_build_object('application_ids', jsonb_build_array(g1), 'mode', 'none')));
    t_name := t_name || text 'C "none" leaves the mode empty';
    t_det := t_det || r::text;
    t_pass := t_pass || (r->'updated' = jsonb_build_array(g1) and (select am.counselling_mode from public.application_manager am where am.application_id = g1) is null);

    -- ── D. booking: online students only, on the counsellor's Zoom link ──
    slot := to_char(now() + interval '4 days', 'YYYY-MM-DD"T"HH24:00:00"Z"');
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_assign_counsellor', jsonb_build_object('application_id', g1, 'counsellor_id', c1, 'slot_datetime', slot)));
    t_name := t_name || text 'D no mode chosen yet → MODE_NOT_CHOSEN'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'MODE_NOT_CHOSEN');
    -- 0186 (owner's decision, 25 Nov): an offline student's session is recorded with no invite (was MODE_OFFLINE in 0184)
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_assign_counsellor', jsonb_build_object('application_id', a4, 'counsellor_id', c2, 'slot_datetime', slot)));
    select * into ca from public.counselling_assignments x where x.application_id = a4;
    t_name := t_name || text 'D an offline student is recorded with no invite (no Zoom link needed, no calendar work)';
    t_det := t_det || format('%s | mode=%s link=%s sync=%s', left(coalesce(r->>'message', 'ok'), 80), ca.meet_mode, coalesce(ca.zoom_link, '-'), ca.meet_sync);
    t_pass := t_pass || coalesce(not (r ? 'sqlstate') and ca.meet_mode = 'offline' and ca.zoom_link is null and ca.meet_sync = 'none', false);
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_assign_counsellor', jsonb_build_object('application_id', a2, 'counsellor_id', c2, 'slot_datetime', slot)));
    t_name := t_name || text 'D a counsellor without a Zoom link → NO_ZOOM_LINK'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'NO_ZOOM_LINK');
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_assign_counsellor', jsonb_build_object('application_id', a2, 'counsellor_id', c1, 'slot_datetime', slot)));
    select * into ca from public.counselling_assignments x where x.application_id = a2;
    t_name := t_name || text 'D an online student is booked on the counsellor''s Zoom link (no Google Meet); the calendar invite is queued';
    t_det := t_det || format('mode=%s link=%s sync=%s | %s', ca.meet_mode, ca.zoom_link, ca.meet_sync, left(coalesce(r->>'message', 'ok'), 80));
    t_pass := t_pass || (ca.meet_mode = 'zoom' and ca.zoom_link = zl1 and ca.meet_sync = 'pending' and not (r ? 'sqlstate'));
    r := pg_temp.call_as(null, pg_temp.rpc('vsat_counselling_sync_claim', jsonb_build_object('application_ids', jsonb_build_array(a2))), 'service_role');
    t_name := t_name || text 'D the calendar job gets the Zoom link with the booking';
    t_det := t_det || left(r::text, 300);
    t_pass := t_pass || (r->0->>'meet_mode' = 'zoom' and r->0->>'zoom_link' = zl1);
    update public.counselling_assignments x set meet_sync = 'failed', meet_claimed_at = null, meet_error = 'zz test', calendar_event_id = null
     where x.application_id = a2;
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_counselling_meet_retry', jsonb_build_object('application_id', a2)));
    t_name := t_name || text 'D a failed Zoom calendar invite can be tried again (Try again)';
    t_det := t_det || format('%s | sync=%s', coalesce(r->>'message', 'ok'), (select x.meet_sync from public.counselling_assignments x where x.application_id = a2));
    t_pass := t_pass || (not (r ? 'sqlstate') and (select x.meet_sync from public.counselling_assignments x where x.application_id = a2) = 'pending');
    update public.counselling_assignments x set meet_sync = 'ok', meet_claimed_at = null where x.application_id = a2;
    r := pg_temp.call_as(null, pg_temp.rpc('vsat_counselling_notices_claim', jsonb_build_object('application_ids', jsonb_build_array(a2), 'wait_for_meet', true)), 'service_role');
    t_name := t_name || text 'D the "scheduled" emails carry the Zoom link';
    t_det := t_det || left(r::text, 300);
    t_pass := t_pass || (exists (select 1 from jsonb_array_elements(r) e where e->>'kind' = 'scheduled' and e->>'meet_link' = zl1));
    r := pg_temp.call_as(null, 'select public.vsat_counselling_attendance_due(50)', 'service_role');
    t_name := t_name || text 'D Zoom bookings are not read for attendance (Status by hand)';
    t_det := t_det || left(r::text, 120);
    t_pass := t_pass || not exists (select 1 from jsonb_array_elements(r) e where e->>'application_id' = a2);
    r := pg_temp.call_as(ad, pg_temp.rpc('vsat_counsellor_zoom_set', jsonb_build_object('counsellor_id', c2, 'zoom_link', zl2)));
    insert into public.vsat_counselling_drafts (application_id, attempt_no, counsellor_id, slot_datetime)
    values (a3, 1, c2, (now() + interval '5 days')::timestamptz), (a4, 1, c1, (now() + interval '6 days')::timestamptz),
           (g1, 1, c1, (now() + interval '7 days')::timestamptz);
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_counselling_drafts_send', jsonb_build_object('application_ids', jsonb_build_array(a3, a4, g1))));
    -- 0186: the offline row is sent too (recorded, no invite); only the no-mode row is skipped
    t_name := t_name || text 'D Send: the online student is sent on their counsellor''s link; the offline row is recorded; the no-mode row is skipped with the reason';
    t_det := t_det || r::text;
    t_pass := t_pass || (jsonb_array_length(r->'sent') = 2 and r->'sent' @> jsonb_build_array(jsonb_build_object('application_id', a3))
                         and r->'sent' @> jsonb_build_array(jsonb_build_object('application_id', a4))
                         and jsonb_array_length(r->'skipped') = 1
                         and r->'skipped' @> jsonb_build_array(jsonb_build_object('application_id', g1, 'code', 'MODE_NOT_CHOSEN'))
                         and (select x.meet_mode from public.counselling_assignments x where x.application_id = a4) = 'offline'
                         and (select x.zoom_link from public.counselling_assignments x where x.application_id = a3) = zl2);

    -- ── E. counselling form: the sheet's counsellor fields and the ±5 adjustment ──
    perform pg_temp.call_as(adm, pg_temp.rpc('vsat_assign_interview', jsonb_build_object('application_id', a1, 'interviewer_id', i1,
           'slot_datetime', now() + interval '3 days', 'duration_min', 30, 'auto_meet', true)));
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_submit_interview', form || jsonb_build_object('application_id', a1)));
    perform public.vsat__move(a1, 'interviewed', 'active', 'zz test', 'system', null, null);
    perform public.vsat__move(a1, 'pi_cleared', 'active', 'zz test', 'system', null, null);
    perform pg_temp.call_as(adm, pg_temp.rpc('vsat_counselling_mode_staff', jsonb_build_object('application_ids', jsonb_build_array(a1), 'mode', 'online')));
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_assign_counsellor', jsonb_build_object('application_id', a1, 'counsellor_id', c1,
           'slot_datetime', to_char(now() + interval '8 days', 'YYYY-MM-DD"T"HH24:00:00"Z"'))));
    s := '';
    r := pg_temp.call_as(c1, pg_temp.rpc('vsat_submit_counselling', jsonb_build_object('application_id', a1, 'adjust_pct', 5))); s := s || (r->>'message') || ' | ';
    r := pg_temp.call_as(c1, pg_temp.rpc('vsat_submit_counselling', jsonb_build_object('application_id', a1, 'adjust_pct', 6, 'adjust_reason', 'x'))); s := s || (r->>'message') || ' | ';
    r := pg_temp.call_as(c1, pg_temp.rpc('vsat_submit_counselling', jsonb_build_object('application_id', a1, 'adjust_pct', 2.5, 'adjust_reason', 'x'))); s := s || (r->>'message') || ' | ';
    r := pg_temp.call_as(c1, pg_temp.rpc('vsat_submit_counselling', jsonb_build_object('application_id', a1, 'feedback', 'maybe'))); s := s || (r->>'message') || ' | ';
    r := pg_temp.call_as(c1, pg_temp.rpc('vsat_submit_counselling', jsonb_build_object('application_id', a1, 'parent_present', 'uncle'))); s := s || (r->>'message') || ' | ';
    r := pg_temp.call_as(c1, pg_temp.rpc('vsat_submit_counselling', jsonb_build_object('application_id', a1, 'connected_students', 'yes'))); s := s || (r->>'message') || ' | ';
    r := pg_temp.call_as(c1, pg_temp.rpc('vsat_submit_counselling', jsonb_build_object('application_id', a1, 'actual_pct', 50))); s := s || (r->>'message');
    t_name := t_name || text 'E refused: +5 without a reason, 6, 2.5, unknown feedback / parent, a text yes, a typed actual %';
    t_det := t_det || s;
    t_pass := t_pass || (s = 'BAD_VALUE: adjust_reason | BAD_VALUE: adjust_pct | BAD_VALUE: adjust_pct | BAD_VALUE: feedback | BAD_VALUE: parent_present | BAD_VALUE: connected_students | UNKNOWN_KEY: actual_pct');
    r := pg_temp.call_as(c1, pg_temp.rpc('vsat_submit_counselling', jsonb_build_object('application_id', a1, 'feedback', 'likely', 'parent_present', 'mother',
           'connected_students', true, 'heard_from', 'Referral from a friend', 'remarks', 'Keen, budget 10 L', 'adjust_pct', 5, 'adjust_reason', 'Strong projects')));
    select * into ca from public.counselling_assignments x where x.application_id = a1;
    t_name := t_name || text 'E the counsellor saves the sheet''s fields; awarded = formula + 5 (reason kept); the scholarship % on the application follows';
    t_det := t_det || format('%s | calc=%s actual=%s adj=%s fb=%s par=%s conn=%s heard=%s reason=%s', left(r::text, 160), ca.calculated_pct, ca.actual_pct,
                             ca.adjust_pct, ca.counsellor_feedback, ca.parent_present, ca.connected_students, ca.heard_from, ca.actual_reason);
    t_pass := t_pass || (ca.actual_pct = ca.calculated_pct + 5 and ca.scholarship_pct = ca.actual_pct and ca.adjust_pct = 5
                         and ca.counsellor_feedback = 'likely' and ca.parent_present = 'mother' and ca.connected_students
                         and ca.heard_from = 'Referral from a friend' and ca.actual_reason = 'Strong projects'
                         and (r->>'adjust_pct')::numeric = 5
                         and (select am.scholarship_percentage from public.application_manager am where am.application_id = a1) = ca.actual_pct);
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_submit_counselling', jsonb_build_object('application_id', a3)));
    select * into ca from public.counselling_assignments x where x.application_id = a3;
    t_name := t_name || text 'E a form with no new fields still saves (adjustment 0 = the formula''s %)';
    t_det := t_det || format('%s | calc=%s actual=%s adj=%s', left(r::text, 120), ca.calculated_pct, ca.actual_pct, ca.adjust_pct);
    t_pass := t_pass || (ca.submitted_at is not null and ca.actual_pct = ca.calculated_pct and ca.adjust_pct = 0 and ca.actual_reason is null);

    -- ── F. Counselling table columns and the feedback filter ──
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_grid_list', jsonb_build_object('application_ids', jsonb_build_array(a1), 'columns',
           jsonb_build_array('cs_feedback', 'cs_parent_present', 'cs_connected_students', 'cs_heard_from', 'cs_remarks', 'cs_adjust_pct', 'cs_score',
                             'campus_fee', 'cs_scholarship_amount', 'cs_first_year_scholarship', 'cs_actual_fee', 'pi_score_x20', 'iv_cs_x20',
                             'iv_lr_x20', 'counselling_meet', 'counselling_mode', 'counselling_pct'))));
    t_name := t_name || text 'F the sheet''s columns: counsellor fields, fee 18.5 L (Pune), scholarship = fee × %, 1st year = ÷ 4, actual fee, PI / CS / LR × 20, Zoom';
    t_det := t_det || left((r->'rows'->0)::text, 600);
    t_pass := t_pass || (r->'rows'->0->>'cs_feedback' = 'likely' and r->'rows'->0->>'cs_parent_present' = 'mother'
                         and (r->'rows'->0->>'cs_connected_students')::boolean and r->'rows'->0->>'cs_remarks' = 'Keen, budget 10 L'
                         and (r->'rows'->0->>'campus_fee')::numeric = 1850000
                         and (r->'rows'->0->>'cs_scholarship_amount')::numeric = round(1850000 * (r->'rows'->0->>'counselling_pct')::numeric / 100)
                         and (r->'rows'->0->>'cs_first_year_scholarship')::numeric = round(1850000 * (r->'rows'->0->>'counselling_pct')::numeric / 100 / 4)
                         and (r->'rows'->0->>'cs_actual_fee')::numeric = 1850000 - (r->'rows'->0->>'cs_scholarship_amount')::numeric
                         and (r->'rows'->0->>'pi_score_x20')::numeric = 73 and (r->'rows'->0->>'iv_cs_x20')::numeric = 60
                         and (r->'rows'->0->>'iv_lr_x20')::numeric = 80 and r->'rows'->0->>'counselling_meet' = 'zoom'
                         and r->'rows'->0->>'counselling_mode' = 'online');
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_grid_list', jsonb_build_object('exam_date_ids', jsonb_build_array(d), 'columns', jsonb_build_array('cs_feedback'),
           'filters', jsonb_build_array(jsonb_build_object('column', 'cs_feedback', 'op', 'eq', 'v', 'likely')))));
    select string_agg(e->>'application_id', ',' order by e->>'application_id') into s from jsonb_array_elements(r->'rows') e;
    t_name := t_name || text 'F Counsellor feedback can be filtered';
    t_det := t_det || coalesce(s, left(r::text, 200));
    t_pass := t_pass || (s = a1);
    r := pg_temp.call_as(adm, pg_temp.rpc0('vsat_grid_columns'));
    t_name := t_name || text 'F the new columns are in the catalogue, feedback filterable';
    select string_agg(e->>'key', ',' order by e->>'key') into s from jsonb_array_elements(coalesce(r->'columns', r)) e
     where e->>'key' in ('cs_feedback', 'campus_fee', 'cs_actual_fee', 'pi_score_x20') and (e->>'key' <> 'cs_feedback' or (e->>'filterable')::boolean);
    t_det := t_det || coalesce(s, left(r::text, 200));
    t_pass := t_pass || (s = 'campus_fee,cs_actual_fee,cs_feedback,pi_score_x20');

    -- ── G. PI-cleared email: the campus's coming offline dates ──
    perform public.vsat__move(v1, 'interview_scheduled', 'active', 'zz test', 'system', null, null);
    perform public.vsat__move(v1, 'interviewed', 'active', 'zz test', 'system', null, null);
    perform public.vsat__move(v1, 'pi_cleared', 'active', 'zz test', 'system', null, null);
    r := pg_temp.call_as(null, pg_temp.rpc('vsat_stage_notices_claim', jsonb_build_object('application_ids', jsonb_build_array(v1))), 'service_role');
    t_name := t_name || text 'G the PI-cleared email job gets the Pune offline dates from today on (removed ones left out)';
    t_det := t_det || left(r::text, 400);
    t_pass := t_pass || (r->0->>'stage' = 'pi_cleared' and jsonb_array_length(r->0->'offline_dates') = 2  -- dt and dt + 5 (re-added); Gurugram's date left out
                         and r->0->'offline_dates'->0->>'date' = dt::text and r->0->'offline_dates'->0->>'note' = 'Campus, 10 am');
    t_name := t_name || text 'G the PI-cleared step asks for the mode and has the offline dates placeholder';
    select st.email_body into s from public.vsat_comm_steps st where st.step_key = 'pi_cleared';
    t_det := t_det || left(coalesce(s, 'none'), 120);
    t_pass := t_pass || (s like '%{{offline_dates}}%' and s like '%Online or Offline%' and s like '%Zoom link%');
    t_name := t_name || text 'G the counselling invite / moved emails name Zoom, not Google Meet';
    select count(*) into n from public.vsat_comm_steps st
     where st.step_key in ('counselling_invite', 'counselling_rescheduled', 'counsellor_invite', 'counsellor_rescheduled') and st.email_body like '%Google Meet%';
    t_det := t_det || (n::text || ' still say Google Meet'); t_pass := t_pass || (n = 0);

    -- ── H. Counselling Evaluation ──
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_counselling_analysis', jsonb_build_object('exam_date_id', d)));
    -- PI cleared and after: a1 a2 a3 (online), a4 (offline), g1 and v1 (no mode); booked a1 a2 a3 a4 (0186: offline recorded); counselled a1 (likely) and a3 (no feedback)
    t_name := t_name || text 'H one VSAT: students, mode, booked, counselled, feedback, ARPU (average actual fee) per campus and overall';
    t_det := t_det || left(r::text, 700);
    t_pass := t_pass || coalesce((r->>'students')::int = 6 and (r->'mode'->>'online')::int = 3 and (r->'mode'->>'offline')::int = 1
                         and (r->'mode'->>'not_chosen')::int = 2 and (r->>'booked')::int = 4 and (r->>'counselled')::int = 2
                         and (r->'feedback'->>'likely')::int = 1 and (r->'feedback'->>'not_given')::int = 1
                         and (r->>'arpu')::numeric = (select round(avg(1850000 * (1 - x.scholarship_pct / 100))) from public.counselling_assignments x where x.application_id in (a1, a3))
                         and r->'campuses' @> jsonb_build_array(jsonb_build_object('campus', 'gurugram', 'students', 1, 'counselled', 0))
                         and jsonb_array_length(r->'list') = 6, false);
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_counselling_analysis', jsonb_build_object('exam_date_id', d, 'campus', 'gurugram')));
    t_name := t_name || text 'H the campus filter';
    t_det := t_det || left(r::text, 200); t_pass := t_pass || ((r->>'students')::int = 1 and r->>'campus' = 'gurugram');
    r := pg_temp.call_as(adm_pune, pg_temp.rpc('vsat_counselling_analysis', jsonb_build_object('exam_date_id', d)));
    t_name := t_name || text 'H a Pune-only admissions member sees Pune students only';
    t_det := t_det || left(r::text, 200); t_pass := t_pass || coalesce((r->>'students')::int = 5, false);
    s := '';
    r := pg_temp.call_as(c1, pg_temp.rpc('vsat_counselling_analysis', jsonb_build_object('exam_date_id', d))); s := s || (r->>'message') || ' | ';
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_counselling_analysis', jsonb_build_object('exam_date_id', 'x'))); s := s || (r->>'message') || ' | ';
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_counselling_analysis', jsonb_build_object('exam_date_id', d, 'campus', 'goa'))); s := s || (r->>'message');
    t_name := t_name || text 'H refused: a counsellor, a bad VSAT, an unknown campus';
    t_det := t_det || s; t_pass := t_pass || (s = 'FORBIDDEN | BAD_VALUE: exam_date_id | BAD_VALUE: campus');

    -- ── I. access and grants ──
    r := pg_temp.call_as(null, pg_temp.rpc0('vsat_counsellor_zoom_list'), 'anon');
    t_name := t_name || text 'I signed out → refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = '42501');
    t_name := t_name || text 'I new functions: security definer, empty search_path, signed-in only (not anon)';
    select string_agg(p.proname, ',') into s from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname in ('vsat_counsellor_zoom_list', 'vsat_counsellor_zoom_set', 'vsat_offline_dates_list',
             'vsat_offline_date_add', 'vsat_offline_date_remove', 'vsat_counselling_mode_staff', 'vsat_counselling_analysis')
       and (not p.prosecdef or p.proconfig is distinct from array['search_path=""']
            or has_function_privilege('anon', p.oid, 'execute') or not has_function_privilege('authenticated', p.oid, 'execute'));
    t_det := t_det || coalesce(s, 'ok'); t_pass := t_pass || (s is null);
    t_name := t_name || text 'I the two new tables: RLS on, no policies, no browser access';
    select string_agg(c.relname, ',') into s from pg_class c
     where c.oid in ('public.vsat_counsellor_zoom'::regclass, 'public.vsat_offline_counselling_dates'::regclass)
       and (not c.relrowsecurity or exists (select 1 from pg_policies pp where pp.schemaname = 'public' and pp.tablename = c.relname)
            or has_table_privilege('authenticated', c.oid, 'select') or has_table_privilege('anon', c.oid, 'select'));
    t_det := t_det || coalesce(s, 'ok'); t_pass := t_pass || (s is null);
    t_name := t_name || text 'I the booking and calendar functions stay private (no browser access)';
    select string_agg(p.proname, ',') into s from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname in ('vsat__cs_schedule', 'vsat_counselling_sync_claim', 'vsat_stage_notices_claim')
       and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'));
    t_det := t_det || coalesce(s, 'ok'); t_pass := t_pass || (s is null);

    raise exception using errcode = 'ZDONE';
  exception when sqlstate 'ZDONE' then null;
  end;

  return query select x.n, x.p, x.d from unnest(t_name, t_pass, t_det) as x(n, p, d);
end $$;

select * from pg_temp.run_vsat_counselling_phase4_tests();

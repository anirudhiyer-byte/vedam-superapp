-- VSAT counselling · offline sessions and "Offline Form Filled" — tests for migration 0186 (STAGING ONLY)
--
-- How to run: paste this whole file into the staging SQL editor, or run it through the Supabase MCP.
-- The last statement returns one row per test: test | pass | detail.
--
-- A. an offline student's session is recorded (no Zoom, no calendar, no email) · B. Send from the rows records it too
-- C. online → offline: the old calendar invite is removed, no email · D. the form saves Offline Form Filled
-- E. the table's columns · F. the student's card · G. online and not-chosen rules unchanged · H. access unchanged.
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

-- a student at PI cleared with the academics the scholarship needs; p_mode = the counselling mode
create or replace function pg_temp.mk_app(p_id text, p_date uuid, p_mode text)
returns text language plpgsql as $$
declare u uuid := pg_temp.mk_user(lower(p_id) || '@example.invalid'); s text;
begin
  insert into public.lead_manager (lead_id, registered_name, registered_email, lead_stage) values (u, 'ZZTEST ' || p_id, lower(p_id) || '@example.invalid', 'applicant_paid')
  on conflict (lead_id) do nothing;
  insert into public.application_manager (application_id, lead_id, application_no, registered_name, registered_email, campus_applied, exam_date_id,
    class10_year, class10_percentage, class10_maths_percentage, class12_year, class12_percentage, class12_maths_percentage,
    marks_physics_12, marks_chemistry_12, marks_maths_12, jee_registered, entrance_percentile, jee_main_maths_percentile,
    exam_percentile, exam_obtained_marks, exam_max_marks, vps_score, counselling_mode)
  values (p_id, u, p_id, 'ZZTEST ' || p_id, lower(p_id) || '@example.invalid', 'Ajeenkya DY Patil University — Pune', p_date,
    2024, 90, 85, 2026, 80, 70, 70, 70, 70, false, null, null, 80, 40, 50, 8.43, p_mode);
  update public.application_manager set exam_given = true where application_id = p_id;
  foreach s in array array['vsat_cleared', 'interview_scheduled', 'interviewed', 'pi_cleared'] loop
    perform public.vsat__move(p_id, s, 'active', 'zz test', 'system', null, null);
  end loop;
  return p_id;
end $$;

create or replace function pg_temp.call_as(p_uid uuid, p_sql text, p_role text default 'authenticated')
returns jsonb language plpgsql as $$
declare r jsonb;
begin
  if p_role = 'service_role' then
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

create or replace function pg_temp.slot(p_days int)
returns text language sql as $$ select to_char(now() + make_interval(days => p_days), 'YYYY-MM-DD"T"HH24:00:00"Z"') $$;

create or replace function pg_temp.run_vsat_counselling_offline_tests()
returns table (test text, pass boolean, detail text) language plpgsql as $$
declare
  t_name text[] := '{}'; t_pass boolean[] := '{}'; t_det text[] := '{}';
  adm uuid; c1 uuid; c2 uuid; d uuid; o1 text; o2 text; o3 text; n1 text; x1 text;
  r jsonb; s text; n int; ca public.counselling_assignments;
  zl text := 'https://us06web.zoom.us/j/33333333333?pwd=zzoff';
begin
  begin -- rolled back at the end (ZDONE)
    adm := pg_temp.mk_user('zztest-off-adm@example.invalid');
    c1 := pg_temp.mk_user('zztest-off-cou1@example.invalid');
    c2 := pg_temp.mk_user('zztest-off-cou2@example.invalid');  -- no Zoom link
    insert into public.vsat_team (user_id, role, campus) values (adm, 'admissions', null), (c1, 'counsellor', null), (c2, 'counsellor', null);
    insert into public.vsat_counsellor_zoom (counsellor_id, zoom_link) values (c1, zl);
    insert into public.vsat_exam_dates (label, wheebox_test_id, exam_date, start_at, end_at)
    values ('ZZTEST OFF VSAT', 'zz-off', current_date, now(), now() + interval '2 hours') returning id into d;
    o1 := pg_temp.mk_app('ZZT-OFF-1', d, 'offline');
    o2 := pg_temp.mk_app('ZZT-OFF-2', d, 'offline');
    o3 := pg_temp.mk_app('ZZT-OFF-3', d, 'online');   -- booked online, then changed to offline
    n1 := pg_temp.mk_app('ZZT-OFF-N', d, 'online');
    x1 := pg_temp.mk_app('ZZT-OFF-X', d, null);

    -- ── A. an offline student's session is recorded ──
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_assign_counsellor', jsonb_build_object('application_id', o1, 'counsellor_id', c2, 'slot_datetime', pg_temp.slot(3))));
    select * into ca from public.counselling_assignments x where x.application_id = o1;
    t_name := t_name || text 'A an offline student is recorded with a counsellor and a date, even one without a Zoom link: no link, no calendar work';
    t_det := t_det || format('%s | mode=%s link=%s sync=%s', left(coalesce(r->>'message', 'ok'), 60), ca.meet_mode, coalesce(ca.zoom_link, '-'), ca.meet_sync);
    t_pass := t_pass || coalesce(not (r ? 'sqlstate') and ca.meet_mode = 'offline' and ca.zoom_link is null and ca.meet_sync = 'none' and ca.counsellor_id = c2, false);
    r := pg_temp.call_as(null, pg_temp.rpc('vsat_counselling_notices_claim', jsonb_build_object('application_ids', jsonb_build_array(o1), 'wait_for_meet', false)), 'service_role');
    select string_agg(e.kind || '/' || e.notify_status || '/' || coalesce(e.notify_detail->>'why', ''), ',') into s from public.vsat_counselling_events e where e.application_id = o1;
    t_name := t_name || text 'A no email goes out for an offline session (the job is skipped: offline)';
    t_det := t_det || format('claimed=%s | %s', jsonb_array_length(r), coalesce(s, '-'));
    t_pass := t_pass || coalesce(jsonb_array_length(r) = 0 and s = 'scheduled/skipped/offline', false);
    r := pg_temp.call_as(null, pg_temp.rpc('vsat_counselling_sync_claim', jsonb_build_object('application_ids', jsonb_build_array(o1))), 'service_role');
    t_name := t_name || text 'A the calendar job has nothing to do for it';
    t_det := t_det || left(r::text, 100); t_pass := t_pass || coalesce(jsonb_array_length(r) = 0, false);

    -- ── B. Send from the rows ──
    insert into public.vsat_counselling_drafts (application_id, attempt_no, counsellor_id, slot_datetime) values (o2, 1, c1, (now() + interval '4 days')::timestamptz);
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_counselling_drafts_send', jsonb_build_object('application_ids', jsonb_build_array(o2))));
    t_name := t_name || text 'B Send records an offline row too (no invite)';
    t_det := t_det || left(r::text, 200);
    t_pass := t_pass || coalesce(jsonb_array_length(r->'sent') = 1 and (select x.meet_mode from public.counselling_assignments x where x.application_id = o2) = 'offline', false);

    -- ── C. online → offline ──
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_assign_counsellor', jsonb_build_object('application_id', o3, 'counsellor_id', c1, 'slot_datetime', pg_temp.slot(5))));
    update public.counselling_assignments x set meet_sync = 'ok', calendar_event_id = 'vczztestoffline0g0', meet_claimed_at = null where x.application_id = o3;
    update public.vsat_counselling_events e set notify_status = 'sent' where e.application_id = o3;
    update public.application_manager set counselling_mode = 'offline' where application_id = o3;
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_assign_counsellor', jsonb_build_object('application_id', o3, 'counsellor_id', c1, 'slot_datetime', pg_temp.slot(6))));
    select * into ca from public.counselling_assignments x where x.application_id = o3;
    t_name := t_name || text 'C a booking changed from online to offline: Zoom link gone, the old calendar invite is queued for removal';
    t_det := t_det || format('%s | mode=%s link=%s sync=%s ev=%s', left(coalesce(r->>'message', 'ok'), 60), ca.meet_mode, coalesce(ca.zoom_link, '-'), ca.meet_sync, ca.calendar_event_id);
    t_pass := t_pass || coalesce(ca.meet_mode = 'offline' and ca.zoom_link is null and ca.meet_sync = 'pending' and ca.calendar_event_id is not null, false);
    r := pg_temp.call_as(null, pg_temp.rpc('vsat_counselling_notices_claim', jsonb_build_object('application_ids', jsonb_build_array(o3), 'wait_for_meet', false)), 'service_role');
    t_name := t_name || text 'C …and no "moved" email for it';
    t_det := t_det || format('claimed=%s', jsonb_array_length(r)); t_pass := t_pass || coalesce(jsonb_array_length(r) = 0, false);
    r := pg_temp.call_as(null, pg_temp.rpc('vsat_counselling_sync_claim', jsonb_build_object('application_ids', jsonb_build_array(o3))), 'service_role');
    t_name := t_name || text 'C …the calendar job gets it as offline with the old event, so it deletes that event (no Zoom link handed over)';
    t_det := t_det || left(r::text, 200);
    t_pass := t_pass || coalesce(jsonb_array_length(r) = 1 and r->0->>'meet_mode' = 'offline' and r->0->>'calendar_event_id' = 'vczztestoffline0g0'
                                 and r->0->'zoom_link' = 'null'::jsonb, false);

    -- ── D. the form ──
    r := pg_temp.call_as(c2, pg_temp.rpc('vsat_submit_counselling', jsonb_build_object('application_id', o1, 'offline_form_filled', 'yes')));
    t_name := t_name || text 'D Offline Form Filled must be yes / no (true / false)';
    t_det := t_det || coalesce(r->>'message', 'not refused'); t_pass := t_pass || coalesce(r->>'message' = 'BAD_VALUE: offline_form_filled', false);
    r := pg_temp.call_as(c2, pg_temp.rpc('vsat_submit_counselling', jsonb_build_object('application_id', o1, 'feedback', 'likely', 'offline_form_filled', true,
           'remarks', 'zz came with father')));
    select * into ca from public.counselling_assignments x where x.application_id = o1;
    t_name := t_name || text 'D the counsellor saves the offline student''s form (Offline Form Filled = yes)';
    t_det := t_det || format('%s | off=%s fb=%s sub=%s', left(r::text, 100), ca.offline_form_filled, ca.counsellor_feedback, ca.submitted_at is not null);
    t_pass := t_pass || coalesce(not (r ? 'sqlstate') and ca.offline_form_filled and ca.counsellor_feedback = 'likely' and ca.submitted_at is not null, false);

    -- ── E. the table ──
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_grid_list', jsonb_build_object('application_ids', jsonb_build_array(o1), 'columns',
           jsonb_build_array('counselling_meet', 'cs_offline_form_filled', 'counselling_mode'))));
    t_name := t_name || text 'E the Meet column says offline; Offline Form Filled is a column';
    t_det := t_det || left((r->'rows'->0)::text, 200);
    t_pass := t_pass || coalesce(r->'rows'->0->>'counselling_meet' = 'offline' and (r->'rows'->0->>'cs_offline_form_filled')::boolean
                                 and not (r->'rows'->0 ? 'counselling_meet_link'), false);
    select count(*) into n from public.vsat__grid_catalog() c where c.key = 'cs_offline_form_filled' and c.typ = 'bool' and c.grp = 'Counselling';
    t_name := t_name || text 'E the column is in the catalogue (Counselling, yes / no)';
    t_det := t_det || n::text; t_pass := t_pass || (n = 1);

    -- ── F. the student's card ──
    r := pg_temp.call_as((select am.lead_id from public.application_manager am where am.application_id = o2), 'select public.vsat_my_counselling()');
    t_name := t_name || text 'F the student sees the campus session (offline), with no link';
    t_det := t_det || r::text;
    t_pass := t_pass || coalesce(r->>'step' = 'counselling' and (r->>'offline')::boolean and not (r->>'has_link')::boolean and r->'meet_link' = 'null'::jsonb, false);
    update public.counselling_assignments x set slot_datetime = now() - interval '5 minutes' where x.application_id = o2;
    r := pg_temp.call_as((select am.lead_id from public.application_manager am where am.application_id = o2), 'select public.vsat_my_counselling()');
    t_name := t_name || text 'F …also during the session (no link is ever handed out)';
    t_det := t_det || r::text; t_pass := t_pass || coalesce(r->>'state' = 'open' and r->'meet_link' = 'null'::jsonb, false);

    -- ── G. online and not-chosen rules unchanged ──
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_assign_counsellor', jsonb_build_object('application_id', n1, 'counsellor_id', c2, 'slot_datetime', pg_temp.slot(7))));
    t_name := t_name || text 'G online still needs the counsellor''s Zoom link (NO_ZOOM_LINK)';
    t_det := t_det || coalesce(r->>'message', 'not refused'); t_pass := t_pass || coalesce(r->>'message' = 'NO_ZOOM_LINK', false);
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_assign_counsellor', jsonb_build_object('application_id', n1, 'counsellor_id', c1, 'slot_datetime', pg_temp.slot(7))));
    select * into ca from public.counselling_assignments x where x.application_id = n1;
    t_name := t_name || text 'G online is still on the Zoom link with the calendar invite queued';
    t_det := t_det || format('mode=%s sync=%s', ca.meet_mode, ca.meet_sync);
    t_pass := t_pass || coalesce(ca.meet_mode = 'zoom' and ca.zoom_link = zl and ca.meet_sync = 'pending', false);
    r := pg_temp.call_as(null, pg_temp.rpc('vsat_counselling_notices_claim', jsonb_build_object('application_ids', jsonb_build_array(n1), 'wait_for_meet', false)), 'service_role');
    t_name := t_name || text 'G online still gets its email (Zoom link)';
    t_det := t_det || left(r::text, 120);
    t_pass := t_pass || coalesce(jsonb_array_length(r) = 1 and r->0->>'meet_link' = zl, false);
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_assign_counsellor', jsonb_build_object('application_id', x1, 'counsellor_id', c1, 'slot_datetime', pg_temp.slot(8))));
    t_name := t_name || text 'G no mode chosen is still refused (MODE_NOT_CHOSEN)';
    t_det := t_det || coalesce(r->>'message', 'not refused'); t_pass := t_pass || coalesce(r->>'message' = 'MODE_NOT_CHOSEN', false);

    -- ── H. access unchanged ──
    t_name := t_name || text 'H the changed functions keep their access (definer, empty search_path; server jobs not callable by browsers)';
    select string_agg(p.proname, ',') into s from pg_proc p where p.pronamespace = 'public'::regnamespace
       and p.proname in ('vsat__cs_schedule', 'vsat_counselling_notices_claim', 'vsat_submit_counselling', 'vsat__grid_catalog', 'vsat__grid', 'vsat_my_counselling')
       and (not p.prosecdef or p.proconfig is distinct from array['search_path=""'] or has_function_privilege('anon', p.oid, 'execute')
            or (p.proname in ('vsat__cs_schedule', 'vsat_counselling_notices_claim', 'vsat__grid_catalog', 'vsat__grid') and has_function_privilege('authenticated', p.oid, 'execute'))
            or (p.proname in ('vsat_submit_counselling', 'vsat_my_counselling') and not has_function_privilege('authenticated', p.oid, 'execute')));
    t_det := t_det || coalesce(s, 'ok'); t_pass := t_pass || (s is null);

    raise exception using errcode = 'ZDONE';
  exception when sqlstate 'ZDONE' then null;
  end;

  return query select x.n, x.p, x.d from unnest(t_name, t_pass, t_det) as x(n, p, d);
end $$;

select test, coalesce(pass, false) as pass, detail from pg_temp.run_vsat_counselling_offline_tests();

-- VSAT pipeline grid · tests for migration 0097 (STAGING ONLY)
--
-- How to run: paste this whole file into the staging SQL editor, or run it through the
-- Supabase MCP. The last statement returns one row per test: test | pass | detail.
--
-- Nothing is left behind: all test data is created inside a block that is rolled back with a
-- private error code at the end. Fake data only (@example.invalid, ZZTEST names).

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

-- applicant at "vsat_cleared" with exam result and marks (VSAT 80% → 40/50)
create or replace function pg_temp.mk_app(p_id text, p_campus text, p_date uuid, p_mobile text)
returns text language plpgsql as $$
declare u uuid := pg_temp.mk_user(lower(p_id) || '@example.invalid');
begin
  insert into public.lead_manager (lead_id, registered_name, registered_email, lead_stage) values (u, 'ZZTEST ' || p_id, lower(p_id) || '@example.invalid', 'applicant_paid')
  on conflict (lead_id) do nothing;
  insert into public.application_manager (application_id, lead_id, application_no, registered_name, registered_email, registered_mobile, campus_applied, exam_date_id,
    class10_year, class10_percentage, class10_maths_percentage, class12_year, class12_percentage, class12_maths_percentage,
    marks_physics_12, marks_chemistry_12, marks_maths_12, jee_registered, entrance_percentile, jee_main_maths_percentile,
    exam_percentile, exam_obtained_marks, exam_max_marks, vps_score, family_income, father_mobile)
  values (p_id, u, p_id, 'ZZTEST ' || p_id, lower(p_id) || '@example.invalid', p_mobile, p_campus, p_date,
    2024, 90, 85, 2026, 80, 70, 70, 70, 70, false, null, null, 80, 40, 50, 8.43, '10-15 lakh', '9000000000');
  update public.application_manager set counselling_mode = 'online', counselling_mode_at = now() where application_id = p_id;  -- 0184 test setup: counselling is booked for online students only
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

-- every test request is scoped to the test students by name, so real staging rows never count
create or replace function pg_temp.q(p jsonb)
returns jsonb language sql as $$
  select jsonb_build_object('search', jsonb_build_object('column', '_any', 'values', '["zztest grd"]'::jsonb)) || coalesce(p, '{}'::jsonb)
$$;

-- 0166: booking no longer moves the stage, so admissions moves it by hand (as staff do now)
create or replace function pg_temp.move_to(p_adm uuid, p_app text, p_stage text)
returns jsonb language sql as $$
  select pg_temp.call_as(p_adm, pg_temp.rpc('vsat_move_stage', jsonb_build_object('application_id', p_app, 'to_stage', p_stage)))
$$;

create or replace function pg_temp.run_vsat_grid_tests()
returns table (test text, pass boolean, detail text) language plpgsql as $$
declare
  t_name text[] := '{}'; t_pass boolean[] := '{}'; t_det text[] := '{}';
  adm uuid; adm_pune uuid; int1 uuid; cou1 uuid; usr uuid; d1 uuid; d2 uuid; g1 text; g2 text; g3 text; g4 text;
  r jsonb; s text; n int; slot text := to_char(now() + interval '3 days', 'YYYY-MM-DD"T"HH24:00:00"Z"');
  many jsonb;
begin
  begin -- rolled back at the end (ZDONE)
    adm := pg_temp.mk_user('zztest-grd-admin@example.invalid');
    insert into public.user_roles (user_id, role) values (adm, 'admin');
    adm_pune := pg_temp.mk_user('zztest-grd-adm-pune@example.invalid');
    int1 := pg_temp.mk_user('zztest-grd-int1@example.invalid');
    cou1 := pg_temp.mk_user('zztest-grd-cou1@example.invalid');
    usr  := pg_temp.mk_user('zztest-grd-user@example.invalid');
    insert into public.vsat_team (user_id, role, campus) values (adm_pune, 'admissions', 'pune'), (int1, 'interviewer', null), (cou1, 'counsellor', null);
    insert into public.vsat_counsellor_zoom (counsellor_id, zoom_link) values (cou1, 'https://zoom.us/j/zztest-cou1');  -- 0184 test setup: counselling runs on the counsellor's own Zoom link
    insert into public.vsat_exam_dates (label, wheebox_test_id, exam_date, start_at, end_at)
    values ('ZZTEST VSAT-G1', 'zz-grd-1', current_date, now(), now() + interval '2 hours') returning id into d1;
    insert into public.vsat_exam_dates (label, wheebox_test_id, exam_date, start_at, end_at)
    values ('ZZTEST VSAT-G2', 'zz-grd-2', current_date + 7, now() + interval '7 days', now() + interval '7 days 2 hours') returning id into d2;
    g1 := pg_temp.mk_app('GRD1', 'Ajeenkya DY Patil University — Pune', d1, '9876500001');
    g2 := pg_temp.mk_app('GRD2', 'Sushant University — Gurugram', d1, '9876500002');
    g3 := pg_temp.mk_app('GRD3', 'Ajeenkya DY Patil University — Pune', d2, '9876500003');
    g4 := pg_temp.mk_app('GRD4', 'Ajeenkya DY Patil University — Pune', d2, '9876500004');
    -- g3: interview scheduled with int1 · g4: counselling scheduled with cou1 · g2: on hold
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_assign_interview', jsonb_build_object('application_id', g3, 'interviewer_id', int1, 'slot_datetime', slot)));
    if r ? 'sqlstate' then raise exception 'fixture g3: %', r; end if;
    r := pg_temp.move_to(adm, g3, 'interview_scheduled');  -- 0166: by hand
    if (select vp.stage from public.vsat_pipeline vp where vp.application_id = g3) <> 'interview_scheduled' then raise exception 'fixture g3: %', r; end if;
    perform public.vsat__move(g4, 'pi_cleared', 'active', 'zz test', 'system', null, null);
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_assign_counsellor', jsonb_build_object('application_id', g4, 'counsellor_id', cou1, 'slot_datetime', slot)));
    if r ? 'sqlstate' then raise exception 'fixture g4: %', r; end if;
    r := pg_temp.move_to(adm, g4, 'counselling_scheduled');  -- 0166: by hand
    if (select vp.stage from public.vsat_pipeline vp where vp.application_id = g4) <> 'counselling_scheduled' then raise exception 'fixture g4: %', r; end if;
    perform public.vsat__move(g2, 'vsat_cleared', 'on_hold', 'zz test', 'system', null, null);
    -- form-stage / payment-stage dimensions (0117): g1,g2 submitted+approved · g3 not_started+not_initiated · g4 documents+initiated
    update public.application_manager set form_stage_1 = 'form_submitted',     payment_stage_1 = 'payment_approved'      where application_id in (g1, g2);
    update public.application_manager set form_stage_1 = 'not_started',        payment_stage_1 = 'payment_not_initiated' where application_id = g3;
    update public.application_manager set form_stage_1 = 'documents_uploaded', payment_stage_1 = 'payment_initiated'     where application_id = g4;

    -- ════ A. access ════
    r := pg_temp.call_as(null, pg_temp.rpc('vsat_grid_list', pg_temp.q(null)), true);
    t_name := t_name || text 'A anon cannot call the grid'; t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = '42501');
    r := pg_temp.call_as(usr, pg_temp.rpc('vsat_grid_list', pg_temp.q(null)));
    t_name := t_name || text 'A a signed-in user with no VSAT role is refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'FORBIDDEN');
    r := pg_temp.call_as(adm, 'select public.vsat__grid(''{}''::jsonb, 10, true, false)');
    t_name := t_name || text 'A the private engine is not callable by browsers'; t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = '42501');
    r := pg_temp.call_as(adm, 'select to_jsonb(count(*)) from public.vsat_grid_audit');
    t_name := t_name || text 'A the audit table is not readable by browsers'; t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = '42501');

    -- ════ B. admin: totals and dropdown counts (facets) ════
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_grid_list', pg_temp.q(null)));
    t_name := t_name || text 'B admin sees all 4 test students; stage counts per stage';
    t_det := t_det || left(r::text, 300);
    t_pass := t_pass || ((r->>'total')::int = 4 and (r->'facets'->'stage'->>'vsat_cleared')::int = 2
                         and (r->'facets'->'stage'->>'interview_scheduled')::int = 1 and (r->'facets'->'stage'->>'counselling_scheduled')::int = 1
                         and (r->>'can_manage')::boolean);
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_grid_list', pg_temp.q('{"stages":["vsat_cleared"]}')));
    t_name := t_name || text 'B stage filter narrows the rows but the stage dropdown still counts every stage';
    t_det := t_det || left((r->'facets')::text, 300);
    t_pass := t_pass || ((r->>'total')::int = 2 and (r->'facets'->'stage'->>'interview_scheduled')::int = 1
                         and (r->'facets'->'status'->>'active')::int = 1 and (r->'facets'->'status'->>'on_hold')::int = 1);
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_grid_list', pg_temp.q('{"stages":["vsat_cleared"],"campuses":["pune"]}')));
    t_name := t_name || text 'B stage + campus mix: 1 row; campus dropdown counts both campuses within the stage';
    t_det := t_det || left((r->'facets')::text, 300);
    t_pass := t_pass || ((r->>'total')::int = 1 and (r->'facets'->'campus'->>'pune')::int = 1 and (r->'facets'->'campus'->>'gurugram')::int = 1
                         and (r->'facets'->'stage'->>'vsat_cleared')::int = 1 and (r->'facets'->'stage'->>'interview_scheduled')::int = 1);
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_grid_list', pg_temp.q(jsonb_build_object('exam_date_ids', jsonb_build_array(d2)))));
    t_name := t_name || text 'B VSAT filter: 2 rows; VSAT dropdown counts both VSATs';
    t_det := t_det || left((r->'facets'->'vsat')::text, 300);
    t_pass := t_pass || ((r->>'total')::int = 2 and (r->'facets'->'vsat'->>(d1::text))::int = 2 and (r->'facets'->'vsat'->>(d2::text))::int = 2);
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_grid_list', pg_temp.q('{"statuses":["on_hold"]}')));
    t_name := t_name || text 'B status filter → the on-hold student only'; t_det := t_det || left(r::text, 200);
    t_pass := t_pass || ((r->>'total')::int = 1 and r->'rows'->0->>'application_id' = g2);
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_grid_list', pg_temp.q('{"scope":["vsat_cleared","interview_scheduled","interviewed","pi_cleared"]}')));
    t_name := t_name || text 'B a panel scope (Interview panel) limits the universe: counselling student is outside it';
    t_det := t_det || left((r->'facets'->'stage')::text, 200);
    t_pass := t_pass || ((r->>'total')::int = 3 and r->'facets'->'stage'->'counselling_scheduled' is null);
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_grid_list', pg_temp.q('{"limit": 999, "offset": 1}')));
    t_name := t_name || text 'B limit is capped at 200; offset pages through the rows';
    t_det := t_det || format('limit=%s rows=%s total=%s', r->>'limit', jsonb_array_length(r->'rows'), r->>'total');
    t_pass := t_pass || ((r->>'limit')::int = 200 and jsonb_array_length(r->'rows') = 3 and (r->>'total')::int = 4);

    -- ════ C. columns ════
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_grid_list', pg_temp.q(jsonb_build_object('stages', '["vsat_cleared"]'::jsonb, 'campuses', '["pune"]'::jsonb,
           'columns', '["registered_email","registered_mobile","vsat","vps_effective","eligible_effective","class12_percentage","campus","family_income","interviewer"]'::jsonb))));
    t_name := t_name || text 'C admin gets real, virtual and restricted columns in one row';
    t_det := t_det || left((r->'rows'->0)::text, 400);
    t_pass := t_pass || (r->'rows'->0->>'registered_email' = 'grd1@example.invalid' and r->'rows'->0->>'registered_mobile' = '9876500001'
                         and r->'rows'->0->>'vsat' = 'ZZTEST VSAT-G1' and (r->'rows'->0->>'vps_effective')::numeric = 8.43
                         and (r->'rows'->0->>'eligible_effective')::boolean and (r->'rows'->0->>'class12_percentage')::numeric = 80
                         and r->'rows'->0->>'campus' = 'pune' and r->'rows'->0->>'family_income' = '10-15 lakh' and r->'rows'->0->'interviewer' = 'null'::jsonb
                         and r->'rows'->0->>'stage' = 'vsat_cleared');
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_grid_list', pg_temp.q('{"columns":["aadhaar_url"]}')));
    t_name := t_name || text 'C document links are not available to anyone through the grid'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'FORBIDDEN_COLUMN: aadhaar_url');
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_grid_list', pg_temp.q('{"columns":["form_data"]}')));
    t_name := t_name || text 'C jsonb blobs are hidden'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'FORBIDDEN_COLUMN: form_data');
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_grid_list', pg_temp.q('{"columns":["no_such_column"]}')));
    t_name := t_name || text 'C an unknown column is refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'BAD_VALUE: columns');
    r := pg_temp.call_as(adm, 'select public.vsat_grid_columns()');
    t_name := t_name || text 'C column list for admin: contact + finance in, document links and blobs out';
    t_det := t_det || format('%s columns', jsonb_array_length(r->'columns'));
    t_pass := t_pass || ((r->>'can_manage')::boolean
                         and exists (select 1 from jsonb_array_elements(r->'columns') c where c->>'key' = 'registered_email' and (c->>'restricted')::boolean)
                         and exists (select 1 from jsonb_array_elements(r->'columns') c where c->>'key' = 'class12_percentage' and c->>'group' = 'Academics')
                         and not exists (select 1 from jsonb_array_elements(r->'columns') c where c->>'key' like '%\_url' or c->>'key' in ('form_data', 'lead_id', 'application_id'))
                         and jsonb_array_length(r->'columns') > 250);
    r := pg_temp.call_as(int1, 'select public.vsat_grid_columns()');
    t_name := t_name || text 'C column list for an interviewer: no contact, no finance, no documents';
    t_det := t_det || format('%s columns', jsonb_array_length(r->'columns'));
    t_pass := t_pass || (not (r->>'can_manage')::boolean
                         and not exists (select 1 from jsonb_array_elements(r->'columns') c where c->>'key' in ('registered_email', 'registered_mobile', 'father_mobile', 'family_income', 'payment_status', 'order_id', 'wheebox_login_id', 'aadhaar_url'))
                         and exists (select 1 from jsonb_array_elements(r->'columns') c where c->>'key' = 'class12_percentage')
                         and exists (select 1 from jsonb_array_elements(r->'columns') c where c->>'key' = 'interviewer'));

    -- ════ D. interviewer / counsellor / campus-scoped admissions ════
    r := pg_temp.call_as(int1, pg_temp.rpc('vsat_grid_list', pg_temp.q('{"columns":["class12_percentage","interviewer","interview_slot"]}')));
    t_name := t_name || text 'D interviewer sees only the assigned student, with the interview columns';
    t_det := t_det || left(r::text, 300);
    t_pass := t_pass || ((r->>'total')::int = 1 and r->'rows'->0->>'application_id' = g3 and r->'rows'->0->>'interviewer' = 'ZZTEST zztest-grd-int1'
                         and r->'rows'->0->'interview_slot' <> 'null'::jsonb and not (r->>'can_manage')::boolean
                         and r->'facets'->'stage' = '{"interview_scheduled": 1}'::jsonb);
    r := pg_temp.call_as(int1, pg_temp.rpc('vsat_grid_list', pg_temp.q('{"columns":["registered_email"]}')));
    t_name := t_name || text 'D interviewer asking for a contact column is refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'FORBIDDEN_COLUMN: registered_email');
    r := pg_temp.call_as(int1, pg_temp.rpc('vsat_grid_list', pg_temp.q('{"columns":["family_income"]}')));
    t_name := t_name || text 'D interviewer asking for family income is refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'FORBIDDEN_COLUMN: family_income');
    r := pg_temp.call_as(cou1, pg_temp.rpc('vsat_grid_list', pg_temp.q('{"columns":["counsellor","counselling_pct"]}')));
    t_name := t_name || text 'D counsellor sees only the assigned student, with the counselling columns';
    t_det := t_det || left(r::text, 300);
    t_pass := t_pass || ((r->>'total')::int = 1 and r->'rows'->0->>'application_id' = g4 and r->'rows'->0->>'counsellor' = 'ZZTEST zztest-grd-cou1'
                         and r->'rows'->0->'counselling_pct' = 'null'::jsonb);
    r := pg_temp.call_as(adm_pune, pg_temp.rpc('vsat_grid_list', pg_temp.q('{"columns":["registered_email"]}')));
    t_name := t_name || text 'D admissions (Pune) sees the 3 Pune students with contact columns, not the Gurugram one';
    t_det := t_det || left(r::text, 200);
    t_pass := t_pass || ((r->>'total')::int = 3 and (r->>'can_manage')::boolean and r->'facets'->'campus' = '{"pune": 3}'::jsonb
                         and not exists (select 1 from jsonb_array_elements(r->'rows') x where x->>'application_id' = g2));

    -- ════ E. multi-value search ════
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_grid_list', jsonb_build_object('exam_date_ids', jsonb_build_array(d1, d2),
           'search', '{"column":"application_no","values":["GRD1","grd3"," GRD9 "]}'::jsonb)));
    t_name := t_name || text 'E pasted application numbers → one row each (case-insensitive, unknown ones ignored)';
    t_det := t_det || left(r::text, 200);
    t_pass := t_pass || ((r->>'total')::int = 2 and exists (select 1 from jsonb_array_elements(r->'rows') x where x->>'application_id' = g1)
                         and exists (select 1 from jsonb_array_elements(r->'rows') x where x->>'application_id' = g3));
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_grid_list', '{"search":{"column":"registered_mobile","values":["+91 98765-00002","98765 00004"]}}'));
    t_name := t_name || text 'E mobile search matches on digits only (+91, spaces, dashes ignored)';
    t_det := t_det || left(r::text, 200);
    t_pass := t_pass || ((r->>'total')::int = 2 and exists (select 1 from jsonb_array_elements(r->'rows') x where x->>'application_id' = g2)
                         and exists (select 1 from jsonb_array_elements(r->'rows') x where x->>'application_id' = g4));
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_grid_list', jsonb_build_object('exam_date_ids', jsonb_build_array(d1), 'campuses', '["gurugram"]'::jsonb,
           'search', '{"column":"class12_percentage","values":["80"]}'::jsonb)));
    t_name := t_name || text 'E a numeric column can be searched as text'; t_det := t_det || left(r::text, 120);
    t_pass := t_pass || ((r->>'total')::int = 1 and r->'rows'->0->>'application_id' = g2);
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_grid_list', '{"search":{"column":"_any","values":["grd2@example.invalid"]}}'));
    t_name := t_name || text 'E "all fields" search finds an email for a manager'; t_det := t_det || left(r::text, 120); t_pass := t_pass || ((r->>'total')::int = 1);
    r := pg_temp.call_as(int1, pg_temp.rpc('vsat_grid_list', '{"search":{"column":"_any","values":["grd3@example.invalid"]}}'));
    t_name := t_name || text 'E "all fields" search does NOT look at email / mobile for an interviewer'; t_det := t_det || left(r::text, 120); t_pass := t_pass || ((r->>'total')::int = 0);
    r := pg_temp.call_as(int1, pg_temp.rpc('vsat_grid_list', '{"search":{"column":"_any","values":["zztest grd3"]}}'));
    t_name := t_name || text 'E … but finds the student by name'; t_det := t_det || left(r::text, 120); t_pass := t_pass || ((r->>'total')::int = 1);
    r := pg_temp.call_as(int1, pg_temp.rpc('vsat_grid_list', '{"search":{"column":"registered_mobile","values":["9876500003"]}}'));
    t_name := t_name || text 'E interviewer cannot search a contact column'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'FORBIDDEN_COLUMN: registered_mobile');
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_grid_list', '{"search":{"column":"vsat","values":["G1"]}}'));
    t_name := t_name || text 'E search on a virtual column is refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'BAD_VALUE: column');
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_grid_list', '{"search":{"column":"registered_name\" or 1=1 --","values":["zz"]}}'));
    t_name := t_name || text 'E a made-up column name is refused before any SQL runs'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'BAD_VALUE: column');
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_grid_list', '{"search":{"column":"registered_name","values":["a"]}}'));
    t_name := t_name || text 'E a 1-character value is refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'BAD_VALUE: values');
    select jsonb_agg('v' || i) into many from generate_series(1, 201) i;
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_grid_list', jsonb_build_object('search', jsonb_build_object('column', 'registered_name', 'values', many))));
    t_name := t_name || text 'E more than 200 pasted values are refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'BAD_VALUE: values');
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_grid_list', '{"search":{"column":"registered_name","values":["50%"]}}'));
    t_name := t_name || text 'E % and _ in a value are matched literally (no wildcard injection)'; t_det := t_det || left(r::text, 120); t_pass := t_pass || ((r->>'total')::int = 0);

    -- ════ F. bad requests ════
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_grid_list', '{"foo":1}'));
    t_name := t_name || text 'F unknown key refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' like 'UNKNOWN_KEY%');
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_grid_list', '{"stages":["nope"]}'));
    t_name := t_name || text 'F bad stage refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'BAD_STAGE');
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_grid_list', '{"statuses":["maybe"]}'));
    t_name := t_name || text 'F bad status refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'BAD_STATUS');
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_grid_list', '{"campuses":["mumbai"]}'));
    t_name := t_name || text 'F bad campus refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'BAD_VALUE: campuses');
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_grid_list', '{"exam_date_ids":["not-a-uuid"]}'));
    t_name := t_name || text 'F bad VSAT id refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'BAD_VALUE: exam_date_ids');
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_grid_list', '{"stages":"vsat_cleared"}'));
    t_name := t_name || text 'F a filter that is not a list is refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'BAD_VALUE: stages');

    -- ════ G. export (CSV / Send Communication) ════
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_grid_export', pg_temp.q('{"purpose":"csv","columns":["registered_name","registered_mobile","vsat"]}')));
    t_name := t_name || text 'G admin CSV export returns the whole filtered set with the chosen columns';
    t_det := t_det || left(r::text, 300);
    t_pass := t_pass || ((r->>'total')::int = 4 and jsonb_array_length(r->'rows') = 4 and r->>'purpose' = 'csv'
                         and exists (select 1 from jsonb_array_elements(r->'rows') x where x->>'application_id' = g1 and x->>'registered_mobile' = '9876500001' and x->>'vsat' = 'ZZTEST VSAT-G1'));
    select count(*) into n from public.vsat_grid_audit a where a.user_id = adm and a.purpose = 'csv' and a.row_count = 4 and a.columns @> array['registered_mobile'] and a.filters ? 'search';
    t_name := t_name || text 'G … and writes one audit row (who, purpose, filters, columns, count)'; t_det := t_det || format('audit rows: %s', n); t_pass := t_pass || (n = 1);
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_grid_export', jsonb_build_object('purpose', 'comms', 'application_ids', jsonb_build_array(g1, g2))));
    t_name := t_name || text 'G recipients for Send Communication: the selected students with name, email, mobile';
    t_det := t_det || left(r::text, 300);
    t_pass := t_pass || ((r->>'total')::int = 2 and r->>'purpose' = 'comms'
                         and exists (select 1 from jsonb_array_elements(r->'rows') x where x->>'application_id' = g2 and x->>'registered_email' = 'grd2@example.invalid' and x->>'registered_mobile' = '9876500002'));
    select count(*) into n from public.vsat_grid_audit a where a.user_id = adm and a.purpose = 'comms' and a.row_count = 2;
    t_name := t_name || text 'G … audited as comms'; t_det := t_det || format('audit rows: %s', n); t_pass := t_pass || (n = 1);
    r := pg_temp.call_as(adm_pune, pg_temp.rpc('vsat_grid_export', pg_temp.q('{"purpose":"csv","columns":["registered_name"]}')));
    t_name := t_name || text 'G admissions export stays within their campus'; t_det := t_det || left(r::text, 120); t_pass := t_pass || ((r->>'total')::int = 3);
    r := pg_temp.call_as(int1, pg_temp.rpc('vsat_grid_export', pg_temp.q('{"purpose":"csv","columns":["registered_name"]}')));
    t_name := t_name || text 'G interviewer cannot export'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'FORBIDDEN');
    r := pg_temp.call_as(cou1, pg_temp.rpc('vsat_grid_export', '{"purpose":"comms"}'));
    t_name := t_name || text 'G counsellor cannot pull recipients'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'FORBIDDEN');
    select count(*) into n from public.vsat_grid_audit a where a.user_id in (int1, cou1);
    t_name := t_name || text 'G refused exports leave no audit row'; t_det := t_det || format('%s', n); t_pass := t_pass || (n = 0);
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_grid_export', pg_temp.q('{"purpose":"pdf"}')));
    t_name := t_name || text 'G bad purpose refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'BAD_VALUE: purpose');
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_grid_export', pg_temp.q('{"purpose":"csv","columns":["aadhaar_url"]}')));
    t_name := t_name || text 'G export cannot take document links either'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'FORBIDDEN_COLUMN: aadhaar_url');

    -- ════ H. grants ════
    t_name := t_name || text 'H new RPCs: authenticated only, security definer, empty search_path; engine and catalogue private';
    select string_agg(p.proname, ',') into s from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname in ('vsat_grid_columns', 'vsat_grid_list', 'vsat_grid_export')
       and not (has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
                and p.prosecdef and p.proconfig = array['search_path=""']);
    t_det := t_det || coalesce(s, 'all ok');
    t_pass := t_pass || (s is null and not exists (select 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
                          where ns.nspname = 'public' and p.proname in ('vsat__grid', 'vsat__grid_catalog', 'vsat__grid_may_see')
                            and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute')))
                         and (select relrowsecurity from pg_class where oid = 'public.vsat_grid_audit'::regclass)
                         and not has_table_privilege('authenticated', 'public.vsat_grid_audit', 'select'));

    -- ════ I. form-stage / payment-stage dimensions (0117) ════
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_grid_list', pg_temp.q(null)));
    t_name := t_name || text 'I admin: form_stage + payment_stage facets present with counts';
    t_det := t_det || left((r->'facets'->'form_stage')::text || ' ' || (r->'facets'->'payment_stage')::text, 300);
    t_pass := t_pass || ((r->'facets'->'form_stage'->>'form_submitted')::int = 2 and (r->'facets'->'form_stage'->>'not_started')::int = 1
                         and (r->'facets'->'form_stage'->>'documents_uploaded')::int = 1
                         and (r->'facets'->'payment_stage'->>'payment_approved')::int = 2 and (r->'facets'->'payment_stage'->>'payment_not_initiated')::int = 1
                         and (r->'facets'->'payment_stage'->>'payment_initiated')::int = 1);
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_grid_list', pg_temp.q('{"form_stages":["form_submitted"]}')));
    t_name := t_name || text 'I form filter narrows to the 2 submitted; payment facet respects it';
    t_det := t_det || left(r::text, 200);
    t_pass := t_pass || ((r->>'total')::int = 2 and (r->'facets'->'payment_stage'->>'payment_approved')::int = 2
                         and r->'facets'->'payment_stage'->'payment_not_initiated' is null);
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_grid_list', pg_temp.q('{"payment_stages":["payment_approved"]}')));
    t_name := t_name || text 'I payment filter narrows to the 2 approved';
    t_det := t_det || left(r::text, 160); t_pass := t_pass || ((r->>'total')::int = 2);
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_grid_list', pg_temp.q('{"form_stages":["form_submitted"],"payment_stages":["payment_not_initiated"]}')));
    t_name := t_name || text 'I form + payment mix (submitted AND not-initiated) → none of the test students';
    t_det := t_det || left(r::text, 160); t_pass := t_pass || ((r->>'total')::int = 0);
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_grid_list', pg_temp.q('{"form_stages":["banana"]}')));
    t_name := t_name || text 'I a form value outside the enum is refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'BAD_VALUE: form_stages');
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_grid_list', pg_temp.q('{"payment_stages":["refunded"]}')));
    t_name := t_name || text 'I a payment value outside the enum is refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'BAD_VALUE: payment_stages');
    r := pg_temp.call_as(int1, pg_temp.rpc('vsat_grid_list', pg_temp.q(null)));
    t_name := t_name || text 'I interviewer: payment_stage facet is hidden ({}), form_stage facet still shown';
    t_det := t_det || left((r->'facets'->'payment_stage')::text || ' ' || (r->'facets'->'form_stage')::text, 200);
    t_pass := t_pass || (r->'facets'->'payment_stage' = '{}'::jsonb and (r->'facets'->'form_stage'->>'not_started')::int = 1);
    r := pg_temp.call_as(int1, pg_temp.rpc('vsat_grid_list', pg_temp.q('{"payment_stages":["payment_approved"]}')));
    t_name := t_name || text 'I interviewer filtering by payment stage is refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'FORBIDDEN_COLUMN: payment_stage_1');
    r := pg_temp.call_as(int1, pg_temp.rpc('vsat_grid_list', pg_temp.q('{"form_stages":["not_started"]}')));
    t_name := t_name || text 'I interviewer can filter by form stage (open) → their assigned student';
    t_det := t_det || left(r::text, 160); t_pass := t_pass || ((r->>'total')::int = 1 and r->'rows'->0->>'application_id' = g3);

    -- ════ J. advanced filter builder (0118) ════
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_grid_list', pg_temp.q('{"filters":[{"column":"class12_percentage","op":"eq","v":"80"}]}')));
    t_name := t_name || text 'J numeric eq: all 4 test students are at 80%'; t_det := t_det || left(r::text, 120); t_pass := t_pass || ((r->>'total')::int = 4);
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_grid_list', pg_temp.q('{"filters":[{"column":"class12_percentage","op":"gt","v":"85"}]}')));
    t_name := t_name || text 'J numeric gt 85 → none'; t_det := t_det || left(r::text, 120); t_pass := t_pass || ((r->>'total')::int = 0);
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_grid_list', pg_temp.q('{"filters":[{"column":"class12_percentage","op":"between","v":["70","90"]}]}')));
    t_name := t_name || text 'J numeric between 70–90 → all 4'; t_det := t_det || left(r::text, 120); t_pass := t_pass || ((r->>'total')::int = 4);
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_grid_list', pg_temp.q('{"filters":[{"column":"registered_name","op":"contains","v":"grd1"},{"column":"class10_percentage","op":"gte","v":"90"}]}')));
    t_name := t_name || text 'J two AND-ed clauses (name contains + marks) → 1'; t_det := t_det || left(r::text, 160);
    t_pass := t_pass || ((r->>'total')::int = 1 and r->'rows'->0->>'application_id' = g1);
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_grid_list', pg_temp.q('{"filters":[{"column":"jee_registered","op":"false"}]}')));
    t_name := t_name || text 'J boolean filter (jee_registered is No) → all 4'; t_det := t_det || left(r::text, 120); t_pass := t_pass || ((r->>'total')::int = 4);
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_grid_list', pg_temp.q('{"filters":[{"column":"family_income","op":"in","v":["10-15 lakh","none"]}]}')));
    t_name := t_name || text 'J manager can filter a finance column; in-list → 4'; t_det := t_det || left(r::text, 120); t_pass := t_pass || ((r->>'total')::int = 4);
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_grid_list', pg_temp.q('{"filters":[{"column":"class12_percentage","op":"eq","v":"80"}],"form_stages":["not_started"]}')));
    t_name := t_name || text 'J advanced filter AND-s with the form dropdown → only g3'; t_det := t_det || left(r::text, 160);
    t_pass := t_pass || ((r->>'total')::int = 1 and r->'rows'->0->>'application_id' = g3);
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_grid_list', pg_temp.q('{"filters":[{"column":"registered_name","op":"eq","v":"x'' or 1=1 --"}]}')));
    t_name := t_name || text 'J a SQL-ish value is matched literally, not executed → 0'; t_det := t_det || left(r::text, 120); t_pass := t_pass || ((r->>'total')::int = 0);
    r := pg_temp.call_as(int1, pg_temp.rpc('vsat_grid_list', pg_temp.q('{"filters":[{"column":"family_income","op":"notnull"}]}')));
    t_name := t_name || text 'J interviewer filtering a finance column is refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'FORBIDDEN_COLUMN: family_income');
    r := pg_temp.call_as(int1, pg_temp.rpc('vsat_grid_list', pg_temp.q('{"filters":[{"column":"registered_email","op":"contains","v":"x"}]}')));
    t_name := t_name || text 'J interviewer filtering a contact column is refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'FORBIDDEN_COLUMN: registered_email');
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_grid_list', pg_temp.q('{"filters":[{"column":"aadhaar_url","op":"notnull"}]}')));
    t_name := t_name || text 'J document links cannot be filtered either'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'FORBIDDEN_COLUMN: aadhaar_url');
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_grid_list', pg_temp.q('{"filters":[{"column":"stage","op":"eq","v":"applied"}]}')));
    t_name := t_name || text 'J a virtual column cannot be filtered (use its dropdown)'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'BAD_VALUE: filters');
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_grid_list', pg_temp.q('{"filters":[{"column":"class12_percentage","op":"contains","v":"8"}]}')));
    t_name := t_name || text 'J an operator not allowed for the type is refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'BAD_VALUE: filters');
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_grid_list', pg_temp.q('{"filters":[{"column":"class12_percentage","op":"gte","v":"abc"}]}')));
    t_name := t_name || text 'J a value that will not cast to the column type is refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'BAD_VALUE: filters');
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_grid_list', pg_temp.q('{"filters":[{"column":"nope","op":"eq","v":"1"}]}')));
    t_name := t_name || text 'J an unknown column is refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'BAD_VALUE: filters');
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_grid_list', pg_temp.q('{"filters":[{"column":"class12_percentage","op":"gte","v":"7","evil":"x"}]}')));
    t_name := t_name || text 'J an unexpected key in a clause is refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' like 'UNKNOWN_KEY%');

    raise exception using errcode = 'ZDONE';
  exception when sqlstate 'ZDONE' then null;
  end;

  return query select x.n, x.p, x.d from unnest(t_name, t_pass, t_det) as x(n, p, d);
end $$;

select test, coalesce(pass, false) as pass, detail from pg_temp.run_vsat_grid_tests();

-- VSAT admin tools · database tests for migration 0169 (mock_reset / admin edit / exam-scores view).
-- STAGING ONLY. Paste into the staging SQL editor or run via Supabase MCP. Returns one row per test.
-- All data is created inside a block rolled back with a private error code — nothing is left behind.
-- Fake data only (ZZ names, @example.invalid e-mails).

do $$ begin
  if coalesce((select value from public.app_flags where key = 'environment'), '') <> 'staging' then
    raise exception 'not the staging database - refusing to run tests';
  end if;
end $$;

create or replace function pg_temp.mk_user(p_email text)
returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, aud, role, email_confirmed_at, raw_user_meta_data)
  values (v, p_email, 'authenticated', 'authenticated', now(), '{}'::jsonb);
  insert into public.profiles (id) values (v) on conflict (id) do nothing;
  return v;
end $$;

create or replace function pg_temp.mk_admin(p_uid uuid)
returns void language sql as $$
  insert into public.user_roles (user_id, role) values (p_uid, 'admin');
$$;

create or replace function pg_temp.call_as(p_uid uuid, p_sql text)
returns jsonb language plpgsql as $$
declare r jsonb;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  set local role authenticated;
  execute p_sql into r;
  reset role; perform set_config('request.jwt.claims', '', true);
  return coalesce(r, 'null'::jsonb);
exception when others then
  reset role; perform set_config('request.jwt.claims', '', true);
  return jsonb_build_object('sqlstate', sqlstate, 'message', sqlerrm);
end $$;

create or replace function pg_temp.run_tests()
returns table(test text, pass boolean, detail text) language plpgsql as $$
declare
  adm uuid; usr uuid; appl uuid;
  r jsonb; a record; n int;
  t text[] := '{}'; pz boolean[] := '{}'; d text[] := '{}'; i int;
begin
  begin  -- savepoint: everything below is rolled back at the end
    adm := pg_temp.mk_user('zz-adm@example.invalid'); perform pg_temp.mk_admin(adm);
    usr := pg_temp.mk_user('zz-usr@example.invalid');
    appl := pg_temp.mk_user('zz-appl@example.invalid');
    insert into public.lead_manager (lead_id) values (appl);
    insert into public.application_manager
      (application_id, lead_id, mock_given, mock_assigned, mock_launched_at, mock_result,
       exam_given, exam_obtained_marks, exam_max_marks, vsat_score_maths_1, vps_score_1,
       registered_name, registered_email, wheebox_login_id)
    values ('ZZ-ADMTEST-1', appl, true, true, now(), '{"Score":"20 / 200"}'::jsonb,
       true, 120, 200, 40, 55, 'ZZ Test', 'zz-admtest@example.invalid', 'ZZ-ADMTEST-1');

    r := pg_temp.call_as(adm, 'select public.vsat_mock_reset(''{"applicationId":"ZZ-ADMTEST-1"}''::jsonb)');
    select mock_given, mock_assigned, mock_launched_at, mock_result into a
      from public.application_manager where application_id = 'ZZ-ADMTEST-1';
    t := array_append(t,'mock_reset clears mock state'); d := array_append(d, r::text);
    pz := array_append(pz, ((r->>'ok')='true' and a.mock_given=false and a.mock_assigned=false
               and a.mock_launched_at is null and a.mock_result is null));

    r := pg_temp.call_as(adm, 'select public.vsat_application_admin_update(''{"applicationId":"ZZ-ADMTEST-1","changes":{"registered_name":"ZZ Renamed","vps_score_1":66}}''::jsonb)');
    select registered_name, vps_score_1 into a from public.application_manager where application_id='ZZ-ADMTEST-1';
    t := array_append(t,'edit normal columns'); d := array_append(d, r::text);
    pz := array_append(pz, ((r->>'ok')='true' and a.registered_name='ZZ Renamed' and a.vps_score_1=66));

    r := pg_temp.call_as(adm, 'select public.vsat_application_admin_update(''{"applicationId":"ZZ-ADMTEST-1","changes":{"wheebox_login_id":"ZZ-NEW"}}''::jsonb)');
    t := array_append(t,'ID change blocked without confirmIds'); d := array_append(d, r::text);
    pz := array_append(pz, (r->>'message' like '%CONFIRM_IDS%'));

    r := pg_temp.call_as(adm, 'select public.vsat_application_admin_update(''{"applicationId":"ZZ-ADMTEST-1","changes":{"wheebox_login_id":"ZZ-NEW"},"confirmIds":true}''::jsonb)');
    select wheebox_login_id into a from public.application_manager where application_id='ZZ-ADMTEST-1';
    t := array_append(t,'ID change allowed with confirmIds'); d := array_append(d, r::text);
    pz := array_append(pz, ((r->>'ok')='true' and a.wheebox_login_id='ZZ-NEW'));

    r := pg_temp.call_as(adm, 'select public.vsat_application_admin_update(''{"applicationId":"ZZ-ADMTEST-1","changes":{"not_a_real_col":"x"}}''::jsonb)');
    t := array_append(t,'unknown column rejected'); d := array_append(d, r::text);
    pz := array_append(pz, (r->>'message' like '%BAD_COLUMN%'));

    r := pg_temp.call_as(adm, 'select public.vsat_application_admin_update(''{"applicationId":"ZZ-ADMTEST-1","changes":{"lead_id":"00000000-0000-0000-0000-000000000000"}}''::jsonb)');
    t := array_append(t,'locked column lead_id rejected'); d := array_append(d, r::text);
    pz := array_append(pz, (r->>'message' like '%BAD_COLUMN%'));

    r := pg_temp.call_as(usr, 'select public.vsat_mock_reset(''{"applicationId":"ZZ-ADMTEST-1"}''::jsonb)');
    t := array_append(t,'non-admin forbidden (mock_reset)'); d := array_append(d, r::text);
    pz := array_append(pz, (r->>'message' like '%FORBIDDEN%'));

    r := pg_temp.call_as(adm, 'select public.vsat_exam_scores_admin_list(''{"q":"ZZ-ADMTEST"}''::jsonb)');
    t := array_append(t,'exam scores list returns marks (admin)'); d := array_append(d, left(r::text,180));
    pz := array_append(pz, ((r->>'ok')='true' and (r->'rows'->0->>'exam_obtained_marks')='120'));

    r := pg_temp.call_as(usr, 'select public.vsat_exam_scores_admin_list(''{}''::jsonb)');
    t := array_append(t,'exam scores list forbidden (non-admin)'); d := array_append(d, r::text);
    pz := array_append(pz, (r->>'message' like '%FORBIDDEN%'));

    select count(*) into n from public.vsat_admin_audit where application_id='ZZ-ADMTEST-1';
    t := array_append(t,'audit rows written'); d := array_append(d, ('count='||n));
    pz := array_append(pz, (n >= 3));

    raise exception 'ZZ_ROLLBACK' using errcode = 'P0001';
  exception when others then
    if sqlerrm <> 'ZZ_ROLLBACK' then
      t := array_append(t,'SETUP/RUN ERROR'); pz := array_append(pz, false); d := array_append(d, (sqlstate||': '||sqlerrm));
    end if;
  end;

  for i in 1..coalesce(array_length(t,1),0) loop
    test := t[i]; pass := pz[i]; detail := d[i]; return next;
  end loop;
end $$;

select * from pg_temp.run_tests();

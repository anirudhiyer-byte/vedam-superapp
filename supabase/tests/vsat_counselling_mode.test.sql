-- VSAT · counselling mode (Online / Offline) — tests for migration 0179 (STAGING ONLY)
--
-- How to run: paste this whole file into the staging SQL editor, or run it through the Supabase MCP.
-- The last statement returns one row per test: test | pass | detail.
-- Nothing is left behind: all test data is created inside a block that is rolled back with a private error code
-- at the end. Fake data only (@example.invalid, ZZTEST names).

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
  insert into public.profiles (id, email, full_name) values (v, p_email, 'ZZTEST ' || split_part(p_email, '@', 1))
  on conflict (id) do update set email = excluded.email, full_name = excluded.full_name;
  return v;
end $$;

-- applicant (returns the lead / user id) moved by the system up to p_stage
create or replace function pg_temp.mk_app(p_id text, p_stage text)
returns uuid language plpgsql as $$
declare u uuid := pg_temp.mk_user(lower(p_id) || '@example.invalid'); s text;
begin
  insert into public.lead_manager (lead_id, registered_name, registered_email, lead_stage)
  values (u, 'ZZTEST ' || p_id, lower(p_id) || '@example.invalid', 'applicant_paid') on conflict (lead_id) do nothing;
  insert into public.application_manager (application_id, lead_id, application_no, registered_name, registered_email, campus_applied)
  values (p_id, u, p_id, 'ZZTEST ' || p_id, lower(p_id) || '@example.invalid', 'Ajeenkya DY Patil University — Pune');
  foreach s in array array['application_fee_paid', 'booked', 'exam_taken', 'vsat_cleared', 'interview_scheduled',
                           'interviewed', 'pi_cleared', 'counselling_scheduled'] loop
    perform public.vsat__move(p_id, s, 'active', 'zz test', 'system', null, null);
    exit when s = p_stage;
  end loop;
  return u;
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

create or replace function pg_temp.set_mode(p jsonb)
returns text language sql as $$ select format('select public.vsat_set_counselling_mode(%L::jsonb)', p::text) $$;

create or replace function pg_temp.mode_of(p_app text)
returns text language sql as $$ select coalesce(am.counselling_mode, 'null') from public.application_manager am where am.application_id = p_app $$;

create or replace function pg_temp.run_vsat_0179_tests()
returns table (test text, pass boolean, detail text) language plpgsql as $$
declare
  t_name text[] := '{}'; t_pass boolean[] := '{}'; t_det text[] := '{}';
  adm uuid; cou uuid; uA uuid; uB uuid; uV uuid; uH uuid; uS uuid; uC uuid; nobody uuid;
  r jsonb; s text; n int; ok boolean;
begin
  begin -- rolled back at the end (ZDONE)
    adm := pg_temp.mk_user('zztest-0179-adm@example.invalid');
    cou := pg_temp.mk_user('zztest-0179-cou@example.invalid');
    insert into public.vsat_team (user_id, role, campus) values (adm, 'admissions', null), (cou, 'counsellor', null);
    uA := pg_temp.mk_app('ZZT-0179-A', 'pi_cleared');
    uB := pg_temp.mk_app('ZZT-0179-B', 'pi_cleared');
    uV := pg_temp.mk_app('ZZT-0179-V', 'vsat_cleared');
    uH := pg_temp.mk_app('ZZT-0179-H', 'pi_cleared');
    uS := pg_temp.mk_app('ZZT-0179-S', 'counselling_scheduled');
    uC := pg_temp.mk_app('ZZT-0179-C', 'counselling_scheduled');
    nobody := pg_temp.mk_user('zztest-0179-nobody@example.invalid');
    update public.vsat_pipeline set status = 'on_hold' where application_id = 'ZZT-0179-H';
    insert into public.counselling_assignments (application_id, attempt_no, counsellor_id, slot_datetime, submitted_at)
    values ('ZZT-0179-C', 1, cou, now() - interval '1 day', now() - interval '1 hour');

    -- ════ A. schema ════
    select count(*) into n from information_schema.columns where table_schema = 'public' and table_name = 'application_manager'
       and ((column_name = 'counselling_mode' and data_type = 'text') or (column_name = 'counselling_mode_at' and data_type like 'timestamp%'));
    t_name := t_name || text 'A both columns exist'; t_det := t_det || (n::text); t_pass := t_pass || (n = 2);
    begin
      update public.application_manager set counselling_mode = 'hybrid' where application_id = 'ZZT-0179-A';
      ok := false;
    exception when check_violation then ok := true;
    end;
    t_name := t_name || text 'A only online / offline can be stored (check)'; t_det := t_det || text ''; t_pass := t_pass || ok;

    -- ════ B. the student chooses ════
    r := pg_temp.call_as(uA, pg_temp.set_mode('{"mode":"online"}'));
    t_name := t_name || text 'B at PI cleared: Online is saved (with the time)';
    t_det := t_det || (r::text || ' ' || pg_temp.mode_of('ZZT-0179-A'));
    t_pass := t_pass || (r->>'counselling_mode' = 'online' and pg_temp.mode_of('ZZT-0179-A') = 'online'
                         and (select counselling_mode_at is not null from public.application_manager where application_id = 'ZZT-0179-A'));
    r := pg_temp.call_as(uA, pg_temp.set_mode('{"mode":"offline"}'));
    t_name := t_name || text 'B they can change it (Offline)'; t_det := t_det || r::text; t_pass := t_pass || (pg_temp.mode_of('ZZT-0179-A') = 'offline');
    t_name := t_name || text 'B the choice is logged for the CRM history';
    select count(*) into n from public.crm_activity_log where application_id = 'ZZT-0179-A' and action = 'counselling_mode';
    t_det := t_det || (n::text); t_pass := t_pass || (n = 2);
    r := pg_temp.call_as(uB, pg_temp.set_mode('{"mode":"online"}'));
    t_name := t_name || text 'B one student only changes their own application';
    t_det := t_det || (pg_temp.mode_of('ZZT-0179-A') || '/' || pg_temp.mode_of('ZZT-0179-B'));
    t_pass := t_pass || (pg_temp.mode_of('ZZT-0179-A') = 'offline' and pg_temp.mode_of('ZZT-0179-B') = 'online');
    r := pg_temp.call_as(uS, pg_temp.set_mode('{"mode":"offline"}'));
    t_name := t_name || text 'B also at Counselling scheduled (booked, not done yet)'; t_det := t_det || r::text;
    t_pass := t_pass || (pg_temp.mode_of('ZZT-0179-S') = 'offline');

    -- ════ C. refusals ════
    r := pg_temp.call_as(uV, pg_temp.set_mode('{"mode":"online"}'));
    t_name := t_name || text 'C before PI cleared (VSAT cleared) → WRONG_STAGE'; t_det := t_det || r::text;
    t_pass := t_pass || (r->>'message' = 'WRONG_STAGE' and pg_temp.mode_of('ZZT-0179-V') = 'null');
    r := pg_temp.call_as(uH, pg_temp.set_mode('{"mode":"online"}'));
    t_name := t_name || text 'C On hold at PI cleared → WRONG_STAGE'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'WRONG_STAGE');
    r := pg_temp.call_as(uC, pg_temp.set_mode('{"mode":"online"}'));
    t_name := t_name || text 'C counselling already submitted → ALREADY_COUNSELLED'; t_det := t_det || r::text;
    t_pass := t_pass || (r->>'message' = 'ALREADY_COUNSELLED' and pg_temp.mode_of('ZZT-0179-C') = 'null');
    r := pg_temp.call_as(uA, pg_temp.set_mode('{"mode":"hybrid"}'));
    t_name := t_name || text 'C a mode other than online / offline → BAD_VALUE: mode'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'BAD_VALUE: mode');
    r := pg_temp.call_as(uA, pg_temp.set_mode('{"mode":1}'));
    t_name := t_name || text 'C a non-text mode → BAD_VALUE: mode'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'BAD_VALUE: mode');
    r := pg_temp.call_as(uA, pg_temp.set_mode('{"mode":"online","application_id":"ZZT-0179-B"}'));
    t_name := t_name || text 'C extra keys (e.g. someone else''s application_id) → UNKNOWN_KEY'; t_det := t_det || r::text;
    t_pass := t_pass || (r->>'message' like 'UNKNOWN_KEY%' and pg_temp.mode_of('ZZT-0179-B') = 'online');
    r := pg_temp.call_as(nobody, pg_temp.set_mode('{"mode":"online"}'));
    t_name := t_name || text 'C a signed-in user with no application → NOT_IN_PIPELINE'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'NOT_IN_PIPELINE');
    r := pg_temp.call_as(null, pg_temp.set_mode('{"mode":"online"}'), true);
    t_name := t_name || text 'C anon cannot call it'; t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = '42501');

    -- ════ D. admins see it ════
    r := pg_temp.call_as(adm, 'select public.vsat_student(''ZZT-0179-A'')');
    t_name := t_name || text 'D the drawer (vsat_student) shows profile.counselling_mode'; t_det := t_det || left(coalesce(r->'profile', r)::text, 300);
    t_pass := t_pass || (r->'profile'->>'counselling_mode' = 'offline');
    r := pg_temp.call_as(adm, 'select public.vsat_grid_columns()');
    t_name := t_name || text 'D the grid offers the column (catalog reads application_manager)';
    t_det := t_det || (select coalesce(string_agg(e->>'key' || ':' || (e->>'group'), ','), 'none') from jsonb_array_elements(r->'columns') e where e->>'key' like 'counselling_mode%');
    t_pass := t_pass || exists (select 1 from jsonb_array_elements(r->'columns') e where e->>'key' = 'counselling_mode');

    -- ════ E. grants ════
    t_name := t_name || text 'E vsat_set_counselling_mode: signed-in only, security definer, empty search_path';
    select string_agg(p.proname, ',') into s from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname = 'vsat_set_counselling_mode'
       and not (has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
                and p.prosecdef and p.proconfig = array['search_path=""']
                and not exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0));
    t_det := t_det || coalesce(s, 'ok'); t_pass := t_pass || (s is null and exists (select 1 from pg_proc where proname = 'vsat_set_counselling_mode'));

    raise exception using errcode = 'ZDONE';
  exception when sqlstate 'ZDONE' then null;
  end;

  return query select x.n, x.p, x.d from unnest(t_name, t_pass, t_det) as x(n, p, d);
end $$;

select test, coalesce(pass, false) as pass, detail from pg_temp.run_vsat_0179_tests();

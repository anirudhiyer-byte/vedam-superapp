-- VSAT exam toggles · tests for migration 0163 (STAGING ONLY)
--
-- How to run: paste this whole file into the staging SQL editor, or run it through the Supabase MCP.
-- The last statement returns one row per test: test | pass | detail.
--
-- Nothing is left behind: all fixture writes (fake users + the app_flags toggles) happen inside a
-- block that raises ZDONE and is caught, which rolls the block's DML back. Fake users only.

create or replace function pg_temp.mk_user(p_email text)
returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, aud, role, email_confirmed_at, raw_user_meta_data)
  values (v, p_email, 'authenticated', 'authenticated', now(), '{}'::jsonb);
  insert into public.profiles (id, email, full_name) values (v, p_email, 'ZZTEST ' || split_part(p_email, '@', 1))
  on conflict (id) do update set email = excluded.email;
  return v;
end $$;

create or replace function pg_temp.mk_admin(p_uid uuid)
returns void language sql as $$ insert into public.user_roles (user_id, role) values (p_uid, 'admin'); $$;

-- run one SQL expression as a logged-in user or as anon; returns jsonb (or {sqlstate,message} on error)
create or replace function pg_temp.call_as(p_uid uuid, p_sql text, p_anon boolean default false)
returns jsonb language plpgsql as $$
declare r jsonb;
begin
  if p_anon then
    perform set_config('request.jwt.claims', '{"role":"anon"}', true); set local role anon;
  else
    perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true); set local role authenticated;
  end if;
  execute p_sql into r; reset role; perform set_config('request.jwt.claims', '', true);
  return coalesce(r, 'null'::jsonb);
exception when others then
  reset role; perform set_config('request.jwt.claims', '', true);
  return jsonb_build_object('sqlstate', sqlstate, 'message', sqlerrm);
end $$;

create or replace function pg_temp.run_vsat_exam_toggle_tests()
returns table (test text, pass boolean, detail text) language plpgsql as $$
declare
  t_name text[] := '{}'; t_pass boolean[] := '{}'; t_det text[] := '{}';
  adm uuid; usr uuid; r jsonb; i int; v text;
begin
  begin
    adm := pg_temp.mk_user('zz-exam-admin@example.invalid'); perform pg_temp.mk_admin(adm);
    usr := pg_temp.mk_user('zz-exam-user@example.invalid');

    -- 1 · flags seeded
    select coalesce((select value from public.app_flags where key='vsat_mock_enabled'),'(missing)') into v;
    t_name := t_name||text 'mock flag seeded off'; t_pass := t_pass||(v='off'); t_det := t_det||v;
    select coalesce((select value from public.app_flags where key='vsat_exam_enabled'),'(missing)') into v;
    t_name := t_name||text 'exam flag seeded on'; t_pass := t_pass||(v='on'); t_det := t_det||v;

    -- 2 · admin get returns the two new keys alongside the originals
    r := pg_temp.call_as(adm, 'select public.vsat_landing_flags_get()');
    t_name := t_name||text 'admin get has mock+exam keys';
    t_pass := t_pass||((r ? 'vsat_mock_enabled') and (r ? 'vsat_exam_enabled') and (r ? 'vsat_public'));
    t_det := t_det||left(r::text,200);

    -- 3 · non-admin get → forbidden
    r := pg_temp.call_as(usr, 'select public.vsat_landing_flags_get()');
    t_name := t_name||text 'non-admin get forbidden'; t_pass := t_pass||(r->>'sqlstate'='42501'); t_det := t_det||coalesce(r->>'sqlstate','(no error)');

    -- 4 · admin can set vsat_mock_enabled=on, and it persists
    r := pg_temp.call_as(adm, format('select public.vsat_landing_flag_set(%L::jsonb)', '{"key":"vsat_mock_enabled","value":"on"}'));
    t_name := t_name||text 'admin set mock=on ok'; t_pass := t_pass||(coalesce((r->>'ok')::boolean,false) and r->>'value'='on'); t_det := t_det||left(r::text,200);
    select value into v from public.app_flags where key='vsat_mock_enabled';
    t_name := t_name||text 'mock flag persisted on'; t_pass := t_pass||(v='on'); t_det := t_det||v;

    -- 5 · bad key / bad value rejected (admin IS set, so these are validation errors, not forbidden)
    r := pg_temp.call_as(adm, format('select public.vsat_landing_flag_set(%L::jsonb)', '{"key":"not_a_flag","value":"on"}'));
    t_name := t_name||text 'bad key rejected'; t_pass := t_pass||(r->>'error'='bad_key'); t_det := t_det||left(r::text,120);
    r := pg_temp.call_as(adm, format('select public.vsat_landing_flag_set(%L::jsonb)', '{"key":"vsat_exam_enabled","value":"maybe"}'));
    t_name := t_name||text 'bad value rejected'; t_pass := t_pass||(r->>'error'='bad_value'); t_det := t_det||left(r::text,120);

    -- 6 · non-admin set → forbidden
    r := pg_temp.call_as(usr, format('select public.vsat_landing_flag_set(%L::jsonb)', '{"key":"vsat_exam_enabled","value":"off"}'));
    t_name := t_name||text 'non-admin set forbidden'; t_pass := t_pass||(r->>'sqlstate'='42501'); t_det := t_det||coalesce(r->>'sqlstate','(no error)');

    -- 7 · vsat_exam_flags_get: student-callable (no admin gate), returns {mock,exam}
    r := pg_temp.call_as(usr, 'select public.vsat_exam_flags_get()');
    t_name := t_name||text 'student exam_flags_get ok';
    t_pass := t_pass||((r ? 'mock') and (r ? 'exam') and r->>'exam'='on');
    t_det := t_det||left(r::text,160);

    -- 8 · exam_flags_get ACLs: authenticated yes, anon no
    t_name := t_name||text 'exam_flags_get granted to authenticated';
    t_pass := t_pass||has_function_privilege('authenticated','public.vsat_exam_flags_get()','execute');
    t_det := t_det||('authenticated='||has_function_privilege('authenticated','public.vsat_exam_flags_get()','execute')::text);
    t_name := t_name||text 'exam_flags_get revoked from anon';
    t_pass := t_pass||(not has_function_privilege('anon','public.vsat_exam_flags_get()','execute'));
    t_det := t_det||('anon='||has_function_privilege('anon','public.vsat_exam_flags_get()','execute')::text);

    raise exception 'ZDONE';
  exception when others then
    if sqlerrm <> 'ZDONE' then
      return query select 'FIXTURE/RUN ERROR'::text, false, sqlerrm; return;
    end if;
  end;

  for i in 1 .. array_length(t_name,1) loop
    test := t_name[i]; pass := t_pass[i]; detail := t_det[i]; return next;
  end loop;
end $$;

select * from pg_temp.run_vsat_exam_toggle_tests();

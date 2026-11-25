-- VSAT · Meet attendance and the team count no longer depend on the stage — tests for 0169 (STAGING ONLY)
--
-- How to run: paste this whole file into the staging SQL editor, or run it through the Supabase MCP.
-- The last statement returns one row per test: test | pass | detail.
--
-- Nothing is left behind: all test data is created inside a block that is rolled back with a private error code at
-- the end. Fake data only (@example.invalid, ZZTEST names). "Google made the Meet" is simulated by writing the
-- Meet fields on the booking, the way the sync job's release does.

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
  foreach s in array array['vsat_cleared', 'interview_scheduled', 'interviewed', 'pi_cleared', 'counselling_scheduled', 'counselled'] loop
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

create or replace function pg_temp.iso(t timestamptz)
returns text language sql as $$ select to_char(t at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') $$;

-- the booking as Google left it: Meet ready, and the slot ended p_ago ago
create or replace function pg_temp.ended_iv(p_app text, p_ago interval)
returns void language sql as $$
  update public.interview_assignments set slot_datetime = date_trunc('minute', now()) - p_ago - make_interval(mins => duration_min),
         meet_sync = 'ok', meet_code = 'zzt-' || lower(right(p_app, 3)) || '-iv', meet_link = 'https://meet.google.com/zzt-' || lower(right(p_app, 3)) || '-iv'
   where application_id = p_app $$;
create or replace function pg_temp.ended_cs(p_app text, p_ago interval)
returns void language sql as $$
  update public.counselling_assignments set slot_datetime = date_trunc('minute', now()) - p_ago - make_interval(mins => duration_min),
         meet_sync = 'ok', meet_code = 'zzt-' || lower(right(p_app, 3)) || '-cs', zoom_link = 'https://meet.google.com/zzt-' || lower(right(p_app, 3)) || '-cs'
   where application_id = p_app $$;

create or replace function pg_temp.due(p_fn text)
returns text language sql as $$
  select coalesce(string_agg(x->>'application_id', ',' order by x->>'application_id'), '-')
    from jsonb_array_elements(pg_temp.call_as(null, format('select public.%I(50)', p_fn), 'service_role')) x
   where x->>'application_id' like 'ZZT-AS-%' $$;

create or replace function pg_temp.open_of(p_adm uuid, p_who uuid)
returns int language sql as $$
  select (x->>'open')::int from jsonb_array_elements(pg_temp.call_as(p_adm, 'select public.vsat_team_admin_list()')) x
   where x->>'user_id' = p_who::text $$;

create or replace function pg_temp.run_vsat_attendance_any_stage_tests()
returns table (test text, pass boolean, detail text) language plpgsql as $$
declare
  t_name text[] := '{}'; t_pass boolean[] := '{}'; t_det text[] := '{}';
  adm uuid; i1 uuid; i2 uuid; c1 uuid;
  v1 text; v2 text; v3 text; v4 text; v5 text; v6 text; v7 text; v8 text; k1 text; k2 text; k3 text; k4 text;
  t0 timestamptz := date_trunc('hour', now()) + interval '3 days';
  r jsonb; s text; n int; ia public.interview_assignments;
begin
  begin -- rolled back at the end (ZDONE)
    adm := pg_temp.mk_user('zztest-as-admin@example.invalid');
    insert into public.user_roles (user_id, role) values (adm, 'admin');
    i1 := pg_temp.mk_user('zztest-as-int1@example.invalid');
    i2 := pg_temp.mk_user('zztest-as-int2@example.invalid');
    c1 := pg_temp.mk_user('zztest-as-couns1@example.invalid');
    insert into public.vsat_team (user_id, role, campus) values (i1, 'interviewer', null), (i2, 'interviewer', null), (c1, 'counsellor', null);

    v1 := pg_temp.mk_app('ZZT-AS-V1', 'vsat_cleared');         -- sent, stage not moved (normal since 0166)
    v2 := pg_temp.mk_app('ZZT-AS-V2', 'interview_scheduled');  -- moved by hand, as before
    v3 := pg_temp.mk_app('ZZT-AS-V3', 'vsat_cleared');         -- moved on to Interviewed by hand after the call
    v4 := pg_temp.mk_app('ZZT-AS-V4', 'vsat_cleared');         -- moved on to PI cleared: past the interview step
    v5 := pg_temp.mk_app('ZZT-AS-V5', 'vsat_cleared');         -- marked by hand already
    v6 := pg_temp.mk_app('ZZT-AS-V6', 'vsat_cleared');         -- cancelled
    v7 := pg_temp.mk_app('ZZT-AS-V7', 'vsat_cleared');         -- an old booking with a pasted link (no Google)
    v8 := pg_temp.mk_app('ZZT-AS-V8', 'vsat_cleared');         -- ended only 5 minutes ago (too soon)
    k1 := pg_temp.mk_app('ZZT-AS-K1', 'pi_cleared');           -- counselling sent, stage not moved
    k2 := pg_temp.mk_app('ZZT-AS-K2', 'pi_cleared');           -- moved on to Counselled by hand after the call
    k3 := pg_temp.mk_app('ZZT-AS-K3', 'pi_cleared');           -- moved on to Offer sent: past the counselling step
    k4 := pg_temp.mk_app('ZZT-AS-K4', 'counselling_scheduled');

    perform pg_temp.call_as(adm, pg_temp.rpc('vsat_assign_interview', jsonb_build_object('application_id', x.app, 'interviewer_id', i1,
              'slot_datetime', pg_temp.iso(t0 + make_interval(hours => x.h)))))
       from (values (v1, 0), (v2, 1), (v3, 2), (v4, 3), (v5, 4), (v6, 5), (v7, 6), (v8, 7)) as x(app, h);
    perform pg_temp.call_as(adm, pg_temp.rpc('vsat_assign_counsellor', jsonb_build_object('application_id', x.app, 'counsellor_id', c1,
              'slot_datetime', pg_temp.iso(t0 + make_interval(hours => x.h)))))
       from (values (k1, 0), (k2, 1), (k3, 2), (k4, 3)) as x(app, h);

    -- ════ T. team count ("still scheduled with them") ════
    t_name := t_name || text 'T team count: every live booking of a student still at a bookable stage (8 interviews, 4 sessions)';
    t_det := t_det || format('int1=%s couns1=%s int2=%s', pg_temp.open_of(adm, i1), pg_temp.open_of(adm, c1), pg_temp.open_of(adm, i2));
    t_pass := t_pass || (pg_temp.open_of(adm, i1) = 8 and pg_temp.open_of(adm, c1) = 4 and pg_temp.open_of(adm, i2) = 0);

    -- the calls happen; staff then move some students on by hand
    -- each ends at its own minute (one interviewer can't hold two bookings at the same time)
    perform pg_temp.ended_iv(x.app, make_interval(mins => x.m)) from (values (v1, 20), (v2, 21), (v3, 22), (v4, 23), (v5, 24), (v6, 25)) as x(app, m);
    perform pg_temp.ended_iv(v8, interval '5 minutes');
    update public.interview_assignments set slot_datetime = date_trunc('minute', now()) - interval '90 minutes',
           meet_mode = 'manual', meet_sync = 'none', meet_link = 'https://zoom.us/j/zztest7' where application_id = v7;
    perform pg_temp.ended_cs(x.app, make_interval(mins => x.m)) from (values (k1, 20), (k2, 21), (k3, 22), (k4, 23)) as x(app, m);
    update public.application_manager set scholarship_percentage = 30 where application_id = k3;  -- an offer needs a %
    perform public.vsat__move(x.app, x.st, 'active', 'zz test', 'system', null, null)
       from (values (1, v3, 'interview_scheduled'), (2, v3, 'interviewed'),
                    (3, v4, 'interview_scheduled'), (4, v4, 'interviewed'), (5, v4, 'pi_cleared'),
                    (6, k2, 'counselling_scheduled'), (7, k2, 'counselled'),
                    (8, k3, 'counselling_scheduled'), (9, k3, 'counselled'), (10, k3, 'offer_sent')) as x(o, app, st)
      order by x.o;
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_set_interview_attendance', jsonb_build_object('application_id', v5, 'attendance', 'done')));
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_cancel_interview', jsonb_build_object('application_id', v6, 'reason', 'zz test')));

    -- ════ I. interview attendance work list ════
    s := pg_temp.due('vsat_interview_attendance_due');
    t_name := t_name || text 'I Meet is read at VSAT cleared, Interview scheduled and Interviewed (stages changed by hand)';
    t_det := t_det || s;
    t_pass := t_pass || (s = 'ZZT-AS-V1,ZZT-AS-V2,ZZT-AS-V3');
    t_name := t_name || text 'I not read: moved past the step (PI cleared), marked by hand, cancelled, a pasted link, or too soon';
    t_det := t_det || s;
    t_pass := t_pass || (s !~ 'V4|V5|V6|V7|V8');

    select * into ia from public.interview_assignments a where a.application_id = v1;
    r := pg_temp.call_as(null, pg_temp.rpc('vsat_interview_attendance_apply', jsonb_build_object('id', ia.id, 'version', ia.version, 'result', 'done',
           'detail', jsonb_build_object('people', 2, 'overlap_min', 25, 'records', 1))), 'service_role');
    select * into ia from public.interview_assignments a where a.application_id = v1;
    t_name := t_name || text 'I Meet result saved at VSAT cleared: Status Done (auto); the stage does not move';
    t_det := t_det || format('%s | %s %s | %s', r, ia.attendance, ia.attendance_source, (select vp.stage from public.vsat_pipeline vp where vp.application_id = v1));
    t_pass := t_pass || (r->>'applied' = 'true' and ia.attendance::text = 'done' and ia.attendance_source = 'auto'
                         and (select vp.stage from public.vsat_pipeline vp where vp.application_id = v1) = 'vsat_cleared');
    s := pg_temp.due('vsat_interview_attendance_due');
    t_name := t_name || text 'I once marked it leaves the work list';
    t_det := t_det || s; t_pass := t_pass || (s = 'ZZT-AS-V2,ZZT-AS-V3');

    -- ════ C. counselling attendance work list ════
    s := pg_temp.due('vsat_counselling_attendance_due');
    t_name := t_name || text 'C Meet is read at PI cleared, Counselling scheduled and Counselled; not past the step (Offer sent)';
    t_det := t_det || s;
    t_pass := t_pass || (s = 'ZZT-AS-K1,ZZT-AS-K2,ZZT-AS-K4');

    -- ════ T. team count after the calls ════
    t_name := t_name || text 'T team count drops for Done, cancelled and students moved past booking (interviewer: V2, V7, V8)';
    t_det := t_det || format('int1=%s', pg_temp.open_of(adm, i1));
    t_pass := t_pass || (pg_temp.open_of(adm, i1) = 3);
    t_name := t_name || text 'T counsellor: K1 and K4 still at a bookable stage, K2 / K3 moved on';
    t_det := t_det || format('couns1=%s', pg_temp.open_of(adm, c1));
    t_pass := t_pass || (pg_temp.open_of(adm, c1) = 2);

    -- ════ S. access unchanged ════
    r := pg_temp.call_as(adm, 'select public.vsat_interview_attendance_due(5)');
    t_name := t_name || text 'S staff browsers cannot read the attendance work lists';
    t_det := t_det || (r::text || ' | ' || pg_temp.call_as(adm, 'select public.vsat_counselling_attendance_due(5)')::text);
    t_pass := t_pass || (r->>'sqlstate' = '42501' and pg_temp.call_as(adm, 'select public.vsat_counselling_attendance_due(5)')->>'sqlstate' = '42501');
    r := pg_temp.call_as(i1, 'select public.vsat_team_admin_list()');
    t_name := t_name || text 'S an interviewer cannot read the team admin list';
    t_det := t_det || r::text; t_pass := t_pass || (r ? 'sqlstate');
    r := pg_temp.call_as(null, 'select public.vsat_team_admin_list()', 'anon');
    t_name := t_name || text 'S signed out cannot read the team admin list';
    t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = '42501');
    t_name := t_name || text 'S all three: security definer, empty search_path; work lists server only, team list signed-in only';
    select string_agg(p.proname, ',') into s from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname in ('vsat_interview_attendance_due', 'vsat_counselling_attendance_due', 'vsat_team_admin_list')
       and (not p.prosecdef or p.proconfig is distinct from array['search_path=""']
            or has_function_privilege('anon', p.oid, 'execute')
            or (p.proname <> 'vsat_team_admin_list' and (has_function_privilege('authenticated', p.oid, 'execute')
                                                          or not has_function_privilege('service_role', p.oid, 'execute')))
            or (p.proname = 'vsat_team_admin_list' and not has_function_privilege('authenticated', p.oid, 'execute')));
    select count(*) into n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname in ('vsat_interview_attendance_due', 'vsat_counselling_attendance_due', 'vsat_team_admin_list');
    t_det := t_det || (coalesce(s, 'ok') || ' n=' || n); t_pass := t_pass || (s is null and n = 3);

    raise exception using errcode = 'ZDONE';
  exception when sqlstate 'ZDONE' then null;
  end;

  return query select x.n, x.p, x.d from unnest(t_name, t_pass, t_det) as x(n, p, d);
end $$;

select test, coalesce(pass, false) as pass, detail from pg_temp.run_vsat_attendance_any_stage_tests();

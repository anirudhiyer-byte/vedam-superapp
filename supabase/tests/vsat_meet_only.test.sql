-- VSAT · Google Meet only: no pasted ("own") meeting links — tests for 0167 (STAGING ONLY)
--
-- How to run: paste this whole file into the staging SQL editor, or run it through the Supabase MCP.
-- The last statement returns one row per test: test | pass | detail.
--
-- Nothing is left behind: all test data is created inside a block that is rolled back with a private error code at
-- the end. Fake data only (@example.invalid, ZZTEST names). An "old" booking with a pasted link is made directly in
-- the table, the way bookings from before 0167 look.

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
  foreach s in array array['vsat_cleared', 'interview_scheduled', 'interviewed', 'pi_cleared'] loop
    perform public.vsat__move(p_id, s, 'active', 'zz test', 'system', null, null);
    exit when s = p_stage;
  end loop;
  return p_id;
end $$;

create or replace function pg_temp.call_as(p_uid uuid, p_sql text)
returns jsonb language plpgsql as $$
declare r jsonb;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  set local role authenticated;
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

create or replace function pg_temp.run_vsat_meet_only_tests()
returns table (test text, pass boolean, detail text) language plpgsql as $$
declare
  t_name text[] := '{}'; t_pass boolean[] := '{}'; t_det text[] := '{}';
  adm uuid; i1 uuid; c1 uuid; a1 text; a2 text; a3 text; k1 text; k2 text;
  t0 timestamptz := date_trunc('hour', now()) + interval '3 days';
  r jsonb; s text; n int; ia public.interview_assignments; ca public.counselling_assignments;
begin
  begin -- rolled back at the end (ZDONE)
    adm := pg_temp.mk_user('zztest-mo-adm@example.invalid');
    i1 := pg_temp.mk_user('zztest-mo-int1@example.invalid');
    c1 := pg_temp.mk_user('zztest-mo-couns1@example.invalid');
    insert into public.vsat_team (user_id, role, campus) values (adm, 'admissions', null), (i1, 'interviewer', null), (c1, 'counsellor', null);
    a1 := pg_temp.mk_app('ZZT-MO-1', 'vsat_cleared');
    a2 := pg_temp.mk_app('ZZT-MO-2', 'vsat_cleared');
    a3 := pg_temp.mk_app('ZZT-MO-3', 'vsat_cleared');
    k1 := pg_temp.mk_app('ZZT-MO-K1', 'pi_cleared');
    k2 := pg_temp.mk_app('ZZT-MO-K2', 'pi_cleared');

    -- ════ I. interview: a pasted link is refused ════
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_assign_interview', jsonb_build_object('application_id', a1, 'interviewer_id', i1,
           'slot_datetime', pg_temp.iso(t0), 'meet_link', 'https://meet.google.com/zzt-past-ed1')));
    select count(*) into n from public.interview_assignments x where x.application_id = a1;
    t_name := t_name || text 'I a pasted Meet link is refused (BAD_VALUE: meet_link), nothing booked';
    t_det := t_det || format('%s | rows=%s', coalesce(r->>'message', 'not refused'), n);
    t_pass := t_pass || (r->>'message' = 'BAD_VALUE: meet_link' and n = 0);

    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_assign_interview', jsonb_build_object('application_id', a1, 'interviewer_id', i1,
           'slot_datetime', pg_temp.iso(t0), 'auto_meet', false)));
    t_name := t_name || text 'I asking for "no Google Meet" (auto_meet false) is refused';
    t_det := t_det || coalesce(r->>'message', 'not refused'); t_pass := t_pass || (r->>'message' = 'BAD_VALUE: meet_link');

    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_assign_interview', jsonb_build_object('application_id', a1, 'interviewer_id', i1, 'slot_datetime', pg_temp.iso(t0))));
    select * into ia from public.interview_assignments x where x.application_id = a1;
    t_name := t_name || text 'I a normal booking is Google Meet (made by Google, no link yet)';
    t_det := t_det || format('%s mode=%s sync=%s link=%s', coalesce(r->>'message', 'ok'), ia.meet_mode, ia.meet_sync, coalesce(ia.meet_link, '-'));
    t_pass := t_pass || (ia.meet_mode = 'auto' and ia.meet_sync = 'pending' and ia.meet_link is null);

    -- the row Send (drafts) is Google Meet too
    perform pg_temp.call_as(adm, pg_temp.rpc('vsat_interview_draft_set', jsonb_build_object('application_id', a3, 'interviewer_id', i1, 'slot_datetime', pg_temp.iso(t0 + interval '1 hour'))));
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_interview_drafts_send', jsonb_build_object('application_ids', jsonb_build_array(a3))));
    select * into ia from public.interview_assignments x where x.application_id = a3;
    t_name := t_name || text 'I a row sent from the list is Google Meet';
    t_det := t_det || format('%s mode=%s sync=%s', left(r::text, 120), ia.meet_mode, ia.meet_sync);
    t_pass := t_pass || (jsonb_array_length(r->'sent') = 1 and ia.meet_mode = 'auto' and ia.meet_sync = 'pending');

    -- ════ L. an old booking with a pasted link ════
    perform pg_temp.call_as(adm, pg_temp.rpc('vsat_assign_interview', jsonb_build_object('application_id', a2, 'interviewer_id', i1, 'slot_datetime', pg_temp.iso(t0 + interval '2 hours'))));
    update public.interview_assignments x set meet_mode = 'manual', meet_sync = 'none', meet_link = 'https://meet.google.com/zzt-old-pasted'
     where x.application_id = a2;  -- how a booking from before 0167 looks
    r := pg_temp.call_as(adm, format('select public.vsat_student(%L)', a2));
    t_name := t_name || text 'L an old booking keeps its pasted link until it is changed (Join still works)';
    t_det := t_det || format('%s %s', r->'interview'->>'meet_mode', r->'interview'->>'meet_link');
    t_pass := t_pass || (r->'interview'->>'meet_mode' = 'manual' and r->'interview'->>'meet_link' = 'https://meet.google.com/zzt-old-pasted');

    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_assign_interview', jsonb_build_object('application_id', a2, 'interviewer_id', i1, 'slot_datetime', pg_temp.iso(t0 + interval '5 hours'))));
    select * into ia from public.interview_assignments x where x.application_id = a2;
    select string_agg(e.kind, ',' order by e.version) into s from public.vsat_interview_events e where e.application_id = a2;
    t_name := t_name || text 'L moving it makes it Google Meet: pasted link gone, Google queued, "moved" email job';
    t_det := t_det || format('%s mode=%s sync=%s link=%s events=%s', coalesce(r->>'message', 'ok'), ia.meet_mode, ia.meet_sync, coalesce(ia.meet_link, '-'), s);
    t_pass := t_pass || (ia.meet_mode = 'auto' and ia.meet_sync = 'pending' and ia.meet_link is null and ia.slot_datetime = t0 + interval '5 hours'
                         and s = 'scheduled,rescheduled');

    -- ════ C. counselling ════
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_assign_counsellor', jsonb_build_object('application_id', k1, 'counsellor_id', c1,
           'slot_datetime', pg_temp.iso(t0), 'meeting_link', 'https://zoom.us/j/123')));
    select count(*) into n from public.counselling_assignments x where x.application_id = k1;
    t_name := t_name || text 'C a pasted counselling link is refused, nothing booked';
    t_det := t_det || format('%s | rows=%s', coalesce(r->>'message', 'not refused'), n);
    t_pass := t_pass || (r->>'message' = 'BAD_VALUE: meet_link' and n = 0);

    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_assign_counsellor', jsonb_build_object('application_id', k1, 'counsellor_id', c1, 'slot_datetime', pg_temp.iso(t0))));
    select * into ca from public.counselling_assignments x where x.application_id = k1;
    t_name := t_name || text 'C a normal counselling booking is Google Meet';
    t_det := t_det || format('%s mode=%s sync=%s', coalesce(r->>'message', 'ok'), ca.meet_mode, ca.meet_sync);
    t_pass := t_pass || (ca.meet_mode = 'auto' and ca.meet_sync = 'pending' and ca.zoom_link is null);

    perform pg_temp.call_as(adm, pg_temp.rpc('vsat_assign_counsellor', jsonb_build_object('application_id', k2, 'counsellor_id', c1, 'slot_datetime', pg_temp.iso(t0 + interval '1 hour'))));
    update public.counselling_assignments x set meet_mode = 'manual', meet_sync = 'none', zoom_link = 'https://zoom.us/j/zzt-old'
     where x.application_id = k2;
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_assign_counsellor', jsonb_build_object('application_id', k2, 'counsellor_id', c1, 'slot_datetime', pg_temp.iso(t0 + interval '4 hours'))));
    select * into ca from public.counselling_assignments x where x.application_id = k2;
    t_name := t_name || text 'C an old counselling booking with a pasted link becomes Google Meet when moved';
    t_det := t_det || format('%s mode=%s sync=%s link=%s', coalesce(r->>'message', 'ok'), ca.meet_mode, ca.meet_sync, coalesce(ca.zoom_link, '-'));
    t_pass := t_pass || (ca.meet_mode = 'auto' and ca.meet_sync = 'pending' and ca.zoom_link is null);

    -- ════ S. access unchanged ════
    t_name := t_name || text 'S both booking engines: security definer, empty search_path, not callable by browsers';
    select string_agg(p.proname, ',') into s from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname in ('vsat__iv_schedule', 'vsat__cs_schedule')
       and (not p.prosecdef or p.proconfig is distinct from array['search_path=""']
            or has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'));
    t_det := t_det || coalesce(s, 'ok'); t_pass := t_pass || (s is null);
    t_name := t_name || text 'S no booking engine keeps a pasted-link branch';
    select string_agg(p.proname, ',') into s from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname in ('vsat__iv_schedule', 'vsat__cs_schedule') and p.prosrc ~ 'then ''manual''';
    t_det := t_det || coalesce(s, 'ok'); t_pass := t_pass || (s is null);

    raise exception using errcode = 'ZDONE';
  exception when sqlstate 'ZDONE' then null;
  end;

  return query select x.n, x.p, x.d from unnest(t_name, t_pass, t_det) as x(n, p, d);
end $$;

select test, coalesce(pass, false) as pass, detail from pg_temp.run_vsat_meet_only_tests();

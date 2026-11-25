-- VSAT · the student sees the interview / counselling booking as soon as it is sent — tests for 0168 (STAGING ONLY)
--
-- How to run: paste this whole file into the staging SQL editor, or run it through the Supabase MCP.
-- The last statement returns one row per test: test | pass | detail.
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

-- applicant moved (as the system) along the pipeline up to p_stage
create or replace function pg_temp.mk_app(p_id text, p_stage text)
returns text language plpgsql as $$
declare u uuid := pg_temp.mk_user(lower(p_id) || '@example.invalid'); s text;
begin
  insert into public.lead_manager (lead_id, registered_name, registered_email, lead_stage) values (u, 'ZZTEST ' || p_id, lower(p_id) || '@example.invalid', 'applicant_paid')
  on conflict (lead_id) do nothing;
  insert into public.application_manager (application_id, lead_id, application_no, registered_name, registered_email, campus_applied)
  values (p_id, u, p_id, 'ZZTEST ' || p_id, lower(p_id) || '@example.invalid', 'Ajeenkya DY Patil University — Pune');
  update public.application_manager set counselling_mode = 'online', counselling_mode_at = now() where application_id = p_id;  -- 0184 test setup: counselling is booked for online students only
  foreach s in array array['vsat_cleared', 'interview_scheduled', 'interviewed', 'pi_cleared', 'counselling_scheduled'] loop
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

create or replace function pg_temp.lead_of(p_app text)
returns uuid language sql as $$ select am.lead_id from public.application_manager am where am.application_id = p_app $$;

create or replace function pg_temp.my_iv(p_app text)
returns jsonb language sql as $$ select pg_temp.call_as(pg_temp.lead_of(p_app), 'select public.vsat_my_interview()') $$;

create or replace function pg_temp.my_cs(p_app text)
returns jsonb language sql as $$ select pg_temp.call_as(pg_temp.lead_of(p_app), 'select public.vsat_my_counselling()') $$;

create or replace function pg_temp.run_vsat_student_sees_booking_tests()
returns table (test text, pass boolean, detail text) language plpgsql as $$
declare
  t_name text[] := '{}'; t_pass boolean[] := '{}'; t_det text[] := '{}';
  adm uuid; i1 uuid; c1 uuid;
  v1 text; v2 text; v3 text; v4 text; v5 text; v6 text; v7 text; v8 text;
  k1 text; k2 text; k3 text; k4 text; k5 text; k6 text;
  t0 timestamptz := date_trunc('hour', now()) + interval '3 days';
  r jsonb; s text; n int;
begin
  begin -- rolled back at the end (ZDONE)
    adm := pg_temp.mk_user('zztest-sb-adm@example.invalid');
    i1 := pg_temp.mk_user('zztest-sb-int1@example.invalid');
    c1 := pg_temp.mk_user('zztest-sb-couns1@example.invalid');
    insert into public.vsat_team (user_id, role, campus) values (adm, 'admissions', null), (i1, 'interviewer', null), (c1, 'counsellor', null);
    insert into public.vsat_counsellor_zoom (counsellor_id, zoom_link) values (c1, 'https://zoom.us/j/zztest-c1');  -- 0184 test setup: counselling runs on the counsellor's own Zoom link
    v1 := pg_temp.mk_app('ZZT-SB-V1', 'vsat_cleared');
    v2 := pg_temp.mk_app('ZZT-SB-V2', 'vsat_cleared');
    v3 := pg_temp.mk_app('ZZT-SB-V3', 'vsat_cleared');
    v4 := pg_temp.mk_app('ZZT-SB-V4', 'vsat_cleared');
    v5 := pg_temp.mk_app('ZZT-SB-V5', 'vsat_cleared');
    v6 := pg_temp.mk_app('ZZT-SB-V6', 'interview_scheduled');
    v7 := pg_temp.mk_app('ZZT-SB-V7', 'vsat_cleared');
    v8 := pg_temp.mk_app('ZZT-SB-V8', 'vsat_cleared');
    k1 := pg_temp.mk_app('ZZT-SB-K1', 'pi_cleared');
    k2 := pg_temp.mk_app('ZZT-SB-K2', 'pi_cleared');
    k3 := pg_temp.mk_app('ZZT-SB-K3', 'pi_cleared');
    k4 := pg_temp.mk_app('ZZT-SB-K4', 'pi_cleared');
    k5 := pg_temp.mk_app('ZZT-SB-K5', 'counselling_scheduled');
    k6 := pg_temp.mk_app('ZZT-SB-K6', 'pi_cleared');

    -- ════ V. interview card (vsat_my_interview) ════
    -- sent bookings: v1, v3, v4, v5, v6, v7 (each at its own time); v8 only has a typed row (not sent)
    perform pg_temp.call_as(adm, pg_temp.rpc('vsat_assign_interview', jsonb_build_object('application_id', x.app, 'interviewer_id', i1,
              'slot_datetime', pg_temp.iso(t0 + make_interval(hours => x.h)))))
       from (values (v1, 0), (v3, 1), (v4, 2), (v5, 3), (v6, 4), (v7, 5)) as x(app, h);
    perform pg_temp.call_as(adm, pg_temp.rpc('vsat_interview_draft_set', jsonb_build_object('application_id', v8, 'interviewer_id', i1,
              'slot_datetime', pg_temp.iso(t0 + interval '6 hours'))));

    t_name := t_name || text 'V setup: 6 interviews sent, all still at VSAT cleared except v6 (stages are changed by hand)';
    select string_agg(vp.application_id || '=' || vp.stage, ',' order by vp.application_id) into s
      from public.vsat_pipeline vp where vp.application_id in (v1, v3, v4, v5, v6, v7)
       and exists (select 1 from public.interview_assignments a where a.application_id = vp.application_id and a.cancelled_at is null);
    t_det := t_det || coalesce(s, '-');
    t_pass := t_pass || (s = 'ZZT-SB-V1=vsat_cleared,ZZT-SB-V3=vsat_cleared,ZZT-SB-V4=vsat_cleared,ZZT-SB-V5=vsat_cleared,ZZT-SB-V6=interview_scheduled,ZZT-SB-V7=vsat_cleared');

    r := pg_temp.my_iv(v1);
    t_name := t_name || text 'V sent while still at VSAT cleared → the student sees it (upcoming), no link yet';
    t_det := t_det || r::text;
    t_pass := t_pass || (r->>'state' = 'upcoming' and (r->>'start')::timestamptz = t0 and r->'meet_link' = 'null'::jsonb
                         and (r->>'opens_at')::timestamptz = t0 - interval '10 minutes' and (r->>'duration_min')::int = 30);

    r := pg_temp.my_iv(v2);
    t_name := t_name || text 'V VSAT cleared, nothing booked → none';
    t_det := t_det || r::text; t_pass := t_pass || (r->>'state' = 'none');

    r := pg_temp.my_iv(v8);
    t_name := t_name || text 'V a typed row that is not sent yet is not shown → none';
    t_det := t_det || r::text; t_pass := t_pass || (r->>'state' = 'none');

    update public.vsat_pipeline set status = 'on_hold' where application_id = v3;
    r := pg_temp.my_iv(v3);
    t_name := t_name || text 'V on hold at VSAT cleared → not shown (as before)';
    t_det := t_det || r::text; t_pass := t_pass || (r->>'state' = 'none');

    -- 0177: "not selected" at VSAT cleared is now the stage PI not cleared (the status is retired)
    update public.vsat_pipeline set stage = 'pi_not_cleared' where application_id = v4;
    r := pg_temp.my_iv(v4);
    t_name := t_name || text 'V not selected at VSAT cleared (now PI not cleared) → not shown';
    t_det := t_det || r::text; t_pass := t_pass || (r->>'state' = 'none');

    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_cancel_interview', jsonb_build_object('application_id', v5, 'reason', 'zz student asked')));
    t_name := t_name || text 'V cancelled while at VSAT cleared → none';
    t_det := t_det || (left(r::text, 100) || ' | ' || pg_temp.my_iv(v5)::text);
    t_pass := t_pass || (not r ? 'sqlstate' and pg_temp.my_iv(v5)->>'state' = 'none');

    r := pg_temp.my_iv(v6);
    t_name := t_name || text 'V at Interview scheduled (moved by hand) → upcoming, as before';
    t_det := t_det || r::text;
    t_pass := t_pass || (r->>'state' = 'upcoming' and (r->>'start')::timestamptz = t0 + interval '4 hours');

    update public.interview_assignments set slot_datetime = now() + interval '5 minutes', meet_link = 'https://meet.google.com/zzt-sbvs-abc',
           meet_sync = 'ok' where application_id = v7;
    r := pg_temp.my_iv(v7);
    t_name := t_name || text 'V the Join link is given only inside the window (10 min before), also at VSAT cleared';
    t_det := t_det || r::text;
    t_pass := t_pass || (r->>'state' = 'open' and r->>'meet_link' = 'https://meet.google.com/zzt-sbvs-abc');
    update public.interview_assignments set slot_datetime = now() + interval '1 hour' where application_id = v7;
    r := pg_temp.my_iv(v7);
    t_name := t_name || text 'V …and not before it (has_link only)';
    t_det := t_det || r::text;
    t_pass := t_pass || (r->>'state' = 'upcoming' and r->'meet_link' = 'null'::jsonb and (r->>'has_link')::boolean);

    r := pg_temp.my_cs(v1);
    t_name := t_name || text 'V the dashboard card keeps showing the interview (counselling step = interview)';
    t_det := t_det || r::text; t_pass := t_pass || (r->>'step' = 'interview' and r->>'state' = 'none');

    -- ════ K. counselling card (vsat_my_counselling) ════
    perform pg_temp.call_as(adm, pg_temp.rpc('vsat_assign_counsellor', jsonb_build_object('application_id', x.app, 'counsellor_id', c1,
              'slot_datetime', pg_temp.iso(t0 + make_interval(hours => x.h)))))
       from (values (k1, 0), (k3, 1), (k4, 2), (k5, 3), (k6, 4)) as x(app, h);

    t_name := t_name || text 'K setup: 5 sessions sent, all still at PI cleared except k5';
    select string_agg(vp.application_id || '=' || vp.stage, ',' order by vp.application_id) into s
      from public.vsat_pipeline vp where vp.application_id in (k1, k3, k4, k5, k6)
       and exists (select 1 from public.counselling_assignments a where a.application_id = vp.application_id and a.cancelled_at is null);
    t_det := t_det || coalesce(s, '-');
    t_pass := t_pass || (s = 'ZZT-SB-K1=pi_cleared,ZZT-SB-K3=pi_cleared,ZZT-SB-K4=pi_cleared,ZZT-SB-K5=counselling_scheduled,ZZT-SB-K6=pi_cleared');

    r := pg_temp.my_cs(k1);
    t_name := t_name || text 'K sent while still at PI cleared → the booked card (step counselling, upcoming), no link yet';
    t_det := t_det || r::text;
    t_pass := t_pass || (r->>'step' = 'counselling' and r->>'state' = 'upcoming' and (r->>'start')::timestamptz = t0
                         and r->'meet_link' = 'null'::jsonb);

    r := pg_temp.my_cs(k2);
    t_name := t_name || text 'K PI cleared, nothing booked → "You''ve cleared the interview" (step pi_cleared)';
    t_det := t_det || r::text; t_pass := t_pass || (r->>'step' = 'pi_cleared' and r->>'state' = 'none');

    update public.vsat_pipeline set status = 'on_hold' where application_id = k3;
    r := pg_temp.my_cs(k3);
    t_name := t_name || text 'K on hold at PI cleared → not told "cleared" and no booking shown (step interviewed)';
    t_det := t_det || r::text; t_pass := t_pass || (r->>'step' = 'interviewed' and r->>'state' = 'none');

    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_cancel_counselling', jsonb_build_object('application_id', k4, 'reason', 'zz student asked')));
    t_name := t_name || text 'K cancelled while at PI cleared → back to step pi_cleared';
    t_det := t_det || (left(r::text, 100) || ' | ' || pg_temp.my_cs(k4)::text);
    t_pass := t_pass || (not r ? 'sqlstate' and pg_temp.my_cs(k4)->>'step' = 'pi_cleared' and pg_temp.my_cs(k4)->>'state' = 'none');

    r := pg_temp.my_cs(k5);
    t_name := t_name || text 'K at Counselling scheduled (moved by hand) → booked card, as before';
    t_det := t_det || r::text;
    t_pass := t_pass || (r->>'step' = 'counselling' and r->>'state' = 'upcoming' and (r->>'start')::timestamptz = t0 + interval '3 hours');

    update public.counselling_assignments set slot_datetime = now() + interval '5 minutes', zoom_link = 'https://meet.google.com/zzt-sbcs-abc',
           meet_sync = 'ok' where application_id = k6;
    r := pg_temp.my_cs(k6);
    t_name := t_name || text 'K the Join link is given only inside the window, also at PI cleared';
    t_det := t_det || r::text;
    t_pass := t_pass || (r->>'step' = 'counselling' and r->>'state' = 'open' and r->>'meet_link' = 'https://meet.google.com/zzt-sbcs-abc');

    perform pg_temp.call_as(adm, pg_temp.rpc('vsat_counselling_draft_set', jsonb_build_object('application_id', k2, 'counsellor_id', c1,
              'slot_datetime', pg_temp.iso(t0 + interval '7 hours'))));
    r := pg_temp.my_cs(k2);
    t_name := t_name || text 'K a typed counselling row that is not sent yet is not shown';
    t_det := t_det || r::text; t_pass := t_pass || (r->>'step' = 'pi_cleared' and r->>'state' = 'none');

    -- ════ S. access ════
    r := pg_temp.call_as(null, 'select public.vsat_my_interview()', 'anon');
    t_name := t_name || text 'S signed out cannot read the interview card'; t_det := t_det || r::text; t_pass := t_pass || (r ? 'sqlstate');
    r := pg_temp.call_as(null, 'select public.vsat_my_counselling()', 'anon');
    t_name := t_name || text 'S signed out cannot read the counselling card'; t_det := t_det || r::text; t_pass := t_pass || (r ? 'sqlstate');
    r := pg_temp.call_as(adm, 'select public.vsat_my_interview()');
    t_name := t_name || text 'S staff with no application of their own see nothing'; t_det := t_det || r::text; t_pass := t_pass || (r->>'state' = 'none');
    t_name := t_name || text 'S both: security definer, empty search_path, signed-in users only (not anon / public)';
    select string_agg(p.proname, ',') into s from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname in ('vsat_my_interview', 'vsat_my_counselling')
       and (not p.prosecdef or p.proconfig is distinct from array['search_path=""']
            or has_function_privilege('anon', p.oid, 'execute') or not has_function_privilege('authenticated', p.oid, 'execute')
            or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0));
    select count(*) into n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname in ('vsat_my_interview', 'vsat_my_counselling');
    t_det := t_det || (coalesce(s, 'ok') || ' n=' || n); t_pass := t_pass || (s is null and n = 2);

    raise exception using errcode = 'ZDONE';
  exception when sqlstate 'ZDONE' then null;
  end;

  return query select x.n, x.p, x.d from unnest(t_name, t_pass, t_det) as x(n, p, d);
end $$;

select test, coalesce(pass, false) as pass, detail from pg_temp.run_vsat_student_sees_booking_tests();

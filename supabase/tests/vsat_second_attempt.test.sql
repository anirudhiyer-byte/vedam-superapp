-- VSAT second attempt · tests for migrations 0151–0153 (STAGING ONLY)
--
-- Run: paste into the staging SQL editor, or run through the Supabase MCP. The last statement
-- returns one row per test: test | pass | detail. All data is created inside a block rolled
-- back with a private error code (ZDONE). Fake data only (@example.invalid, ZZTEST names).

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

create or replace function pg_temp.mk_app(p_id text, p_campus text, p_date uuid)
returns text language plpgsql as $$
declare u uuid := pg_temp.mk_user(lower(p_id) || '@example.invalid');
begin
  insert into public.lead_manager (lead_id, registered_name, registered_email, lead_stage) values (u, 'ZZTEST ' || p_id, lower(p_id) || '@example.invalid', 'applicant_paid');
  insert into public.application_manager (application_id, lead_id, application_no, registered_name, registered_email, registered_mobile,
                                          campus_applied, exam_date_id, class10_year, class12_year, marks_physics_12, marks_chemistry_12, marks_maths_12,
                                          vps_score, scholarship_percentage, payment_stage_1)
  values (p_id, u, p_id, 'ZZTEST ' || p_id, lower(p_id) || '@example.invalid', '9000000000', p_campus, p_date, 2024, 2026, 60, 60, 60,
          8.43, 40, 'payment_approved');
  return p_id;
end $$;

create or replace function pg_temp.call_as(p_uid uuid, p_sql text, p_anon boolean default false)
returns jsonb language plpgsql as $$
declare r jsonb;
begin
  if p_anon then perform set_config('request.jwt.claims', '{"role":"anon"}', true); set local role anon;
  else perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true); set local role authenticated; end if;
  execute p_sql into r;
  reset role; perform set_config('request.jwt.claims', '', true);
  return coalesce(r, 'null'::jsonb);
exception when others then
  reset role; perform set_config('request.jwt.claims', '', true);
  return jsonb_build_object('sqlstate', sqlstate, 'message', sqlerrm);
end $$;

-- force a pipeline row into a given stage/status at attempt 1 (seeding bypasses the engine)
create or replace function pg_temp.force_stage(p_app text, p_stage text, p_status text)
returns void language sql as $$
  update public.vsat_pipeline set stage = p_stage, status = p_status, attempt_no = 1 where application_id = p_app;
$$;

create or replace function pg_temp.run_attempt2_tests()
returns table (test text, pass boolean, detail text) language plpgsql as $$
declare
  t_name text[] := '{}'; t_pass boolean[] := '{}'; t_det text[] := '{}';
  adm uuid; usr uuid; d uuid; aFail text; aOk text; aPay text; r jsonb; vp record; am record; s text;
begin
  begin
    adm := pg_temp.mk_user('zztest-a2-admin@example.invalid');
    insert into public.user_roles (user_id, role) values (adm, 'admin');
    usr := pg_temp.mk_user('zztest-a2-user@example.invalid');
    insert into public.vsat_exam_dates (label, wheebox_test_id, exam_date, start_at, end_at)
    values ('ZZTEST A2', 'zz-a2', current_date, now(), now() + interval '2 hours') returning id into d;

    aFail := pg_temp.mk_app('ZZT-A2-FAIL', 'Ajeenkya DY Patil University — Pune', d);
    aOk   := pg_temp.mk_app('ZZT-A2-OK',   'Ajeenkya DY Patil University — Pune', d);
    aPay  := pg_temp.mk_app('ZZT-A2-PAY',  'Ajeenkya DY Patil University — Pune', d);
    perform pg_temp.force_stage(aFail, 'pi_not_appeared', 'absent');       -- terminal-fail
    perform pg_temp.force_stage(aOk,   'vsat_cleared',    'active');       -- NOT terminal-fail
    perform pg_temp.force_stage(aPay,  'exam_taken',      'not_selected'); -- terminal-fail (VSAT not cleared)

    -- A. predicate
    t_name := t_name || text 'A terminal-fail predicate (3 fail true, active false)';
    t_pass := t_pass || (public.vsat__is_terminal_fail('pi_not_appeared','absent') and public.vsat__is_terminal_fail('exam_taken','not_selected')
            and public.vsat__is_terminal_fail('counselling_not_appeared','absent') and not public.vsat__is_terminal_fail('vsat_cleared','active'));
    t_det := t_det || text '';

    -- B. non-admin cannot start a 2nd attempt
    r := pg_temp.call_as(usr, format('select public.vsat_start_second_attempt(%L::jsonb)', jsonb_build_object('application_id', aFail)::text));
    t_name := t_name || text 'B non-admin → FORBIDDEN'; t_pass := t_pass || (r->>'message' = 'FORBIDDEN'); t_det := t_det || r::text;

    -- C. admin cannot start on a non-terminal app
    r := pg_temp.call_as(adm, format('select public.vsat_start_second_attempt(%L::jsonb)', jsonb_build_object('application_id', aOk)::text));
    t_name := t_name || text 'C admin on non-terminal → NOT_ELIGIBLE_FOR_RETRY'; t_pass := t_pass || (r->>'message' = 'NOT_ELIGIBLE_FOR_RETRY'); t_det := t_det || r::text;

    -- D. admin starts a 2nd attempt on a terminal-fail app → full reset
    r := pg_temp.call_as(adm, format('select public.vsat_start_second_attempt(%L::jsonb)', jsonb_build_object('application_id', aFail)::text));
    select * into vp from public.vsat_pipeline where application_id = aFail;
    select * into am from public.application_manager where application_id = aFail;
    t_name := t_name || text 'D admin reset: pipeline attempt 2 at application_fee_paid/active';
    t_pass := t_pass || (vp.attempt_no = 2 and vp.stage = 'application_fee_paid' and vp.status = 'active');
    t_det := t_det || format('stage=%s status=%s attempt=%s', vp.stage, vp.status, vp.attempt_no);

    t_name := t_name || text 'D reset: current_attempt=2, exam_date_id cleared, application_stage_2=mock_enabled, exam_given false';
    t_pass := t_pass || (am.current_attempt = 2 and am.exam_date_id is null and am.application_stage_2::text = 'mock_enabled' and am.exam_given = false);
    t_det := t_det || format('ca=%s exam_date=%s stage2=%s exam_given=%s', am.current_attempt, am.exam_date_id, am.application_stage_2, am.exam_given);

    t_name := t_name || text 'D reset: attempt-1 vps/scholarship snapshotted into _1, single-row cleared';
    t_pass := t_pass || (am.vps_score_1 = 8.43 and am.scholarship_pct_1 = 40 and am.vps_score is null and am.scholarship_percentage is null);
    t_det := t_det || format('vps_1=%s sch_1=%s vps=%s sch=%s', am.vps_score_1, am.scholarship_pct_1, am.vps_score, am.scholarship_percentage);

    t_name := t_name || text 'D reset: history row for attempt 2 → application_fee_paid';
    t_pass := t_pass || exists (select 1 from public.vsat_stage_history h where h.application_id = aFail and h.attempt_no = 2 and h.to_stage = 'application_fee_paid');
    t_det := t_det || text '';

    -- E. starting again on the already-reset app → ALREADY_SECOND_ATTEMPT
    r := pg_temp.call_as(adm, format('select public.vsat_start_second_attempt(%L::jsonb)', jsonb_build_object('application_id', aFail)::text));
    t_name := t_name || text 'E second reset refused (ALREADY_SECOND_ATTEMPT)'; t_pass := t_pass || (r->>'message' = 'ALREADY_SECOND_ATTEMPT'); t_det := t_det || r::text;

    -- F. student path: payment_stage_2 approved fires the reset trigger
    update public.application_manager set payment_stage_2 = 'payment_approved' where application_id = aPay;
    select * into vp from public.vsat_pipeline where application_id = aPay;
    t_name := t_name || text 'F payment_stage_2=approved trigger → pipeline reset to attempt 2';
    t_pass := t_pass || (vp.attempt_no = 2 and vp.stage = 'application_fee_paid' and vp.status = 'active');
    t_det := t_det || format('stage=%s status=%s attempt=%s', vp.stage, vp.status, vp.attempt_no);

    -- G. grants / browser reachability
    t_name := t_name || text 'G vsat_start_second_attempt: authenticated yes, anon no, secdef, empty search_path';
    t_pass := t_pass || (select has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
                    and p.prosecdef and p.proconfig = array['search_path=""']
             from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
             where ns.nspname = 'public' and p.proname = 'vsat_start_second_attempt');
    t_det := t_det || text '';

    select string_agg(p.proname, ',') into s from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname in ('vsat__begin_attempt2','vsat__is_terminal_fail','vsat__on_attempt2_payment')
       and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'));
    t_name := t_name || text 'G private helpers unreachable from a browser'; t_pass := t_pass || (s is null); t_det := t_det || coalesce(s, 'none reachable');

    raise exception using errcode = 'ZDONE';
  exception when sqlstate 'ZDONE' then null;
  end;
  return query select x.n, x.p, x.d from unnest(t_name, t_pass, t_det) as x(n, p, d);
end $$;

select test, coalesce(pass, false) as pass, detail from pg_temp.run_attempt2_tests();

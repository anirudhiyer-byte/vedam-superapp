-- VSAT · explicit "not cleared" stages, statuses cut to Active / On hold — tests for migration 0177 (STAGING ONLY)
--
-- How to run: paste this whole file into the staging SQL editor, or run it through the Supabase MCP.
-- The last statement returns one row per test: test | pass | detail.
-- Also run vsat_pipeline_stage_engine.test.sql, vsat_second_attempt.test.sql, vsat_interview_inline_schedule.test.sql
-- and vsat_student_sees_booking.test.sql (their fixtures were moved to the new stages in 0177).
--
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

-- applicant moved (as the system) along the pipeline up to p_stage
create or replace function pg_temp.mk_app(p_id text, p_stage text)
returns text language plpgsql as $$
declare u uuid := pg_temp.mk_user(lower(p_id) || '@example.invalid'); s text;
begin
  insert into public.lead_manager (lead_id, registered_name, registered_email, lead_stage)
  values (u, 'ZZTEST ' || p_id, lower(p_id) || '@example.invalid', 'applicant_paid') on conflict (lead_id) do nothing;
  insert into public.application_manager (application_id, lead_id, application_no, registered_name, registered_email, campus_applied)
  values (p_id, u, p_id, 'ZZTEST ' || p_id, lower(p_id) || '@example.invalid', 'Ajeenkya DY Patil University — Pune');
  foreach s in array array['application_fee_paid', 'booked', 'exam_taken', 'vsat_cleared', 'interview_scheduled',
                           'interviewed', 'pi_cleared', 'counselling_scheduled', 'counselled'] loop
    perform public.vsat__move(p_id, s, 'active', 'zz test', 'system', null, null);
    exit when s = p_stage;
  end loop;
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

create or replace function pg_temp.mv(p_app text, p_to text, p_status text default null, p_reason text default null)
returns text language sql as $$
  select format('select public.vsat_move_stage(%L::jsonb)',
    jsonb_strip_nulls(jsonb_build_object('application_id', p_app, 'to_stage', p_to, 'to_status', p_status, 'reason', p_reason))::text)
$$;

create or replace function pg_temp.st(p_app text)
returns text language sql as $$ select vp.stage || '/' || vp.status from public.vsat_pipeline vp where vp.application_id = p_app $$;

create or replace function pg_temp.app1(p_app text)
returns text language sql as $$ select am.application_stage_1::text from public.application_manager am where am.application_id = p_app $$;

create or replace function pg_temp.run_vsat_0177_tests()
returns table (test text, pass boolean, detail text) language plpgsql as $$
declare
  t_name text[] := '{}'; t_pass boolean[] := '{}'; t_det text[] := '{}';
  adm uuid; int1 uuid; int2 uuid; cou1 uuid; usr uuid;
  b1 text; b2 text; b3 text; b4 text; b5 text; r jsonb; s text; n int; ok boolean;
begin
  begin -- rolled back at the end (ZDONE)
    adm  := pg_temp.mk_user('zztest-0177-adm@example.invalid');
    int1 := pg_temp.mk_user('zztest-0177-int1@example.invalid');
    int2 := pg_temp.mk_user('zztest-0177-int2@example.invalid');
    cou1 := pg_temp.mk_user('zztest-0177-cou1@example.invalid');
    usr  := pg_temp.mk_user('zztest-0177-usr@example.invalid');
    insert into public.vsat_team (user_id, role, campus) values
      (adm, 'admissions', null), (int1, 'interviewer', null), (int2, 'interviewer', null), (cou1, 'counsellor', null);

    b1 := pg_temp.mk_app('ZZT-0177-B1', 'exam_taken');
    b2 := pg_temp.mk_app('ZZT-0177-B2', 'interviewed');
    b3 := pg_temp.mk_app('ZZT-0177-B3', 'interview_scheduled');
    b4 := pg_temp.mk_app('ZZT-0177-B4', 'counselling_scheduled');
    b5 := pg_temp.mk_app('ZZT-0177-B5', 'counselled');
    insert into public.interview_assignments (application_id, attempt_no, interviewer_id, slot_datetime)
    values (b3, 1, int1, now() + interval '1 day');
    insert into public.counselling_assignments (application_id, attempt_no, counsellor_id, slot_datetime)
    values (b4, 1, cou1, now() + interval '2 days');

    -- ════ A. vocabulary ════
    t_name := t_name || text 'A stage order: VSAT not cleared = 5 (next to VSAT cleared), PI not cleared = 8 (next to PI cleared)';
    t_det := t_det || (public.vsat__stage_order('vsat_not_cleared') || '/' || public.vsat__stage_order('pi_not_cleared'));
    t_pass := t_pass || (public.vsat__stage_order('vsat_not_cleared') = 5 and public.vsat__stage_order('pi_not_cleared') = 8);
    t_name := t_name || text 'A student mirror: vsat_not_cleared → vsat_not_cleared, pi_not_cleared → interview_rejected (any status)';
    t_det := t_det || (public.vsat__legacy_stage('vsat_not_cleared', 'active') || '/' || public.vsat__legacy_stage('pi_not_cleared', 'on_hold'));
    t_pass := t_pass || (public.vsat__legacy_stage('vsat_not_cleared', 'active') = 'vsat_not_cleared'
                         and public.vsat__legacy_stage('pi_not_cleared', 'on_hold') = 'interview_rejected');
    t_name := t_name || text 'A both new stages are a terminal fail (attempt 2 is offered)';
    t_det := t_det || text '';
    t_pass := t_pass || (public.vsat__is_terminal_fail('vsat_not_cleared', 'active') and public.vsat__is_terminal_fail('pi_not_cleared', 'active')
                         and not public.vsat__is_terminal_fail('pi_cleared', 'active'));
    t_name := t_name || text 'A retired status → stage: not_selected / absent map per step; counselling never rejects';
    s := concat_ws(',', public.vsat__retired_status_stage('exam_taken', 'not_selected'), public.vsat__retired_status_stage('booked', 'not_selected'),
                        public.vsat__retired_status_stage('interviewed', 'not_selected'), public.vsat__retired_status_stage('vsat_cleared', 'not_selected'),
                        public.vsat__retired_status_stage('exam_taken', 'absent'), public.vsat__retired_status_stage('interview_scheduled', 'absent'),
                        public.vsat__retired_status_stage('counselling_scheduled', 'absent'),
                        coalesce(public.vsat__retired_status_stage('counselled', 'not_selected'), 'null'),
                        coalesce(public.vsat__retired_status_stage('vsat_cleared', 'on_hold'), 'null'));
    t_det := t_det || s;
    t_pass := t_pass || (s = 'vsat_not_cleared,vsat_not_cleared,pi_not_cleared,pi_not_cleared,vsat_not_appeared,pi_not_appeared,counselling_not_appeared,null,null');

    -- ════ B. the table only takes Active / On hold ════
    begin
      update public.vsat_pipeline set status = 'not_selected' where application_id = b1;
      ok := false;
    exception when check_violation then ok := true;
    end;
    t_name := t_name || text 'B status not_selected written directly → refused by the check'; t_det := t_det || text ''; t_pass := t_pass || ok;
    begin
      update public.vsat_pipeline set status = 'absent' where application_id = b1;
      ok := false;
    exception when check_violation then ok := true;
    end;
    t_name := t_name || text 'B status absent written directly → refused by the check'; t_det := t_det || text ''; t_pass := t_pass || ok;
    select count(*) into n from public.vsat_pipeline where status not in ('active', 'on_hold');
    t_name := t_name || text 'B no student is left on a retired status'; t_det := t_det || (n::text); t_pass := t_pass || (n = 0);

    -- ════ C. admissions: rejecting and reopening need a reason ════
    r := pg_temp.call_as(adm, pg_temp.mv(b1, 'vsat_not_cleared'));
    t_name := t_name || text 'C exam taken → VSAT not cleared without a reason is refused'; t_det := t_det || r::text;
    t_pass := t_pass || (r->>'message' = 'REASON_REQUIRED');
    r := pg_temp.call_as(adm, pg_temp.mv(b1, 'vsat_not_cleared', null, 'below the batch cut-off'));
    t_name := t_name || text 'C …with a reason → VSAT not cleared / Active; student field vsat_not_cleared';
    t_det := t_det || (r::text || ' ' || pg_temp.app1(b1));
    t_pass := t_pass || (pg_temp.st(b1) = 'vsat_not_cleared/active' and pg_temp.app1(b1) = 'vsat_not_cleared');
    t_name := t_name || text 'C the lead stage mirrors too, and the history row says Active';
    select lm.lead_stage::text into s from public.lead_manager lm join public.application_manager am on am.lead_id = lm.lead_id where am.application_id = b1;
    t_det := t_det || s;
    t_pass := t_pass || (s = 'vsat_not_cleared' and exists (select 1 from public.vsat_stage_history h where h.application_id = b1
                         and h.to_stage = 'vsat_not_cleared' and h.to_status = 'active' and h.source = 'manual' and h.actor_id = adm));
    r := pg_temp.call_as(adm, pg_temp.mv(b1, 'vsat_cleared'));
    t_name := t_name || text 'C reopening (VSAT not cleared → VSAT cleared, same order) without a reason is refused';
    t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'REASON_REQUIRED');
    r := pg_temp.call_as(adm, pg_temp.mv(b1, 'vsat_cleared', null, 'rechecked the paper'));
    t_name := t_name || text 'C …with a reason → VSAT cleared'; t_det := t_det || r::text; t_pass := t_pass || (pg_temp.st(b1) = 'vsat_cleared/active');

    -- ════ D. an older caller that still sends a retired status is translated ════
    r := pg_temp.call_as(adm, pg_temp.mv(b2, 'interviewed', 'not_selected', 'scored below the bar'));
    t_name := t_name || text 'D (interviewed, not_selected) → PI not cleared / Active; student field interview_rejected';
    t_det := t_det || (r::text || ' ' || pg_temp.app1(b2));
    t_pass := t_pass || (r->>'stage' = 'pi_not_cleared' and r->>'status' = 'active' and pg_temp.app1(b2) = 'interview_rejected');
    r := pg_temp.call_as(adm, pg_temp.mv(b5, 'counselled', 'not_selected', 'zz try'));
    t_name := t_name || text 'D (counselled, not_selected) → BAD_STATUS (counselling never rejects)';
    t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'BAD_STATUS' and pg_temp.st(b5) = 'counselled/active');
    r := pg_temp.call_as(adm, pg_temp.mv(b5, 'counselled', 'paused', 'zz try'));
    t_name := t_name || text 'D an unknown status → BAD_STATUS'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'BAD_STATUS');

    -- ════ E. interviewer / counsellor: no-shows are the "not appeared" stages ════
    r := pg_temp.call_as(int1, pg_temp.mv(b3, 'interview_scheduled', 'absent'));
    t_name := t_name || text 'E assigned interviewer, old "absent" → PI not appeared / Active, no reason needed';
    t_det := t_det || r::text; t_pass := t_pass || (pg_temp.st(b3) = 'pi_not_appeared/active' and pg_temp.app1(b3) = 'interview_rejected');
    r := pg_temp.call_as(int1, pg_temp.mv(b3, 'interview_scheduled'));
    t_name := t_name || text 'E the interviewer can reschedule a no-show (PI not appeared → Interview scheduled)';
    t_det := t_det || r::text; t_pass := t_pass || (pg_temp.st(b3) = 'interview_scheduled/active');
    r := pg_temp.call_as(int1, pg_temp.mv(b3, 'pi_not_cleared', null, 'zz'));
    t_name := t_name || text 'E an interviewer cannot reject (PI not cleared is admissions only)';
    t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'FORBIDDEN');
    r := pg_temp.call_as(int2, pg_temp.mv(b3, 'pi_not_appeared'));
    t_name := t_name || text 'E another interviewer cannot mark the no-show'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'FORBIDDEN');
    r := pg_temp.call_as(int1, pg_temp.mv(b3, 'pi_not_appeared'));
    t_name := t_name || text 'E the new way: interviewer picks PI not appeared directly'; t_det := t_det || r::text;
    t_pass := t_pass || (pg_temp.st(b3) = 'pi_not_appeared/active');
    r := pg_temp.call_as(cou1, pg_temp.mv(b4, 'counselling_scheduled', 'absent'));
    t_name := t_name || text 'E assigned counsellor, old "absent" → Counselling not appeared / Active';
    t_det := t_det || r::text; t_pass := t_pass || (pg_temp.st(b4) = 'counselling_not_appeared/active');
    r := pg_temp.call_as(adm, pg_temp.mv(b4, 'counselled'));
    t_name := t_name || text 'E admissions moving a no-show on (Counselling not appeared → Counselled) needs a reason';
    t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'REASON_REQUIRED');

    -- ════ F. On hold still works, with a reason both ways ════
    r := pg_temp.call_as(adm, pg_temp.mv(b5, 'counselled', 'on_hold'));
    t_name := t_name || text 'F On hold without a reason is refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'REASON_REQUIRED');
    r := pg_temp.call_as(adm, pg_temp.mv(b5, 'counselled', 'on_hold', 'waiting for documents'));
    t_name := t_name || text 'F On hold with a reason'; t_det := t_det || r::text; t_pass := t_pass || (pg_temp.st(b5) = 'counselled/on_hold');
    r := pg_temp.call_as(adm, pg_temp.mv(b5, 'counselled', 'active'));
    t_name := t_name || text 'F resuming from On hold needs a reason'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'REASON_REQUIRED');

    -- ════ G. bulk ════
    r := pg_temp.call_as(adm, format('select public.vsat_move_bulk(%L::jsonb)',
           jsonb_build_object('application_ids', jsonb_build_array(b2), 'to_stage', 'vsat_not_cleared', 'reason', 'zz bulk')::text));
    t_name := t_name || text 'G bulk into a "not cleared" stage with a reason works (back from PI not cleared)';
    t_det := t_det || r::text; t_pass := t_pass || ((r->>'moved')::int = 1 and pg_temp.st(b2) = 'vsat_not_cleared/active');

    -- ════ H. access ════
    r := pg_temp.call_as(usr, pg_temp.mv(b1, 'vsat_not_cleared', null, 'zz'));
    t_name := t_name || text 'H a signed-in non-staff user cannot move anyone'; t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = '42501');
    r := pg_temp.call_as(null, pg_temp.mv(b1, 'vsat_not_cleared', null, 'zz'), true);
    t_name := t_name || text 'H anon cannot move anyone'; t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = '42501');
    t_name := t_name || text 'H new helper + checked move are not reachable from a browser';
    select string_agg(p.proname, ',') into s from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname in ('vsat__retired_status_stage', 'vsat__move_checked', 'vsat__app_prepaid_reflect')
       and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute')
            or p.proconfig is distinct from array['search_path=""']);
    t_det := t_det || coalesce(s, 'none'); t_pass := t_pass || (s is null);
    t_name := t_name || text 'H the backfill snapshot table: RLS on, no browser access';
    t_det := t_det || ((select relrowsecurity::text from pg_class where oid = 'public.vsat_0177_backfill_snapshot'::regclass));
    t_pass := t_pass || ((select relrowsecurity from pg_class where oid = 'public.vsat_0177_backfill_snapshot'::regclass)
                         and not has_table_privilege('authenticated', 'public.vsat_0177_backfill_snapshot', 'select')
                         and not has_table_privilege('anon', 'public.vsat_0177_backfill_snapshot', 'select'));

    raise exception using errcode = 'ZDONE';
  exception when sqlstate 'ZDONE' then null;
  end;

  return query select x.n, x.p, x.d from unnest(t_name, t_pass, t_det) as x(n, p, d);
end $$;

select test, coalesce(pass, false) as pass, detail from pg_temp.run_vsat_0177_tests();

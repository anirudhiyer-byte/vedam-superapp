-- Communication Manager · Slice 8 (Manage Automation, read-only) · database tests for migration 0067
--
-- How to run (STAGING ONLY): paste this whole file into the staging SQL editor,
-- or run it through the Supabase MCP / psql. The last statement returns one row
-- per test: test | pass | detail.
--
-- Nothing is left behind: all test data is created inside a block that is rolled
-- back with a private error code at the end (ZDONE). Test data is fake only
-- (@example.invalid e-mails, 90000003xx numbers, names starting with ZZTEST).
-- No bulk insert here: volume is tested on a local Postgres only.
--
-- Logged-in calls are simulated the way PostgREST does it: SET ROLE authenticated
-- (or anon) + request.jwt.claims {"sub": <uid>}. auth.uid() reads that claim.

-- ── helpers (session-temporary) ────────────────────────────────────────────────
create or replace function pg_temp.mk_user(p_email text)
returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, aud, role, email_confirmed_at, raw_user_meta_data)
  values (v, p_email, 'authenticated', 'authenticated', now(), '{}'::jsonb);
  insert into public.profiles (id, email) values (v, p_email)
  on conflict (id) do update set email = excluded.email;
  return v;
end $$;

create or replace function pg_temp.mk_admin(p_uid uuid)
returns void language sql as $$
  insert into public.user_roles (user_id, role) values (p_uid, 'admin');
$$;

-- run one SQL expression as a logged-in user, as authenticated-without-sub, or as anon
create or replace function pg_temp.call_as(p_uid uuid, p_sql text, p_anon boolean default false)
returns jsonb language plpgsql as $$
declare r jsonb;
begin
  if p_anon then
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    set local role anon;
  else
    perform set_config('request.jwt.claims',
      case when p_uid is null then '{"role":"authenticated"}'
           else json_build_object('sub', p_uid, 'role', 'authenticated')::text end, true);
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

-- the row of one automation / journey in the function's answer
create or replace function pg_temp.row_of(p jsonb, p_id uuid)
returns jsonb language sql immutable as $$
  select x from jsonb_array_elements(coalesce(p->'rows', '[]'::jsonb)) x where x->>'id' = p_id::text limit 1;
$$;

-- ── the tests ──────────────────────────────────────────────────────────────────
create or replace function pg_temp.run_comm_slice8_tests()
returns table (test text, pass boolean, detail text) language plpgsql as $$
declare
  t_name text[] := '{}'; t_pass boolean[] := '{}'; t_det text[] := '{}';
  adm uuid; usr uuid; u1 uuid := gen_random_uuid(); u2 uuid := gen_random_uuid(); u3 uuid := gen_random_uuid();
  wa1 uuid; wa2 uuid; wa3 uuid; wa4 uuid; wa5 uuid; j1 uuid; j2 uuid;
  r jsonb; x jsonb; base int; n_wa int; n_j int; ok boolean; before_counts text; after_counts text; bad text;
  q text := 'select public.comm_automation_list()';
  allowed text[] := array['channel','created_at','enabled','engine','id','last_failed','last_run_at','last_sent','last_status','name','product','runs','trigger'];
  inj text := 'ZZTEST x''); drop table public.profiles; --<script>alert(1)</script>';
begin
  begin -- everything below is rolled back at the end (ZDONE)
    adm := pg_temp.mk_user('zztest-admin@example.invalid');
    perform pg_temp.mk_admin(adm);
    usr := pg_temp.mk_user('zztest-user@example.invalid');

    -- ════ A. who may call ════
    r := pg_temp.call_as(null, q, true);
    t_name := t_name || text 'A anon is refused (no execute grant)'; t_det := t_det || r::text;
    t_pass := t_pass || (r->>'sqlstate' = '42501');
    r := pg_temp.call_as(usr, q);
    t_name := t_name || text 'A logged-in non-admin is refused (42501 forbidden)'; t_det := t_det || r::text;
    t_pass := t_pass || (r->>'sqlstate' = '42501' and r->>'message' = 'forbidden');
    r := pg_temp.call_as(null, q);
    t_name := t_name || text 'A authenticated role without a user id is refused'; t_det := t_det || r::text;
    t_pass := t_pass || (r->>'sqlstate' = '42501');
    t_name := t_name || text 'A grants: anon and public cannot execute, authenticated can';
    t_det := t_det || format('anon=%s public_via_anon=%s auth=%s',
      has_function_privilege('anon', 'public.comm_automation_list()', 'execute'),
      (select coalesce(bool_or(a.grantee = 0), false) from pg_proc p, aclexplode(p.proacl) a where p.oid = 'public.comm_automation_list()'::regprocedure),
      has_function_privilege('authenticated', 'public.comm_automation_list()', 'execute'));
    t_pass := t_pass || (not has_function_privilege('anon', 'public.comm_automation_list()', 'execute')
      and not (select coalesce(bool_or(a.grantee = 0), false) from pg_proc p, aclexplode(p.proacl) a where p.oid = 'public.comm_automation_list()'::regprocedure)
      and has_function_privilege('authenticated', 'public.comm_automation_list()', 'execute'));
    select p.prosecdef and coalesce(array_to_string(p.proconfig, ',') = 'search_path=""', false) and p.provolatile = 's'
      into ok from pg_proc p where p.oid = 'public.comm_automation_list()'::regprocedure;
    t_name := t_name || text 'A function is SECURITY DEFINER, STABLE, search_path empty'; t_det := t_det || coalesce(ok::text, 'null');
    t_pass := t_pass || coalesce(ok, false);

    -- ════ B. empty / existing rows: no crash ════
    select count(*) into n_wa from public.whatsapp_automations;
    select count(*) into n_j from public.comms_journeys;
    base := n_wa + n_j;
    r := pg_temp.call_as(adm, q);
    t_name := t_name || text 'B admin call works before test rows exist (empty tables: total 0, rows [])'; t_det := t_det || left(r::text, 300);
    t_pass := t_pass || (r ? 'rows' and jsonb_typeof(r->'rows') = 'array' and (r->>'total')::int = least(n_wa, 500) + least(n_j, 500)
                         and (base > 0 or (r->'rows' = '[]'::jsonb and (r->>'total')::int = 0 and r->>'truncated' = 'false')));

    select format('%s/%s/%s/%s', (select count(*) from public.whatsapp_automations), (select count(*) from public.whatsapp_automation_runs),
                  (select count(*) from public.comms_journeys), (select count(*) from public.comms_journey_runs)) into before_counts;

    -- ════ fake rows (secret-looking values must never come back) ════
    insert into public.whatsapp_automations (name, enabled, trigger_type, channel, event_id, offset_minutes, scheduled_at, conditions,
                                             template_id, message_type, variable_mapping, created_by, last_run_at, created_at)
    values ('ZZTEST wa scheduled', true, 'scheduled', 'whatsapp', null, 0, now() + interval '2 days', '{"state":"ZZSTATE"}',
            'zz_secret_template', 'text_var', '[{"source":"static","value":"zz-secret@example.invalid"}]', adm, now() - interval '1 hour', now() - interval '3 days')
    returning id into wa1;
    insert into public.whatsapp_automations (name, enabled, trigger_type, channel, event_id, offset_minutes, template_id, created_at)
    values ('ZZTEST wa before event', false, 'event_before', 'email', null, 120, 'zz_secret_template2', now() - interval '2 days')
    returning id into wa2;
    insert into public.whatsapp_automations (name, enabled, trigger_type, channel, template_id, created_at)
    values (inj, true, 'event_after', 'sms', 'zz_secret_template3', now() - interval '1 day') returning id into wa3;
    insert into public.whatsapp_automations (name, enabled, trigger_type, template_id, created_at)
    values ('ZZTEST ' || repeat('n', 293), true, 'scheduled', 'zz_secret_template4', now() - interval '4 days') returning id into wa4;
    insert into public.whatsapp_automations (name, enabled, trigger_type, template_id, created_at)
    values ('ZZTEST wa all failed', true, 'scheduled', 'zz_secret_template5', now() - interval '5 days') returning id into wa5;

    insert into public.whatsapp_automation_runs (automation_id, run_key, sent, failed, fired_at)
    values (wa1, 'sched:zz-older', 5, 0, now() - interval '2 days'),
           (wa1, 'sched:zz-latest', 3, 2, now() - interval '1 hour'),
           (wa3, 'after:zz', 4, 0, now() - interval '5 hours'),
           (wa4, 'sched:zz-empty', 0, 0, now() - interval '6 hours'),
           (wa5, 'sched:zz-fail', 0, 7, now() - interval '7 hours');

    insert into public.comms_journeys (name, enabled, channel, product, branches, created_by, last_run_at, created_at)
    values ('ZZTEST journey', true, 'email', 'codesprint',
            '[{"kind":"if","match":"all","conditions":[{"field":"state","op":"eq","value":"9000000399"}],"template_ref":"zz_secret_tpl"}]',
            adm, now() - interval '30 minutes', now() - interval '12 hours')
    returning id into j1;
    insert into public.comms_journeys (name, enabled, channel, product, created_at)
    values ('ZZTEST journey off', false, 'whatsapp', 'Weird Product!', now() - interval '6 days') returning id into j2;
    insert into public.comms_journey_runs (journey_id, user_id, branch_index, fired_at)
    values (j1, u1, 0, now() - interval '3 hours'), (j1, u2, 0, now() - interval '2 hours'), (j1, u3, 1, now() - interval '30 minutes');

    r := pg_temp.call_as(adm, q);

    -- ════ C. admin gets the rows, with the right fields ════
    t_name := t_name || text 'C admin: total = existing + 7 test rows, not truncated'; t_det := t_det || format('total=%s base=%s truncated=%s', r->>'total', base, r->>'truncated');
    t_pass := t_pass || ((r->>'total')::int = least(n_wa + 5, 500) + least(n_j + 2, 500) and jsonb_array_length(r->'rows') = (r->>'total')::int
                         and (base > 0 or r->>'truncated' = 'false'));

    x := pg_temp.row_of(r, wa1);
    t_name := t_name || text 'C WhatsApp scheduled, enabled: engine, trigger, channel, enabled, created_at, last_run_at'; t_det := t_det || coalesce(x::text, 'missing');
    t_pass := t_pass || (x->>'engine' = 'whatsapp' and x->>'trigger' = 'scheduled' and x->>'channel' = 'whatsapp' and (x->>'enabled')::boolean
                         and (x->>'created_at')::timestamptz = (select created_at from public.whatsapp_automations where id = wa1)
                         and (x->>'last_run_at')::timestamptz = (select last_run_at from public.whatsapp_automations where id = wa1)
                         and x->>'name' = 'ZZTEST wa scheduled' and x->'product' = 'null'::jsonb);
    t_name := t_name || text 'C last run = the LATEST run only: 2 runs, last 3 sent / 2 failed → partial'; t_det := t_det || coalesce(x::text, 'missing');
    t_pass := t_pass || ((x->>'runs')::int = 2 and (x->>'last_sent')::int = 3 and (x->>'last_failed')::int = 2 and x->>'last_status' = 'partial');

    x := pg_temp.row_of(r, wa2);
    t_name := t_name || text 'C disabled, before-event, e-mail, never ran: enabled false, runs 0, status never, counts null'; t_det := t_det || coalesce(x::text, 'missing');
    t_pass := t_pass || (not (x->>'enabled')::boolean and x->>'trigger' = 'event_before' and x->>'channel' = 'email'
                         and (x->>'runs')::int = 0 and x->>'last_status' = 'never' and x->'last_sent' = 'null'::jsonb
                         and x->'last_failed' = 'null'::jsonb and x->'last_run_at' = 'null'::jsonb);

    x := pg_temp.row_of(r, wa3);
    t_name := t_name || text 'C unknown channel (sms) → "other"; all sent → "sent"; injection-looking name is returned as plain data'; t_det := t_det || coalesce(x::text, 'missing');
    t_pass := t_pass || (x->>'channel' = 'other' and x->>'last_status' = 'sent' and x->>'name' = inj and x->>'trigger' = 'event_after');
    t_name := t_name || text 'C the injection-looking name changed nothing (profiles still there)';
    t_det := t_det || (select count(*)::text from public.profiles where email like 'zztest-%@example.invalid');
    t_pass := t_pass || ((select count(*) from public.profiles where email like 'zztest-%@example.invalid') = 2);

    x := pg_temp.row_of(r, wa4);
    t_name := t_name || text 'C 300-character name is cut to 200; a run with 0 sent / 0 failed → "none"'; t_det := t_det || coalesce(length(x->>'name')::text || ' ' || (x->>'last_status'), 'missing');
    t_pass := t_pass || (length(x->>'name') = 200 and x->>'last_status' = 'none');
    x := pg_temp.row_of(r, wa5);
    t_name := t_name || text 'C 0 sent / 7 failed → "failed"'; t_det := t_det || coalesce(x::text, 'missing');
    t_pass := t_pass || (x->>'last_status' = 'failed' and (x->>'last_failed')::int = 7 and (x->>'last_sent')::int = 0);

    x := pg_temp.row_of(r, j1);
    t_name := t_name || text 'C journey: engine journey, trigger conditions, product, runs = messages fired (3), status fired'; t_det := t_det || coalesce(x::text, 'missing');
    t_pass := t_pass || (x->>'engine' = 'journey' and x->>'trigger' = 'conditions' and x->>'channel' = 'email' and x->>'product' = 'codesprint'
                         and (x->>'runs')::int = 3 and x->>'last_status' = 'fired' and x->'last_sent' = 'null'::jsonb
                         and (x->>'last_run_at')::timestamptz = (select last_run_at from public.comms_journeys where id = j1));
    x := pg_temp.row_of(r, j2);
    t_name := t_name || text 'C journey: unusual product text → "other"; disabled; never fired'; t_det := t_det || coalesce(x::text, 'missing');
    t_pass := t_pass || (x->>'product' = 'other' and not (x->>'enabled')::boolean and x->>'last_status' = 'never' and (x->>'runs')::int = 0);

    t_name := t_name || text 'C rows are newest first (created_at desc)';
    select string_agg(e->>'name', ' > ' order by o) into bad from jsonb_array_elements(r->'rows') with ordinality as t(e, o) where e->>'name' like 'ZZTEST%';
    t_det := t_det || left(coalesce(bad, ''), 300);
    t_pass := t_pass || (not exists (select 1 from (select (e->>'created_at')::timestamptz c, lag((e->>'created_at')::timestamptz) over (order by o) p
                                                      from jsonb_array_elements(r->'rows') with ordinality as t(e, o)) s where s.c > s.p));

    -- ════ D. output whitelist: no phone / e-mail / body / template / user ids ════
    select string_agg(distinct k, ',') into bad
      from jsonb_array_elements(r->'rows') e, jsonb_object_keys(e) k where not (k = any (allowed));
    t_name := t_name || text 'D every row has only whitelisted keys'; t_det := t_det || coalesce(bad, 'none extra');
    t_pass := t_pass || (bad is null and (select bool_and((select count(*) from jsonb_object_keys(e)) = array_length(allowed, 1)) from jsonb_array_elements(r->'rows') e));
    t_name := t_name || text 'D top level has only total, truncated, rows';
    t_det := t_det || (select string_agg(k, ',' order by k) from jsonb_object_keys(r) k);
    t_pass := t_pass || ((select array_agg(k order by k) from jsonb_object_keys(r) k) = array['rows','total','truncated']);
    t_name := t_name || text 'D no template id, mapping, condition value, e-mail, phone, run key or user id in the answer';
    t_det := t_det || text 'checked';
    t_pass := t_pass || (position('zz_secret' in r::text) = 0 and position('example.invalid' in r::text) = 0 and position('9000000399' in r::text) = 0
                         and position('ZZSTATE' in r::text) = 0 and position('sched:zz' in r::text) = 0 and position('text_var' in r::text) = 0
                         and position(adm::text in r::text) = 0 and position(u1::text in r::text) = 0 and position(u3::text in r::text) = 0);

    -- ════ E. read-only: the call wrote nothing ════
    select format('%s/%s/%s/%s', (select count(*) from public.whatsapp_automations), (select count(*) from public.whatsapp_automation_runs),
                  (select count(*) from public.comms_journeys), (select count(*) from public.comms_journey_runs)) into after_counts;
    r := pg_temp.call_as(adm, q);
    r := pg_temp.call_as(adm, q);
    t_name := t_name || text 'E repeated calls change nothing (row counts and last_run_at stay the same)';
    t_det := t_det || (after_counts || ' -> ' || format('%s/%s/%s/%s', (select count(*) from public.whatsapp_automations), (select count(*) from public.whatsapp_automation_runs),
                  (select count(*) from public.comms_journeys), (select count(*) from public.comms_journey_runs)));
    t_pass := t_pass || (after_counts = format('%s/%s/%s/%s', (select count(*) from public.whatsapp_automations), (select count(*) from public.whatsapp_automation_runs),
                  (select count(*) from public.comms_journeys), (select count(*) from public.comms_journey_runs))
                  and before_counts <> after_counts
                  and (select last_run_at from public.whatsapp_automations where id = wa2) is null);

    raise exception using errcode = 'ZDONE';
  exception when sqlstate 'ZDONE' then null;
  end;

  return query select x.n, x.p, x.d from unnest(t_name, t_pass, t_det) as x(n, p, d);
end $$;

select * from pg_temp.run_comm_slice8_tests();

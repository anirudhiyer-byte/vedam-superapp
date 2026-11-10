-- traffic_events insert guard · tests for migration 0075 (QA finding M3)
--
-- How to run (STAGING ONLY): paste this whole file into the staging SQL editor, or run it
-- through the Supabase MCP / psql. The last statement returns one row per test:
-- test | pass | detail.
--
-- Inserts happen as the browser roles (anon / authenticated, the way the API does it) inside a
-- block that is rolled back at the end, so nothing is left behind. Session ids start with
-- "zztest-guard-" so the rows are easy to recognise while the test runs.

create or replace function pg_temp.ins_as(p_uid uuid, p_row jsonb)
returns jsonb language plpgsql as $$
declare n int;
begin
  if p_uid is null then
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    set local role anon;
  else
    perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
    set local role authenticated;
  end if;
  insert into public.traffic_events (session_id, user_id, path, kind, label, section, utm_source, utm_medium, utm_campaign, created_at)
  select r.session_id, r.user_id, r.path, r.kind, r.label, r.section, r.utm_source, r.utm_medium, r.utm_campaign, coalesce(r.created_at, now())
  from jsonb_populate_record(null::public.traffic_events, p_row) r;
  get diagnostics n = row_count;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return jsonb_build_object('inserted', n);
exception when others then
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return jsonb_build_object('sqlstate', sqlstate, 'message', sqlerrm);
end $$;

create or replace function pg_temp.run_traffic_guard_tests()
returns table (test text, pass boolean, detail text) language plpgsql as $$
declare
  t_name text[] := '{}'; t_pass boolean[] := '{}'; t_det text[] := '{}';
  u uuid; other uuid; r jsonb; t record; n int;
begin
  begin -- everything below is rolled back at the end (ZDONE)
    u := gen_random_uuid(); other := gen_random_uuid();
    insert into auth.users (id, email, aud, role, raw_user_meta_data) values
      (u, 'zztest-guard-u@example.invalid', 'authenticated', 'authenticated', '{}'),
      (other, 'zztest-guard-other@example.invalid', 'authenticated', 'authenticated', '{}');

    -- ════ A. what the real trackers send still works ════
    r := pg_temp.ins_as(null, '{"session_id":"zztest-guard-a1","path":"/"}');
    select * into t from public.traffic_events where session_id = 'zztest-guard-a1';
    t_name := t_name || text 'A anon page view (tracker shape) is stored as a view';
    t_det := t_det || (r::text || ' kind=' || coalesce(t.kind, 'null'));
    t_pass := t_pass || ((r->>'inserted')::int = 1 and t.kind = 'view' and t.user_id is null);

    r := pg_temp.ins_as(u, jsonb_build_object('session_id', 'zztest-guard-a2', 'user_id', u, 'path', '/events/VED-EVT-FF95F8', 'utm_source', 'WhatsApp'));
    select * into t from public.traffic_events where session_id = 'zztest-guard-a2';
    t_name := t_name || text 'A signed-in page view keeps the user, path and source';
    t_det := t_det || r::text;
    t_pass := t_pass || ((r->>'inserted')::int = 1 and t.user_id = u and t.path = '/events/VED-EVT-FF95F8' and t.utm_source = 'WhatsApp');

    r := pg_temp.ins_as(null, '{"session_id":"zztest-guard-a3","path":"/codesprint","kind":"click","label":"Enroll now","section":"hero"}');
    select * into t from public.traffic_events where session_id = 'zztest-guard-a3';
    t_name := t_name || text 'A click (click-tracker shape) is stored';
    t_det := t_det || r::text;
    t_pass := t_pass || ((r->>'inserted')::int = 1 and t.kind = 'click' and t.label = 'Enroll now');

    r := pg_temp.ins_as(null, '{"session_id":"anon","path":"/"}');
    t_name := t_name || text 'A the trackers'' fallback session id "anon" is accepted';
    t_det := t_det || r::text; t_pass := t_pass || ((r->>'inserted')::int = 1);
    delete from public.traffic_events where session_id = 'anon' and created_at >= now() - interval '1 second' and path = '/';

    r := pg_temp.ins_as(null, '{"session_id":"1234567890123456","path":"/pyq/jee-main-2024"}');
    t_name := t_name || text 'A numeric session ids (old-browser fallback) are accepted';
    t_det := t_det || r::text; t_pass := t_pass || ((r->>'inserted')::int = 1);
    delete from public.traffic_events where session_id = '1234567890123456';

    r := pg_temp.ins_as(null, jsonb_build_object('session_id', 'zztest-guard-a4', 'path', '/' || repeat('a', 299)));
    t_name := t_name || text 'A a path of exactly 300 characters is accepted (no regex repetition limit hit)';
    t_det := t_det || r::text; t_pass := t_pass || coalesce((r->>'inserted')::int = 1, false);

    -- ════ B. forged values are corrected ════
    r := pg_temp.ins_as(null, '{"session_id":"zztest-guard-b1","path":"/register","created_at":"2025-01-01T00:00:00Z"}');
    select * into t from public.traffic_events where session_id = 'zztest-guard-b1';
    t_name := t_name || text 'B a back-dated row gets the real time';
    t_det := t_det || (r::text || ' created_at=' || t.created_at);
    t_pass := t_pass || (t.created_at >= now() - interval '1 minute');

    r := pg_temp.ins_as(null, jsonb_build_object('session_id', 'zztest-guard-b2', 'path', '/', 'user_id', other));
    select * into t from public.traffic_events where session_id = 'zztest-guard-b2';
    t_name := t_name || text 'B anon cannot write a row for a user';
    t_det := t_det || r::text; t_pass := t_pass || (t.user_id is null);

    r := pg_temp.ins_as(u, jsonb_build_object('session_id', 'zztest-guard-b3', 'path', '/', 'user_id', other));
    select * into t from public.traffic_events where session_id = 'zztest-guard-b3';
    t_name := t_name || text 'B a signed-in user cannot write a row for someone else (stored as themselves)';
    t_det := t_det || r::text; t_pass := t_pass || (t.user_id = u);

    r := pg_temp.ins_as(null, jsonb_build_object('session_id', 'zztest-guard-b4', 'path', '/', 'kind', 'click', 'label', repeat('x', 5000),
                                                 'section', repeat('s', 500), 'utm_source', repeat('u', 5000), 'utm_medium', repeat('m', 900), 'utm_campaign', repeat('c', 900)));
    select * into t from public.traffic_events where session_id = 'zztest-guard-b4';
    t_name := t_name || text 'B very long label / section / utm values are cut to 120 / 80 / 200';
    t_det := t_det || format('%s %s %s %s %s', length(t.label), length(t.section), length(t.utm_source), length(t.utm_medium), length(t.utm_campaign));
    t_pass := t_pass || (length(t.label) = 120 and length(t.section) = 80 and length(t.utm_source) = 200 and length(t.utm_medium) = 200 and length(t.utm_campaign) = 200);

    r := pg_temp.ins_as(null, '{"session_id":"zztest-guard-b5","path":"/","kind":null}');
    select * into t from public.traffic_events where session_id = 'zztest-guard-b5';
    t_name := t_name || text 'B a missing kind is stored as a view';
    t_det := t_det || r::text; t_pass := t_pass || (t.kind = 'view');

    -- ════ C. junk rows are skipped (silently, like the trackers expect) ════
    for t in select * from (values
        ('other kind',            '{"session_id":"zztest-guard-c1","path":"/","kind":"purchase"}'),
        ('path without slash',    '{"session_id":"zztest-guard-c2","path":"register"}'),
        ('path with query',       '{"session_id":"zztest-guard-c3","path":"/register?x=1"}'),
        ('path with space',       '{"session_id":"zztest-guard-c4","path":"/a b"}'),
        ('path too long',         jsonb_build_object('session_id', 'zztest-guard-c5', 'path', '/' || repeat('a', 300))::text),
        ('no path',               '{"session_id":"zztest-guard-c6"}'),
        ('no session',            '{"path":"/"}'),
        ('session with spaces',   '{"session_id":"zztest guard c8","path":"/"}'),
        ('session too long',      jsonb_build_object('session_id', 'zztest-guard-' || repeat('9', 100), 'path', '/')::text)
      ) v(name, js) loop
      r := pg_temp.ins_as(null, t.js::jsonb);
      t_name := t_name || ('C skipped: ' || t.name);
      t_det := t_det || r::text;
      t_pass := t_pass || ((r->>'inserted')::int = 0);
    end loop;

    select count(*) into n from public.traffic_events where session_id like 'zztest-guard-c%' or (session_id is null and created_at >= now() - interval '1 minute');
    t_name := t_name || text 'C none of the skipped rows were stored';
    t_det := t_det || n::text; t_pass := t_pass || (n = 0);

    -- ════ D. database-side writers are not touched ════
    insert into public.traffic_events (session_id, path, kind, created_at) values ('zztest-guard-d1', '/old', 'view', '2025-01-01T00:00:00Z');
    select * into t from public.traffic_events where session_id = 'zztest-guard-d1';
    t_name := t_name || text 'D rows written by the database itself (scripts, service role) keep their values';
    t_det := t_det || t.created_at::text; t_pass := t_pass || (t.created_at = '2025-01-01T00:00:00Z');

    t_name := t_name || text 'D trigger function is not callable from a browser';
    t_det := t_det || (has_function_privilege('anon', 'public.trg_traffic_events_guard()', 'execute')::text || '/' || has_function_privilege('authenticated', 'public.trg_traffic_events_guard()', 'execute')::text);
    t_pass := t_pass || (not has_function_privilege('anon', 'public.trg_traffic_events_guard()', 'execute')
                         and not has_function_privilege('authenticated', 'public.trg_traffic_events_guard()', 'execute'));

    raise exception using errcode = 'ZDONE';
  exception when sqlstate 'ZDONE' then null;
  end;

  return query select x.n, x.p, x.d from unnest(t_name, t_pass, t_det) as x(n, p, d);
end $$;

select test, coalesce(pass, false) as pass, detail from pg_temp.run_traffic_guard_tests();

-- Bootcamp active users = 2+ minutes on Bootcamp pages · tests for migration 0078
--
-- How to run (STAGING ONLY): paste this whole file into the staging SQL editor, or run it through
-- the Supabase MCP / psql. The last statement returns one row per test: test | pass | detail.
-- Everything is written inside a block that is rolled back at the end (ZDONE), so nothing is left
-- behind. Test users have emails zztest-bcact-*@example.invalid.

create or replace function pg_temp.bc_call(p_uid uuid, p_sql text)
returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  set local role authenticated;
  execute p_sql into v;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return v;
exception when others then
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return jsonb_build_object('sqlstate', sqlstate, 'message', sqlerrm);
end $$;

create or replace function pg_temp.run_bootcamp_active_tests()
returns table (test text, pass boolean, detail text) language plpgsql as $$
declare
  t_name text[] := '{}'; t_pass boolean[] := '{}'; t_det text[] := '{}';
  adm uuid; nob uuid; u1 uuid; u2 uuid; u3 uuid; u4 uuid; u5 uuid;
  today date := (now() at time zone 'Asia/Kolkata')::date;
  b0 jsonb; b1 jsonb; c0 jsonb; c1 jsonb; d0 jsonb; d1 jsonb; e0 jsonb; e1 jsonb; r jsonb;
  ev uuid; acl_before text; acl_after text;
begin
  begin
    adm := gen_random_uuid(); nob := gen_random_uuid();
    u1 := gen_random_uuid(); u2 := gen_random_uuid(); u3 := gen_random_uuid(); u4 := gen_random_uuid(); u5 := gen_random_uuid();
    insert into auth.users (id, email, aud, role, raw_user_meta_data) values
      (adm, 'zztest-bcact-adm@example.invalid', 'authenticated', 'authenticated', '{}'),
      (nob, 'zztest-bcact-nob@example.invalid', 'authenticated', 'authenticated', '{}'),
      (u1, 'zztest-bcact-1@example.invalid', 'authenticated', 'authenticated', '{}'),
      (u2, 'zztest-bcact-2@example.invalid', 'authenticated', 'authenticated', '{}'),
      (u3, 'zztest-bcact-3@example.invalid', 'authenticated', 'authenticated', '{}'),
      (u4, 'zztest-bcact-4@example.invalid', 'authenticated', 'authenticated', '{}'),
      (u5, 'zztest-bcact-5@example.invalid', 'authenticated', 'authenticated', '{}');
    insert into public.user_roles (user_id, role) values (adm, 'admin');

    -- before: what both dashboards say now
    b0 := (select x from jsonb_array_elements(pg_temp.bc_call(adm, 'select public.ins_active(30)')->'products') x where x->>'product' = 'bootcamp');
    c0 := (select x from jsonb_array_elements(pg_temp.bc_call(adm, 'select public.ins_active(30)')->'products') x where x->>'product' = 'codesprint');
    d0 := pg_temp.bc_call(adm, 'select to_jsonb(t) from public.dash_active_users(''bootcamp'') t');
    e0 := pg_temp.bc_call(adm, 'select to_jsonb(t) from public.dash_active_users(''codesprint'') t');

    -- today: u1 = 2:00 on Bootcamp pages (active), u2 = 1:59 (not active), u3 = 5:00 (active)
    -- u4 = 0 page time but 90 minutes in the live Zoom of a bootcamp held today (NOT active any more)
    -- u5 = 3:00 on CodeSprint (not active: CodeSprint keeps the 5-minute bar)
    insert into public.product_active_daily (user_id, product, day, active_seconds) values
      (u1, 'bootcamp', today, 120), (u2, 'bootcamp', today, 119), (u3, 'bootcamp', today, 300), (u5, 'codesprint', today, 180);
    select e.id into ev from public.events e where e.starts_at is not null order by e.starts_at desc limit 1;
    if ev is not null then
      insert into public.bootcamp_participation (user_id, event_id, registered_at, attended, attended_minutes)
      values (u4, ev, now(), true, 90);
      update public.events set starts_at = now() where id = ev;  -- rolled back with everything else
    end if;

    b1 := (select x from jsonb_array_elements(pg_temp.bc_call(adm, 'select public.ins_active(30)')->'products') x where x->>'product' = 'bootcamp');
    c1 := (select x from jsonb_array_elements(pg_temp.bc_call(adm, 'select public.ins_active(30)')->'products') x where x->>'product' = 'codesprint');
    d1 := pg_temp.bc_call(adm, 'select to_jsonb(t) from public.dash_active_users(''bootcamp'') t');
    e1 := pg_temp.bc_call(adm, 'select to_jsonb(t) from public.dash_active_users(''codesprint'') t');

    t_name := t_name || text 'Insights: Bootcamp today rises by 2 (2:00 and 5:00 count; 1:59 and Zoom-only do not)';
    t_det := t_det || format('before %s after %s', b0->>'dau', b1->>'dau');
    t_pass := t_pass || ((b1->>'dau')::int - (b0->>'dau')::int = 2);

    t_name := t_name || text 'Insights: Bootcamp 7 and 30 days rise by the same 2';
    t_det := t_det || format('wau %s→%s mau %s→%s', b0->>'wau', b1->>'wau', b0->>'mau', b1->>'mau');
    t_pass := t_pass || ((b1->>'wau')::int - (b0->>'wau')::int = 2 and (b1->>'mau')::int - (b0->>'mau')::int = 2);

    t_name := t_name || text 'Insights: Zoom time alone no longer makes a Bootcamp user active';
    t_det := t_det || coalesce(ev::text, 'no event on this database: Zoom row not inserted');
    t_pass := t_pass || ((b1->>'dau')::int - (b0->>'dau')::int = 2);

    t_name := t_name || text 'Insights: CodeSprint keeps the 5-minute bar (3:00 does not count)';
    t_det := t_det || format('before %s after %s', c0->>'dau', c1->>'dau');
    t_pass := t_pass || ((c1->>'dau')::int = (c0->>'dau')::int);

    t_name := t_name || text 'Daily Dashboard: Bootcamp today rises by the same 2 (dashboards agree)';
    t_det := t_det || format('before %s after %s', d0->>'dau', d1->>'dau');
    t_pass := t_pass || ((d1->>'dau')::int - (d0->>'dau')::int = 2);

    t_name := t_name || text 'Daily Dashboard and Insights give the same Bootcamp numbers (today, 7d, 30d, both previous)';
    t_det := t_det || format('dash %s/%s/%s/%s/%s/%s · ins %s/%s/%s/%s/%s/%s', d1->>'dau', d1->>'dau_prev', d1->>'wau', d1->>'wau_prev', d1->>'mau', d1->>'mau_prev',
                             b1->>'dau', b1->>'dau_prev', b1->>'wau', b1->>'wau_prev', b1->>'mau', b1->>'mau_prev');
    t_pass := t_pass || ((d1->>'dau') = (b1->>'dau') and (d1->>'dau_prev') = (b1->>'dau_prev') and (d1->>'wau') = (b1->>'wau')
                         and (d1->>'wau_prev') = (b1->>'wau_prev') and (d1->>'mau') = (b1->>'mau') and (d1->>'mau_prev') = (b1->>'mau_prev'));

    t_name := t_name || text 'Daily Dashboard: Bootcamp uses 2 minutes even if a caller passes p_min = 300';
    r := pg_temp.bc_call(adm, 'select to_jsonb(t) from public.dash_active_users(''bootcamp'', 300) t');
    t_det := t_det || format('p_min 300: %s, default: %s, before: %s', r->>'dau', d1->>'dau', d0->>'dau');
    t_pass := t_pass || ((r->>'dau') = (d1->>'dau') and (r->>'dau')::int - (d0->>'dau')::int = 2);

    t_name := t_name || text 'Daily Dashboard: CodeSprint keeps the 5-minute bar';
    t_det := t_det || format('before %s after %s', e0->>'dau', e1->>'dau');
    t_pass := t_pass || ((e1->>'dau')::int = (e0->>'dau')::int);

    t_name := t_name || text 'Daily Dashboard: other products still honour p_min (CodeSprint at 120 s counts the 3:00 user)';
    r := pg_temp.bc_call(adm, 'select to_jsonb(t) from public.dash_active_users(''codesprint'', 120) t');
    t_det := t_det || format('%s', r->>'dau');
    t_pass := t_pass || ((r->>'dau')::int >= 1);

    t_name := t_name || text 'Insights: Bootcamp "tracked since" = its first heartbeat day';
    t_det := t_det || format('%s vs %s', b1->>'tracked_since', (select min(day) from public.product_active_daily where product = 'bootcamp'));
    t_pass := t_pass || ((b1->>'tracked_since')::date = (select min(day) from public.product_active_daily where product = 'bootcamp'));

    t_name := t_name || text 'Insights: trend has today''s Bootcamp count';
    r := pg_temp.bc_call(adm, 'select public.ins_active(30)');
    t_det := t_det || coalesce((select x::text from jsonb_array_elements(r->'trend') x where x->>'product' = 'bootcamp' and (x->>'day')::date = today), 'none');
    t_pass := t_pass || coalesce((select (x->>'dau')::int = (b1->>'dau')::int from jsonb_array_elements(r->'trend') x where x->>'product' = 'bootcamp' and (x->>'day')::date = today), false);

    -- access is unchanged
    t_name := t_name || text 'Non-admin: ins_active refused';
    r := pg_temp.bc_call(nob, 'select public.ins_active(30)');
    t_det := t_det || coalesce(r->>'sqlstate', 'NOT REFUSED'); t_pass := t_pass || (r->>'sqlstate' = '42501');

    t_name := t_name || text 'Non-admin: dash_active_users returns zeros (as before)';
    r := pg_temp.bc_call(nob, 'select to_jsonb(t) from public.dash_active_users(''bootcamp'') t');
    t_det := t_det || r::text; t_pass := t_pass || ((r->>'dau')::int = 0 and (r->>'mau')::int = 0);

    t_name := t_name || text 'Both functions: SECURITY DEFINER with search_path ''''';
    t_det := t_det || (select string_agg(p.proname || ' ' || p.prosecdef || ' ' || coalesce(array_to_string(p.proconfig, ','), '-'), ' · ') from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('ins_active', 'dash_active_users'));
    t_pass := t_pass || ((select bool_and(p.prosecdef and p.proconfig @> array['search_path=""']) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('ins_active', 'dash_active_users')));

    t_name := t_name || text 'ins_active: browsers cannot call it signed out (grants unchanged)';
    t_det := t_det || (has_function_privilege('anon', 'public.ins_active(int)', 'execute')::text || '/' || has_function_privilege('authenticated', 'public.ins_active(int)', 'execute')::text);
    t_pass := t_pass || (not has_function_privilege('anon', 'public.ins_active(int)', 'execute') and has_function_privilege('authenticated', 'public.ins_active(int)', 'execute'));

    raise exception using errcode = 'ZDONE';
  exception when sqlstate 'ZDONE' then null;
  end;

  return query select x.n, x.p, x.d from unnest(t_name, t_pass, t_det) as x(n, p, d);
end $$;

select test, coalesce(pass, false) as pass, detail from pg_temp.run_bootcamp_active_tests();

-- Calling search · a name no longer matches every lead — tests for migration 0182 (STAGING ONLY)
--
-- Paste into the staging SQL editor (or run via the Supabase MCP) in ONE call. The last statement
-- returns one row per test: test | pass | detail. Everything is rolled back at the end (ZDONE).
-- Fake data only (ZZCSR names / @example.invalid). Refuses to run unless app_flags.environment = 'staging'.

create or replace function pg_temp.csr_user(p_tag text, p_role text default null)
returns uuid language plpgsql as $$
declare u uuid := gen_random_uuid(); e text := 'zzcsr-' || lower(p_tag) || '@example.invalid';
begin
  insert into auth.users (id, email, aud, role, email_confirmed_at, raw_user_meta_data)
    values (u, e, 'authenticated', 'authenticated', now(), '{}'::jsonb);
  insert into public.profiles (id, email, full_name) values (u, e, 'ZZCSR ' || p_tag) on conflict (id) do nothing;
  if p_role is not null then insert into public.user_roles (user_id, role) values (u, p_role::public.app_role); end if;
  return u;
end $$;

create or replace function pg_temp.csr_call(p_uid uuid, p_sql text, p_anon boolean default false)
returns jsonb language plpgsql as $$
declare r jsonb;
begin
  if p_anon then perform set_config('request.jwt.claims', '{"role":"anon"}', true); set local role anon;
  else perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true); set local role authenticated; end if;
  execute p_sql into r; reset role; perform set_config('request.jwt.claims', '', true); return coalesce(r, 'null'::jsonb);
exception when others then reset role; perform set_config('request.jwt.claims', '', true); return jsonb_build_object('sqlstate', sqlstate, 'message', sqlerrm);
end $$;

-- names of the ZZCSR leads a search returns (sorted), from the admin list or the caller's queue
create or replace function pg_temp.csr_names(p_uid uuid, p_fn text, p_search text)
returns text language sql as $$
  select coalesce(string_agg(x->>'name', ',' order by x->>'name'), '∅')
    from jsonb_array_elements(pg_temp.csr_call(p_uid, format('select public.%I(%L::jsonb)', p_fn,
           jsonb_build_object('search', p_search, 'limit', 500)::text))->'rows') x
   where x->>'name' like 'ZZCSR %'
$$;

create or replace function pg_temp.run_calling_search_tests()
returns table (test text, pass boolean, detail text) language plpgsql as $$
declare
  tn text[] := '{}'; tp boolean[] := '{}'; td text[] := '{}';
  adm uuid; cA uuid; usr uuid; r jsonb; s text;
begin
  begin
    if coalesce((select value from public.app_flags where key = 'environment'), '') <> 'staging' then raise exception 'not staging'; end if;

    adm := pg_temp.csr_user('admin', 'admin');
    cA  := pg_temp.csr_user('caller', 'caller');
    usr := pg_temp.csr_user('plain');
    insert into public.calling_leads (name, phone, email, source, assigned_to) values
      ('ZZCSR Ravi', '+91 91000 00011', 'zzcsr-ravi@example.invalid', 'manual', cA),
      ('ZZCSR Meera', '919100000012', 'zzcsr-meera@example.invalid', 'manual', cA),
      ('ZZCSR Kabir', '919100000013', null, 'manual', null);

    -- ── A. admin list ──
    s := pg_temp.csr_names(adm, 'calling_admin_list', 'ZZCSR Ravi');
    tn := tn || text 'A a name finds only that lead (was: every lead)'; td := td || s; tp := tp || (s = 'ZZCSR Ravi');
    s := pg_temp.csr_names(adm, 'calling_admin_list', 'zzcsr meera');
    tn := tn || text 'A name search ignores case'; td := td || s; tp := tp || (s = 'ZZCSR Meera');
    s := pg_temp.csr_names(adm, 'calling_admin_list', 'nobody-by-this-name');
    tn := tn || text 'A a name that matches nobody returns nobody'; td := td || s; tp := tp || (s = '∅');
    s := pg_temp.csr_names(adm, 'calling_admin_list', '9100000011');
    tn := tn || text 'A full phone still finds the lead'; td := td || s; tp := tp || (s = 'ZZCSR Ravi');
    s := pg_temp.csr_names(adm, 'calling_admin_list', '+91 91000 00012');
    tn := tn || text 'A a formatted phone still finds the lead'; td := td || s; tp := tp || (s = 'ZZCSR Meera');
    s := pg_temp.csr_names(adm, 'calling_admin_list', '91000000');
    tn := tn || text 'A part of a phone still finds every match'; td := td || s; tp := tp || (s = 'ZZCSR Kabir,ZZCSR Meera,ZZCSR Ravi');
    s := pg_temp.csr_names(adm, 'calling_admin_list', 'zzcsr-ravi@');
    tn := tn || text 'A email search still works'; td := td || s; tp := tp || (s = 'ZZCSR Ravi');
    s := pg_temp.csr_names(adm, 'calling_admin_list', '');
    tn := tn || text 'A empty search = no filter (all three)'; td := td || s; tp := tp || (s = 'ZZCSR Kabir,ZZCSR Meera,ZZCSR Ravi');

    -- ── B. caller queue (only their own leads) ──
    s := pg_temp.csr_names(cA, 'calling_my_queue', 'ZZCSR Ravi');
    tn := tn || text 'B caller: a name finds only that lead (was: whole queue)'; td := td || s; tp := tp || (s = 'ZZCSR Ravi');
    s := pg_temp.csr_names(cA, 'calling_my_queue', '9100000012');
    tn := tn || text 'B caller: phone search still works'; td := td || s; tp := tp || (s = 'ZZCSR Meera');
    s := pg_temp.csr_names(cA, 'calling_my_queue', '9100000013');
    tn := tn || text 'B caller: never sees a lead not assigned to them'; td := td || s; tp := tp || (s = '∅');
    s := pg_temp.csr_names(cA, 'calling_my_queue', '');
    tn := tn || text 'B caller: empty search = their whole queue'; td := td || s; tp := tp || (s = 'ZZCSR Meera,ZZCSR Ravi');

    -- ── C. who can call (unchanged) ──
    r := pg_temp.csr_call(usr, 'select public.calling_admin_list(''{}''::jsonb)');
    tn := tn || text 'C non-admin cannot list'; td := td || r::text; tp := tp || (r->>'message' = 'forbidden');
    r := pg_temp.csr_call(usr, 'select public.calling_my_queue(''{}''::jsonb)');
    tn := tn || text 'C non-caller cannot read a queue'; td := td || r::text; tp := tp || (r->>'message' = 'forbidden');
    r := pg_temp.csr_call(null, 'select public.calling_my_queue(''{}''::jsonb)', true);
    tn := tn || text 'C anon cannot read a queue'; td := td || r::text; tp := tp || (r->>'sqlstate' = '42501');
    tn := tn || text 'C both: signed-in only (role check inside), definer, empty search_path';
    select string_agg(p.proname, ',') into s from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname in ('calling_admin_list', 'calling_my_queue')
       and not (has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
                and p.prosecdef and p.proconfig = array['search_path=""']);
    td := td || coalesce(s, 'ok'); tp := tp || (s is null);

    raise exception using errcode = 'ZDONE';
  exception when sqlstate 'ZDONE' then null;
  end;

  return query select x.n, x.p, x.d from unnest(tn, tp, td) as x(n, p, d);
end $$;

select test, coalesce(pass, false) as pass, detail from pg_temp.run_calling_search_tests();

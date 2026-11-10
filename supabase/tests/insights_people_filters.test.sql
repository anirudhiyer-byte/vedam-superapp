-- Insights · tests for migration 0074 (people list filters p_mqr and p_used; QA findings M1, M2)
--
-- How to run (STAGING ONLY): paste this whole file into the staging SQL editor, or run it
-- through the Supabase MCP / psql. The last statement returns one row per test:
-- test | pass | detail. insights_dashboards.test.sql (0062) and insights_scale_fixes.test.sql
-- (0068) must still pass too.
--
-- Nothing is left behind: all test data is created inside a block that is rolled back with
-- a private error code at the end. Test data is fake only (@example.invalid, ZZTEST names).

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

create or replace function pg_temp.run_insights_0074_tests()
returns table (test text, pass boolean, detail text) language plpgsql as $$
declare
  t_name text[] := '{}'; t_pass boolean[] := '{}'; t_det text[] := '{}';
  adm uuid; usr uuid; u1 uuid; u2 uuid; u3 uuid;
  r jsonb; s text;
  -- a 1 ms window holding only the three test sign-ups
  fr text := quote_literal(now()::text) || '::timestamptz';
  tt text := quote_literal((now() + interval '1 millisecond')::text) || '::timestamptz';
  -- a 1 ms window long ago, when u1 and u2 (but not u3) started PYQ; nothing else is in it
  pf text := quote_literal('2001-02-03 04:05:06+00') || '::timestamptz';
  pt text := quote_literal('2001-02-03 04:05:06.001+00') || '::timestamptz';
  names text;
begin
  begin -- everything below is rolled back at the end (ZDONE)
    adm := pg_temp.mk_user('zztest-ins74-admin@example.invalid');
    insert into public.user_roles (user_id, role) values (adm, 'admin');
    usr := pg_temp.mk_user('zztest-ins74-user@example.invalid');
    u1 := pg_temp.mk_user('zztest-ins74-u1@example.invalid');
    u2 := pg_temp.mk_user('zztest-ins74-u2@example.invalid');
    u3 := pg_temp.mk_user('zztest-ins74-u3@example.invalid');
    update public.profiles set created_at = now() - interval '1 day' where id in (adm, usr);

    -- u1: MQR, early-registered for VSAT, started PYQ long ago (before signing up, like imported data)
    update public.profiles set full_name = 'ZZTEST One', stream = 'PCM', grad_year = 2026 where id = u1;
    -- u2: not MQR, early-registered for VSAT, started PYQ long ago
    update public.profiles set full_name = 'ZZTEST Two', stream = 'PCB', grad_year = 2026 where id = u2;
    -- u3: MQR, no VSAT, started PYQ now
    update public.profiles set full_name = 'ZZTEST Three', stream = 'PCMB', grad_year = 2027 where id = u3;

    insert into public.vsat_registrations (user_id, registered, registered_at, signup_at)
      values (u1, true, now(), now()), (u2, true, now(), now());
    insert into public.pyq_attempts (user_id, paper_id, status, started_at, created_at)
      select x.u, p.id, 'in_progress', x.at, x.at
      from (values (u1, '2001-02-03 04:05:06+00'::timestamptz), (u2, '2001-02-03 04:05:06+00'::timestamptz), (u3, now())) x(u, at)
      cross join lateral (select id from public.pyq_papers order by id limit 1) p;

    -- ════ A. security unchanged ════
    s := format('select jsonb_agg(x) from public.ins_people(%s, %s, p_mqr => true) x', fr, tt);
    r := pg_temp.call_as(null, s, true);
    t_name := t_name || text 'A anon refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = '42501');
    r := pg_temp.call_as(usr, s);
    t_name := t_name || text 'A non-admin refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = '42501');
    r := pg_temp.call_as(adm, format('select jsonb_agg(x) from public.ins_people(%s, %s, p_used => ''nope'') x', fr, tt));
    t_name := t_name || text 'A unknown p_used refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = '22023');

    t_name := t_name || text 'A only one ins_people exists; SECURITY DEFINER, search_path empty, authenticated yes, anon no';
    select string_agg(pg_get_function_identity_arguments(p.oid) || ' | ' || p.prosecdef || ' | ' || coalesce(array_to_string(p.proconfig, ','), '')
                      || ' | auth=' || has_function_privilege('authenticated', p.oid, 'execute') || ' anon=' || has_function_privilege('anon', p.oid, 'execute'), ' ;; ')
      into s from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'ins_people';
    t_det := t_det || s;
    t_pass := t_pass || (select count(*) = 1 and bool_and(p.prosecdef and p.proconfig = array['search_path=""']
                                 and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute'))
                         from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'ins_people');

    -- ════ B. old calls behave as before ════
    r := pg_temp.call_as(adm, format('select jsonb_agg(x->>''name'' order by x->>''name'') from public.ins_people(%s, %s) x', fr, tt));
    t_name := t_name || text 'B no new filters: all 3 sign-ups'; t_det := t_det || r::text;
    t_pass := t_pass || (r = '["ZZTEST One", "ZZTEST Three", "ZZTEST Two"]'::jsonb);
    r := pg_temp.call_as(adm, format('select jsonb_agg(x->>''name'' order by x->>''name'') from public.ins_people(%s, %s, null, null, null, null, null, true) x', fr, tt));
    t_name := t_name || text 'B old positional call (8 args) still works: VSAT early = One, Two'; t_det := t_det || r::text;
    t_pass := t_pass || (r = '["ZZTEST One", "ZZTEST Two"]'::jsonb);

    -- ════ C. M1: MQR filter ════
    r := pg_temp.call_as(adm, format('select jsonb_agg(x->>''name'' order by x->>''name'') from public.ins_people(%s, %s, p_mqr => true, p_vsat => true) x', fr, tt));
    t_name := t_name || text 'C M1 funnel step: MQR + VSAT early = only One'; t_det := t_det || r::text;
    t_pass := t_pass || (r = '["ZZTEST One"]'::jsonb);
    r := pg_temp.call_as(adm, format('select jsonb_build_object(''list'', (select count(*) from public.ins_people(%s, %s, p_mqr => true, p_vsat => true)), ''card'', (public.ins_overview(%s, %s)->>''vsat_early_mqr'')::int)', fr, tt, fr, tt));
    t_name := t_name || text 'C M1 list size equals the funnel number (vsat_early_mqr)'; t_det := t_det || r::text;
    t_pass := t_pass || ((r->>'list')::int = (r->>'card')::int and (r->>'list')::int = 1);
    r := pg_temp.call_as(adm, format('select jsonb_build_object(''list'', (select count(*) from public.ins_people(%s, %s, p_mqr => true)), ''card'', (public.ins_overview(%s, %s)->>''mqr'')::int)', fr, tt, fr, tt));
    t_name := t_name || text 'C MQR step: list size equals the MQR number (2)'; t_det := t_det || r::text;
    t_pass := t_pass || ((r->>'list')::int = (r->>'card')::int and (r->>'list')::int = 2);
    r := pg_temp.call_as(adm, format('select jsonb_agg(x->>''name'') from public.ins_people(%s, %s, p_mqr => false) x', fr, tt));
    t_name := t_name || text 'C p_mqr false = non-MQRs only (Two)'; t_det := t_det || r::text;
    t_pass := t_pass || (r = '["ZZTEST Two"]'::jsonb);

    -- ════ D. M2: period of product use ════
    r := pg_temp.call_as(adm, format('select jsonb_agg(x->>''name'' order by x->>''name'') from public.ins_people(%s, %s, p_used => ''pyq'') x', pf, pt));
    t_name := t_name || text 'D M2 PYQ used in the old window = One, Two (they signed up today, outside that window)'; t_det := t_det || r::text;
    t_pass := t_pass || (r = '["ZZTEST One", "ZZTEST Two"]'::jsonb);
    r := pg_temp.call_as(adm, format('select jsonb_build_object(''list'', (select count(*) from public.ins_people(%s, %s, p_used => ''pyq'')), ''row'', (select sum((e->>''users'')::int) from jsonb_array_elements(public.ins_sources(%s, %s, ''pyq'')) e))', pf, pt, pf, pt));
    t_name := t_name || text 'D M2 list size equals the Sources tab total for PYQ in that window'; t_det := t_det || r::text;
    t_pass := t_pass || ((r->>'list')::int = (r->>'row')::int and (r->>'list')::int = 2);
    r := pg_temp.call_as(adm, format('select jsonb_agg(x->>''name'') from public.ins_people(%s, %s, p_used => ''pyq'', p_mqr => true) x', pf, pt));
    t_name := t_name || text 'D filters combine: PYQ in window + MQR = One'; t_det := t_det || r::text;
    t_pass := t_pass || (r = '["ZZTEST One"]'::jsonb);
    r := pg_temp.call_as(adm, format('select jsonb_agg(x->>''name'' order by x->>''name'') from public.ins_people(%s, %s, p_used => ''vsat'') x', fr, tt));
    t_name := t_name || text 'D p_used vsat in the 1 ms window = One, Two'; t_det := t_det || r::text;
    t_pass := t_pass || (r = '["ZZTEST One", "ZZTEST Two"]'::jsonb);
    r := pg_temp.call_as(adm, format('select jsonb_agg(x->>''name'') from public.ins_people(%s, %s, p_used => ''pyq'') x', fr, tt));
    t_name := t_name || text 'D p_used pyq in the 1 ms window = Three only'; t_det := t_det || r::text;
    t_pass := t_pass || (r = '["ZZTEST Three"]'::jsonb);

    raise exception using errcode = 'ZDONE';
  exception when sqlstate 'ZDONE' then null;
  end;

  return query select x.n, x.p, x.d from unnest(t_name, t_pass, t_det) as x(n, p, d);
end $$;

select test, coalesce(pass, false) as pass, detail from pg_temp.run_insights_0074_tests();

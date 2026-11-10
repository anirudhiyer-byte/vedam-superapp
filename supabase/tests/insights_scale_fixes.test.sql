-- Insights dashboards · database tests for migration 0068 (fixes from the 5,000-user test)
--
-- How to run (STAGING ONLY): paste this whole file into the staging SQL editor, or run it
-- through the Supabase MCP / psql. The last statement returns one row per test:
-- test | pass | detail. Also run insights_dashboards.test.sql (0062): it must still pass.
--
-- Nothing is left behind: all test data is created inside a block that is rolled back with
-- a private error code at the end. Test data is fake only (@example.invalid, ZZTEST names).
-- Logged-in calls are simulated the way PostgREST does it (SET ROLE + request.jwt.claims).

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

-- ── the tests ──────────────────────────────────────────────────────────────────
create or replace function pg_temp.run_insights_0068_tests()
returns table (test text, pass boolean, detail text) language plpgsql as $$
declare
  t_name text[] := '{}'; t_pass boolean[] := '{}'; t_det text[] := '{}';
  adm uuid; usr uuid; u1 uuid; u2 uuid; u3 uuid;
  r jsonb; s text; f text;
  fr text := quote_literal(now()::text) || '::timestamptz';
  tt text := quote_literal((now() + interval '1 millisecond')::text) || '::timestamptz';
  calls text[];
begin
  begin -- everything below is rolled back at the end (ZDONE)
    adm := pg_temp.mk_user('zztest-ins67-admin@example.invalid');
    insert into public.user_roles (user_id, role) values (adm, 'admin');
    usr := pg_temp.mk_user('zztest-ins67-user@example.invalid');
    u1 := pg_temp.mk_user('zztest-ins67-u1@example.invalid');
    u2 := pg_temp.mk_user('zztest-ins67-u2@example.invalid');
    u3 := pg_temp.mk_user('zztest-ins67-u3@example.invalid');
    update public.profiles set created_at = now() - interval '1 day' where id in (adm, usr);

    -- u1: MQR with a FULL profile (the trigger decides "full": stream, year, state, city, verified email)
    update public.profiles set full_name = 'ZZTEST One', stream = 'PCM', grad_year = 2026, state = 'Goa', city = 'Panaji',
           email_verified = true where id = u1;
    -- u2: MQR, PARTIAL profile (no city)
    update public.profiles set full_name = 'ZZTEST Two', stream = 'PCMB', grad_year = 2027, state = 'Goa', city = null,
           email_verified = true where id = u2;
    -- u3: NOT MQR (PCB), full profile, state typed in lower case
    update public.profiles set full_name = 'ZZTEST Three', stream = 'PCB', grad_year = 2026, state = 'goa', city = 'Margao',
           email_verified = true where id = u3;

    -- u1 used CodeSprint, then PYQ, then registered for VSAT; u2 registered for VSAT without using a product
    insert into public.cs_enrollments (user_id, enrolled_at) values (u1, now() - interval '2 hours');
    insert into public.pyq_attempts (user_id, paper_id, status, started_at, created_at)
      select u1, p.id, 'in_progress', now() - interval '1 hour', now() - interval '1 hour' from public.pyq_papers p order by p.id limit 1;
    insert into public.vsat_registrations (user_id, registered, registered_at, signup_at)
      values (u1, true, now(), now()), (u2, true, now(), now());

    -- ════ A. who may call (unchanged by 0068) ════
    calls := array[
      format('select public.ins_overview(%s, %s)', fr, tt),
      format('select public.ins_products(%s, %s)', fr, tt),
      format('select public.ins_states(%s, %s, ''all'')', fr, tt),
      format('select public.ins_cross(%s, %s)', fr, tt),
      'select public.ins_active(30)'];
    foreach s in array calls loop
      f := substring(s from 'public\.(ins_[a-z_]+)');
      r := pg_temp.call_as(null, s, true);
      t_name := t_name || ('A anon refused: ' || f); t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = '42501');
      r := pg_temp.call_as(usr, s);
      t_name := t_name || ('A non-admin refused: ' || f); t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = '42501');
      r := pg_temp.call_as(adm, s);
      t_name := t_name || ('A admin allowed: ' || f); t_det := t_det || left(r::text, 200); t_pass := t_pass || (r->>'sqlstate' is null);
    end loop;

    -- grants: authenticated may execute, anon may not, security definer + empty search_path kept
    t_name := t_name || text 'A grants and settings kept on all five functions';
    select string_agg(p.proname || ':' || has_function_privilege('authenticated', p.oid, 'execute') || '/' ||
                      has_function_privilege('anon', p.oid, 'execute') || '/' || p.prosecdef || '/' || coalesce(array_to_string(p.proconfig, ','), ''), ' ')
      into s
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in ('ins_overview', 'ins_products', 'ins_states', 'ins_cross', 'ins_active');
    t_det := t_det || s;
    t_pass := t_pass || (select count(*) = 5 and bool_and(has_function_privilege('authenticated', p.oid, 'execute')
                                                 and not has_function_privilege('anon', p.oid, 'execute')
                                                 and p.prosecdef and p.proconfig = array['search_path=""'])
                         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                         where n.nspname = 'public' and p.proname in ('ins_overview', 'ins_products', 'ins_states', 'ins_cross', 'ins_active'));

    -- ════ B. overview: mqr_full ════
    r := pg_temp.call_as(adm, format('select public.ins_overview(%s, %s)', fr, tt));
    t_name := t_name || text 'B overview: 3 registered, 2 full, 2 MQR, 1 MQR with a full profile';
    t_det := t_det || r::text;
    t_pass := t_pass || ((r->>'registered')::int = 3 and (r->>'full')::int = 2 and (r->>'mqr')::int = 2 and (r->>'mqr_full')::int = 1);

    t_name := t_name || text 'B overview: every 0062 key is still there';
    t_det := t_det || (select string_agg(k, ',' order by k) from jsonb_object_keys(r) k);
    t_pass := t_pass || (r ?& array['visitors', 'attempted', 'registered', 'partial', 'full', 'mqr', 'used_product', 'vsat_early',
                                    'vsat_early_mqr', 'vsat_early_in_period', 'vsat_paid_in_period']);

    t_name := t_name || text 'B overview: MQR % of full profiles can no longer pass 100% (mqr_full <= full)';
    t_det := t_det || format('mqr_full %s, full %s', r->>'mqr_full', r->>'full');
    t_pass := t_pass || ((r->>'mqr_full')::int <= (r->>'full')::int);

    -- ════ C. states: one row per state, labelled with the most common spelling ════
    r := pg_temp.call_as(adm, format('select public.ins_states(%s, %s, ''all'')', fr, tt));
    t_name := t_name || text 'C states: "Goa" x2 + "goa" x1 -> one row "Goa" with 3 people, 2 MQR';
    t_det := t_det || r::text;
    t_pass := t_pass || (jsonb_array_length(r) = 1 and r->0->>'state' = 'Goa' and (r->0->>'users')::int = 3 and (r->0->>'mqr')::int = 2);

    -- ════ D. cross: last product before VSAT ════
    r := pg_temp.call_as(adm, format('select public.ins_cross(%s, %s)', fr, tt));
    t_name := t_name || text 'D cross: before VSAT = PYQ for u1 (CodeSprint, then PYQ), none for u2';
    t_det := t_det || (r->'before_vsat')::text;
    t_pass := t_pass || ((r->'before_vsat') @> '[{"product": "pyq", "users": 1}, {"product": "none", "users": 1}]'::jsonb
                         and jsonb_array_length(r->'before_vsat') = 2);
    t_name := t_name || text 'D cross: cohort 3, 2 VSAT, path CodeSprint -> PYQ';
    t_det := t_det || format('cohort %s vsat %s paths %s', r->>'cohort', r->>'vsat', r->'paths');
    t_pass := t_pass || ((r->>'cohort')::int = 3 and (r->>'vsat')::int = 2
                         and (r->'paths') @> '[{"from": "codesprint", "to": "pyq", "users": 1}]'::jsonb);

    -- ════ E. products and active: same shape as before ════
    r := pg_temp.call_as(adm, format('select public.ins_products(%s, %s)', fr, tt));
    t_name := t_name || text 'E products: 5 rows in order; VSAT 2 users (both MQR)';
    t_det := t_det || left(r::text, 400);
    t_pass := t_pass || ((select string_agg(e->>'product', ',' order by k) from jsonb_array_elements(r) with ordinality x(e, k)) = 'codesprint,bootcamp,pyq,cp,vsat'
                         and (r->4->>'users')::int = 2 and (r->4->>'mqr')::int = 2);
    r := pg_temp.call_as(adm, 'select public.ins_active(30)');
    t_name := t_name || text 'E active: 7 products in order, each with dau/wau/mau and the earlier periods';
    t_det := t_det || left(r::text, 300);
    t_pass := t_pass || ((select string_agg(e->>'product', ',' order by k) from jsonb_array_elements(r->'products') with ordinality x(e, k))
                           = 'site,codesprint,bootcamp,pyq,cp,vsat,peerpath'
                         and (select bool_and(e ?& array['dau', 'dau_prev', 'wau', 'wau_prev', 'mau', 'mau_prev', 'tracked_since'])
                              from jsonb_array_elements(r->'products') e));

    raise exception using errcode = 'ZDONE';
  exception when sqlstate 'ZDONE' then null;
  end;

  return query select x.n, x.p, x.d from unnest(t_name, t_pass, t_det) as x(n, p, d);
end $$;

select * from pg_temp.run_insights_0068_tests();

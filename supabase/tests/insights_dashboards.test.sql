-- Insights dashboards (read-only) · database tests for migration 0062
--
-- How to run (STAGING ONLY): paste this whole file into the staging SQL editor,
-- or run it through the Supabase MCP / psql. The last statement returns one row
-- per test: test | pass | detail.
--
-- Nothing is left behind: all test data is created inside a block that is rolled
-- back with a private error code at the end. Test data is fake only
-- (@example.invalid e-mails, names starting with ZZTEST).
--
-- Logged-in calls are simulated the way PostgREST does it: SET ROLE authenticated
-- (or anon) + request.jwt.claims {"sub": <uid>}. auth.uid() reads that claim.
--
-- The fake users are all created in this one transaction, so their created_at is
-- exactly now(); the period [now(), now() + 1 ms) therefore holds only them.

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

-- ── the tests ──────────────────────────────────────────────────────────────────
create or replace function pg_temp.run_insights_tests()
returns table (test text, pass boolean, detail text) language plpgsql as $$
declare
  t_name text[] := '{}'; t_pass boolean[] := '{}'; t_det text[] := '{}';
  adm uuid; usr uuid; u1 uuid; u2 uuid; u3 uuid;
  r jsonb; s text; f text; before_counts text; after_counts text;
  fr text := quote_literal(now()::text) || '::timestamptz';
  tt text := quote_literal((now() + interval '1 millisecond')::text) || '::timestamptz';
  calls text[];
begin
  begin -- everything below is rolled back at the end (ZDONE)
    adm := pg_temp.mk_user('zztest-ins-admin@example.invalid');
    perform pg_temp.mk_admin(adm);
    usr := pg_temp.mk_user('zztest-ins-user@example.invalid');
    u1 := pg_temp.mk_user('zztest-ins-u1@example.invalid');
    u2 := pg_temp.mk_user('zztest-ins-u2@example.invalid');
    u3 := pg_temp.mk_user('zztest-ins-u3@example.invalid');

    -- the admin and the plain user must not land in the test period: move them back a day
    update public.profiles set created_at = now() - interval '1 day' where id in (adm, usr);

    -- u1: MQR, full profile, source "WhatsApp", state " Bihar ", CodeSprint + College Predictor + VSAT early
    update public.profiles set full_name = 'ZZTEST One', stream = 'PCM', grad_year = 2026, profile_completed = true,
           utm_source = 'WhatsApp', state = ' Bihar ' where id = u1;
    insert into public.cs_enrollments (user_id, enrolled_at) values (u1, now());
    insert into public.cp_predictions (user_id, rank, created_at) values (u1, 1000, now()), (u1, 1200, now());
    insert into public.vsat_registrations (user_id, registered, registered_at, signup_at) values (u1, true, now(), now());
    -- u2: not MQR, partial, source " whatsapp ", state "bihar", College Predictor only
    update public.profiles set full_name = 'ZZTEST Two', stream = 'PCB', grad_year = 2026, profile_completed = false,
           utm_source = ' whatsapp ', state = 'bihar' where id = u2;
    insert into public.cp_predictions (user_id, rank, created_at) values (u2, 5000, now());
    -- u3: no source, no state, no product
    update public.profiles set full_name = 'ZZTEST Three', profile_completed = false, utm_source = null, state = null where id = u3;

    select format('%s/%s/%s/%s/%s', (select count(*) from public.profiles), (select count(*) from public.cs_enrollments),
                  (select count(*) from public.cp_predictions), (select count(*) from public.vsat_registrations),
                  (select count(*) from public.traffic_events)) into before_counts;

    -- ════ A. who may call ════
    calls := array[
      format('select public.ins_overview(%s, %s)', fr, tt),
      format('select public.ins_products(%s, %s)', fr, tt),
      format('select public.ins_sources(%s, %s, ''all'')', fr, tt),
      format('select public.ins_states(%s, %s, ''all'')', fr, tt),
      format('select public.ins_cross(%s, %s)', fr, tt),
      format('select jsonb_agg(x) from public.ins_people(%s, %s) x', fr, tt),
      'select public.ins_active(30)'];
    foreach s in array calls loop
      f := substring(s from 'public\.(ins_[a-z_]+)');
      r := pg_temp.call_as(null, s, true);
      t_name := t_name || ('A anon refused: ' || f); t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' in ('42501'));
      r := pg_temp.call_as(null, s);
      t_name := t_name || ('A logged in without user id refused: ' || f); t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = '42501');
      r := pg_temp.call_as(usr, s);
      t_name := t_name || ('A non-admin refused: ' || f); t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = '42501');
      r := pg_temp.call_as(adm, s);
      t_name := t_name || ('A admin allowed: ' || f); t_det := t_det || left(r::text, 200); t_pass := t_pass || (r->>'sqlstate' is null);
    end loop;

    -- private helpers are not callable by signed-in users
    r := pg_temp.call_as(adm, 'select to_jsonb(count(*)) from public.ins__facts()');
    t_name := t_name || text 'A private helper ins__facts refused even for admin (no direct grant)'; t_det := t_det || r::text;
    t_pass := t_pass || (r->>'sqlstate' = '42501');

    -- ════ B. bad input ════
    r := pg_temp.call_as(adm, format('select public.ins_overview(%s, null)', fr));
    t_name := t_name || text 'B half-open period refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = '22023');
    r := pg_temp.call_as(adm, format('select public.ins_overview(%s, %s)', tt, fr));
    t_name := t_name || text 'B inverted period refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = '22023');
    r := pg_temp.call_as(adm, 'select public.ins_sources(null, null, ''nope'')');
    t_name := t_name || text 'B unknown product refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = '22023');
    r := pg_temp.call_as(adm, 'select jsonb_agg(x) from public.ins_people(null, null, null, null, ''huge'') x');
    t_name := t_name || text 'B unknown level refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = '22023');
    r := pg_temp.call_as(adm, 'select public.ins_active(1000)');
    t_name := t_name || text 'B days out of range refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = '22023');

    -- ════ C. overview funnel ════
    -- (profile_completed is recomputed by a profiles trigger, so "full" is checked against the table itself)
    r := pg_temp.call_as(adm, format('select public.ins_overview(%s, %s)', fr, tt));
    t_name := t_name || text 'C overview: 3 registered, full/partial = profile_completed, 1 MQR, 2 used a product, 1 VSAT early (also MQR)';
    t_det := t_det || r::text;
    t_pass := t_pass || ((r->>'registered')::int = 3
                         and (r->>'full')::int = (select count(*) from public.profiles p where p.id in (u1, u2, u3) and p.profile_completed)
                         and (r->>'partial')::int = (select count(*) from public.profiles p where p.id in (u1, u2, u3) and not p.profile_completed)
                         and (r->>'mqr')::int = 1
                         and (r->>'used_product')::int = 2 and (r->>'vsat_early')::int = 1 and (r->>'vsat_early_mqr')::int = 1
                         and (r->>'vsat_early_in_period')::int = 1);

    -- ════ D. sources are case- and space-insensitive ════
    r := pg_temp.call_as(adm, format('select public.ins_sources(%s, %s, ''all'')', fr, tt));
    t_name := t_name || text 'D "WhatsApp" and " whatsapp " are one source with 2 users; blank source = unknown with 1';
    t_det := t_det || r::text;
    t_pass := t_pass || (exists (select 1 from jsonb_array_elements(r) e where e->>'source' = 'whatsapp' and (e->>'users')::int = 2 and (e->>'mqr')::int = 1)
                         and exists (select 1 from jsonb_array_elements(r) e where e->>'source' = 'unknown' and (e->>'users')::int = 1)
                         and not exists (select 1 from jsonb_array_elements(r) e where e->>'source' <> lower(e->>'source')));
    r := pg_temp.call_as(adm, format('select public.ins_sources(%s, %s, ''cp'')', fr, tt));
    t_name := t_name || text 'D product filter: College Predictor users = 2, all whatsapp, no spend shown';
    t_det := t_det || r::text;
    t_pass := t_pass || (jsonb_array_length(r) = 1 and r#>>'{0,source}' = 'whatsapp' and (r#>>'{0,users}')::int = 2 and r#>'{0,spend_all_time}' = 'null'::jsonb);

    -- ════ E. states ════
    r := pg_temp.call_as(adm, format('select public.ins_states(%s, %s, ''all'')', fr, tt));
    t_name := t_name || text 'E " Bihar " and "bihar" are one state with 2 users; blank = Unknown, listed last';
    t_det := t_det || r::text;
    t_pass := t_pass || (exists (select 1 from jsonb_array_elements(r) e where lower(e->>'state') = 'bihar' and (e->>'users')::int = 2)
                         and r->(jsonb_array_length(r) - 1)->>'state' = 'Unknown');

    -- ════ F. products ════
    r := pg_temp.call_as(adm, format('select public.ins_products(%s, %s)', fr, tt));
    t_name := t_name || text 'F products: CodeSprint 1 (enrolled), College Predictor 2 (1 with 2+ predictions), VSAT 1, Bootcamp 0, PYQ 0';
    t_det := t_det || r::text;
    t_pass := t_pass || (
      (select (e->>'users')::int from jsonb_array_elements(r) e where e->>'product' = 'codesprint') = 1 and
      (select (e->>'step1')::int from jsonb_array_elements(r) e where e->>'product' = 'codesprint') = 1 and
      (select (e->>'users')::int from jsonb_array_elements(r) e where e->>'product' = 'cp') = 2 and
      (select (e->>'step1')::int from jsonb_array_elements(r) e where e->>'product' = 'cp') = 1 and
      (select (e->>'vsat_early')::int from jsonb_array_elements(r) e where e->>'product' = 'cp') = 1 and
      (select (e->>'users')::int from jsonb_array_elements(r) e where e->>'product' = 'vsat') = 1 and
      (select (e->>'users')::int from jsonb_array_elements(r) e where e->>'product' = 'bootcamp') = 0 and
      (select (e->>'users')::int from jsonb_array_elements(r) e where e->>'product' = 'pyq') = 0);

    -- ════ G. cross-product + VSAT link ════
    r := pg_temp.call_as(adm, format('select public.ins_cross(%s, %s)', fr, tt));
    t_name := t_name || text 'G cross: 1 user on 2 products (CodeSprint + College Predictor) and VSAT; 1 on 1; 1 on 0';
    t_det := t_det || r::text;
    t_pass := t_pass || ((r->>'cohort')::int = 3 and (r->>'vsat')::int = 1
      and exists (select 1 from jsonb_array_elements(r->'by_count') e where (e->>'n')::int = 2 and (e->>'users')::int = 1 and (e->>'vsat')::int = 1)
      and exists (select 1 from jsonb_array_elements(r->'by_count') e where (e->>'n')::int = 1 and (e->>'users')::int = 1)
      and exists (select 1 from jsonb_array_elements(r->'by_count') e where (e->>'n')::int = 0 and (e->>'users')::int = 1)
      and exists (select 1 from jsonb_array_elements(r->'pairs') e where e->>'a' = 'codesprint' and e->>'b' = 'cp' and (e->>'users')::int = 1));

    -- ════ H. people drill-down ════
    r := pg_temp.call_as(adm, format('select jsonb_agg(x) from public.ins_people(%s, %s, array[''codesprint'',''cp'']) x', fr, tt));
    t_name := t_name || text 'H people who used CodeSprint AND College Predictor = only ZZTEST One';
    t_det := t_det || left(r::text, 300);
    t_pass := t_pass || (jsonb_array_length(r) = 1 and r#>>'{0,name}' = 'ZZTEST One' and (r#>>'{0,cp,predictions}')::int = 2);
    r := pg_temp.call_as(adm, format('select jsonb_agg(x) from public.ins_people(%s, %s, null, null, null, ''WHATSAPP'', ''BIHAR'', false) x', fr, tt));
    t_name := t_name || text 'H filters: source WHATSAPP + state BIHAR + not VSAT = only ZZTEST Two';
    t_det := t_det || left(r::text, 300);
    t_pass := t_pass || (jsonb_array_length(r) = 1 and r#>>'{0,name}' = 'ZZTEST Two');

    -- ════ I. read-only: nothing changed ════
    select format('%s/%s/%s/%s/%s', (select count(*) from public.profiles), (select count(*) from public.cs_enrollments),
                  (select count(*) from public.cp_predictions), (select count(*) from public.vsat_registrations),
                  (select count(*) from public.traffic_events)) into after_counts;
    t_name := t_name || text 'I row counts unchanged after all calls'; t_det := t_det || (before_counts || ' -> ' || after_counts);
    t_pass := t_pass || (before_counts = after_counts);

    raise exception using errcode = 'ZDONE';
  exception when sqlstate 'ZDONE' then null;
  end;

  return query select x.n, x.p, x.d from unnest(t_name, t_pass, t_det) as x(n, p, d);
end $$;

select * from pg_temp.run_insights_tests();

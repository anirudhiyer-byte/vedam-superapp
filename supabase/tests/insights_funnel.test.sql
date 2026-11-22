-- Insights funnel (read-only) · database tests for migration 0129 (ins_funnel). STAGING ONLY.
--
-- How to run: paste this whole file into the staging SQL editor, or run it through the Supabase MCP.
-- The last statement returns one row per test: test | pass | detail.
-- Everything is created inside a block that is rolled back at the end (ZDONE): nothing stays.
-- Fake data only (@example.invalid e-mails, ZZTEST names, zzfun* sources).
--
-- The fake users are created in this one transaction, so their profiles.created_at is exactly now();
-- the period [now(), now() + 1 ms) holds only them (same trick as insights_dashboards.test.sql).
--
-- Fixture (period = the test window):
--   A  source zzfun_a · CodeSprint + PYQ (2 products) · VSAT early · application: form submitted,
--      exam taken, enrolled · fee paid
--   B  source zzfun_a · CodeSprint (1 product) · application started, form not submitted
--   C  source zzfun_b · College Predictor (1 product) · fee paid, no application row
--   D  source zzfun_b · no product · nothing else
--   E  no source (→ 'unknown') · Bootcamp (1 product)
-- MQR: A and C (PCM, grad year 2026).

create or replace function pg_temp.fn_user(p_email text, p_src text, p_mqr boolean)
returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, aud, role, email_confirmed_at, raw_user_meta_data)
  values (v, p_email, 'authenticated', 'authenticated', now(), '{}'::jsonb);
  insert into public.profiles (id, email, utm_source, stream, grad_year)
  values (v, p_email, p_src, case when p_mqr then 'PCM' else 'PCB' end, case when p_mqr then 2026 else 2030 end)  -- PCB = not an MQR stream
  on conflict (id) do update set email = excluded.email, utm_source = excluded.utm_source,
    stream = excluded.stream, grad_year = excluded.grad_year;
  insert into public.lead_manager (lead_id, registered_email) values (v, p_email) on conflict (lead_id) do nothing;
  return v;
end $$;

create or replace function pg_temp.fn_call(p_uid uuid, p_sql text, p_anon boolean default false)
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

-- one stage row of an answer as "users/mqr/vsat_early/applied/form_submitted/fee_paid/exam_taken/enrolled"
create or replace function pg_temp.fn_stages(r jsonb)
returns text language sql as $$
  select coalesce(format('%s/%s/%s/%s/%s/%s/%s/%s', r->>'users', r->>'mqr', r->>'vsat_early', r->>'applied',
                         r->>'form_submitted', r->>'fee_paid', r->>'exam_taken', r->>'enrolled'), 'missing')
$$;

create or replace function pg_temp.t_0129()
returns table (test text, pass boolean, detail text) language plpgsql as $$
declare
  tn text[] := '{}'; tp boolean[] := '{}'; td text[] := '{}';
  adm uuid; usr uuid; a uuid; b uuid; c uuid; d uuid; e uuid; paper uuid;
  r jsonb; x jsonb; s text; n int; ok boolean;
  fr timestamptz := now(); tt timestamptz := now() + interval '1 millisecond';
  win jsonb;
  prod text;
begin
  begin -- rolled back at the end (ZDONE)
    adm := pg_temp.fn_user('zztest-fun-admin@example.invalid', null, false);
    insert into public.user_roles (user_id, role) values (adm, 'admin');
    usr := pg_temp.fn_user('zztest-fun-user@example.invalid', null, false);
    -- the admin + plain user are in the window too: give them a source that is easy to leave out
    update public.profiles set utm_source = 'zzfun_staff' where id in (adm, usr);

    a := pg_temp.fn_user('zztest-fun-a@example.invalid', 'ZZFUN_A ', true);   -- trailing space + capitals: same source
    b := pg_temp.fn_user('zztest-fun-b@example.invalid', 'zzfun_a', false);
    c := pg_temp.fn_user('zztest-fun-c@example.invalid', 'zzfun-b', true);    -- '-' → '_'
    d := pg_temp.fn_user('zztest-fun-d@example.invalid', 'zzfun_b', false);
    e := pg_temp.fn_user('zztest-fun-e@example.invalid', '', false);          -- blank → unknown

    -- products
    insert into public.cs_enrollments (user_id, enrolled_at) values (a, now()), (b, now());
    select id into paper from public.pyq_papers limit 1;
    insert into public.pyq_attempts (user_id, paper_id, started_at) values (a, paper, now());
    insert into public.cp_predictions (user_id, created_at) values (c, now());
    insert into public.bootcamp_participation (user_id, registered_at) values (e, now());
    insert into public.vsat_registrations (user_id, registered, registered_at) values (a, true, now());

    -- VSAT application steps
    insert into public.application_manager (application_id, lead_id, form_stage_1, exam_given, enrollment_paid_at)
    values ('ZZTEST-FUN-A', a, 'form_submitted', true, now()),
           ('ZZTEST-FUN-B', b, 'form_initiated', false, null);
    -- simulated payments: allowed only with this transaction-local flag AND app_flags.environment = 'staging'
    -- (vsat_payments_guard, same path as scripts/staging/simulate-vsat-payment.sql); refused anywhere else
    perform set_config('vedam.allow_simulated_payments', 'on', true);
    insert into public.vsat_payments (lead_id, paid_at, payment_ref, provider)
    values (a, now(), 'zztest-fun-a', 'simulated'), (c, now(), 'zztest-fun-c', 'simulated');

    win := jsonb_build_object('fr', fr, 'tt', tt);

    -- ── security ──
    r := pg_temp.fn_call(null, format('select public.ins_funnel(%L, %L)', fr, tt), true);
    tn := tn || text 'SEC anon cannot call it'; tp := tp || (r->>'sqlstate' = '42501'); td := td || r::text;
    r := pg_temp.fn_call(usr, format('select public.ins_funnel(%L, %L)', fr, tt));
    tn := tn || text 'SEC a signed-in non-admin is refused'; tp := tp || (r->>'sqlstate' = '42501'); td := td || r::text;
    r := pg_temp.fn_call(adm, format('select public.ins_funnel(%L, null)', fr));
    tn := tn || text 'SEC half a period is refused'; tp := tp || (r->>'message' = 'range_incomplete'); td := td || r::text;
    r := pg_temp.fn_call(adm, format('select public.ins_funnel(%L, %L)', tt, fr));
    tn := tn || text 'SEC to before from is refused'; tp := tp || (r->>'message' = 'range_invalid'); td := td || r::text;
    select count(*) into n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname = 'ins_funnel' and p.prosecdef and p.provolatile = 's'
       and array_to_string(p.proconfig, ',') = 'search_path=""'
       and not has_function_privilege('anon', p.oid, 'execute') and has_function_privilege('authenticated', p.oid, 'execute');
    tn := tn || text 'SEC SECURITY DEFINER, STABLE, empty search_path, authenticated only'; tp := tp || (n = 1); td := td || n::text;

    -- ── the fixture, exactly ──
    r := pg_temp.fn_call(adm, format('select public.ins_funnel(%L, %L)', fr, tt));
    tn := tn || text 'COHORT = the 7 people who signed up in the window'; tp := tp || ((r->>'cohort')::int = 7); td := td || coalesce(r->>'cohort', r::text);

    select x2 into x from jsonb_array_elements(r->'by_source') x2 where x2->>'source' = 'zzfun_a';
    s := pg_temp.fn_stages(x);
    tn := tn || text 'SOURCE zzfun_a (A + B; capitals and spaces folded): users/mqr/early/applied/form/fee/exam/enrolled'; tp := tp || (s = '2/1/1/2/1/1/1/1'); td := td || s;
    select x2 into x from jsonb_array_elements(r->'by_source') x2 where x2->>'source' = 'zzfun_b';
    s := pg_temp.fn_stages(x);
    tn := tn || text 'SOURCE zzfun_b (C + D; "-" folded to "_"): fee paid without an application still counts as paid'; tp := tp || (s = '2/1/0/0/0/1/0/0'); td := td || s;
    select x2 into x from jsonb_array_elements(r->'by_source') x2 where x2->>'source' = 'unknown';
    s := pg_temp.fn_stages(x);
    tn := tn || text 'SOURCE blank source → unknown (E)'; tp := tp || (s = '1/0/0/0/0/0/0/0'); td := td || s;

    s := (select string_agg(format('%s:%s', k->>'n', pg_temp.fn_stages(k)), ' ' order by (k->>'n')::int) from jsonb_array_elements(r->'by_products') k);
    tn := tn || text 'PRODUCTS 0 = D + admin + user · 1 = B, C, E · 2 = A'; tp := tp || (s = '0:3/0/0/0/0/0/0/0 1:3/1/0/1/0/1/0/0 2:1/1/1/1/1/1/1/1'); td := td || s;

    select m into x from jsonb_array_elements(r->'matrix') m where m->>'source' = 'zzfun_a';
    s := format('%s/%s/%s/%s/%s/%s', x->>'all', x->>'codesprint', x->>'bootcamp', x->>'pyq', x->>'cp', x->>'vsat');
    tn := tn || text 'MATRIX zzfun_a: all/codesprint/bootcamp/pyq/cp/vsat'; tp := tp || (s = '2/2/0/1/0/1'); td := td || s;
    select m into x from jsonb_array_elements(r->'matrix') m where m->>'source' = 'zzfun_b';
    s := format('%s/%s/%s/%s/%s/%s', x->>'all', x->>'codesprint', x->>'bootcamp', x->>'pyq', x->>'cp', x->>'vsat');
    tn := tn || text 'MATRIX zzfun_b'; tp := tp || (s = '2/0/0/0/1/0'); td := td || s;
    select m into x from jsonb_array_elements(r->'matrix') m where m->>'source' = 'unknown';
    s := format('%s/%s/%s/%s/%s/%s', x->>'all', x->>'codesprint', x->>'bootcamp', x->>'pyq', x->>'cp', x->>'vsat');
    tn := tn || text 'MATRIX unknown'; tp := tp || (s = '1/0/1/0/0/0'); td := td || s;

    -- ── reconciles with the existing Insights functions (same window, and on all real staging data) ──
    for win in select jsonb_build_object('fr', fr, 'tt', tt) union all select jsonb_build_object('fr', null, 'tt', null) loop
      r := pg_temp.fn_call(adm, format('select public.ins_funnel(%L::timestamptz, %L::timestamptz)', win->>'fr', win->>'tt'));
      foreach prod in array array['all', 'codesprint', 'bootcamp', 'pyq', 'cp', 'vsat'] loop
        x := pg_temp.fn_call(adm, format('select public.ins_sources(%L::timestamptz, %L::timestamptz, %L)', win->>'fr', win->>'tt', prod));
        select count(*) = 0 into ok from (
          select coalesce(o.source, m.source) src from
            (select y->>'source' source, (y->>'users')::int users from jsonb_array_elements(x) y where (y->>'users')::int > 0) o
            full join (select z->>'source' source, (z->>prod)::int users from jsonb_array_elements(r->'matrix') z where (z->>prod)::int > 0) m
              on m.source = o.source
          where o.users is distinct from m.users) diff;
        tn := tn || format('RECONCILE matrix column %s = ins_sources(%s) per source (%s)', prod, prod, case when win->>'fr' is null then 'all time, real data' else 'test window' end);
        tp := tp || ok; td := td || case when ok then 'every source matches' else 'mismatch' end;
      end loop;

      x := pg_temp.fn_call(adm, format('select public.ins_cross(%L::timestamptz, %L::timestamptz)', win->>'fr', win->>'tt'));
      select count(*) = 0 into ok from (
        select 1 from jsonb_array_elements(x->'by_count') o
        full join jsonb_array_elements(r->'by_products') m on (m->>'n')::int = (o->>'n')::int
        where (o->>'users')::int is distinct from (m->>'users')::int or (o->>'vsat')::int is distinct from (m->>'vsat_early')::int) diff;
      tn := tn || format('RECONCILE by_products users + VSAT early = ins_cross by_count (%s)', case when win->>'fr' is null then 'all time, real data' else 'test window' end);
      tp := tp || (ok and (x->>'cohort')::int = (r->>'cohort')::int); td := td || format('cohort %s vs %s', x->>'cohort', r->>'cohort');

      x := pg_temp.fn_call(adm, format('select public.ins_sources(%L::timestamptz, %L::timestamptz, ''all'')', win->>'fr', win->>'tt'));
      select count(*) = 0 into ok from (
        select 1 from (select * from jsonb_array_elements(x) y where (y->>'users')::int > 0) o
        full join jsonb_array_elements(r->'by_source') m on m->>'source' = o.value->>'source'
        where (o.value->>'users')::int is distinct from (m->>'users')::int
           or (o.value->>'mqr')::int is distinct from (m->>'mqr')::int
           or (o.value->>'vsat_early')::int is distinct from (m->>'vsat_early')::int) diff;
      tn := tn || format('RECONCILE by_source users / MQR / VSAT early = ins_sources(all) (%s)', case when win->>'fr' is null then 'all time, real data' else 'test window' end);
      tp := tp || ok; td := td || case when ok then 'every source matches' else 'mismatch' end;

      select bool_and((k->>'mqr')::int <= (k->>'users')::int and (k->>'applied')::int <= (k->>'users')::int
                      and (k->>'form_submitted')::int <= (k->>'applied')::int and (k->>'exam_taken')::int <= (k->>'applied')::int
                      and (k->>'enrolled')::int <= (k->>'applied')::int and (k->>'fee_paid')::int <= (k->>'users')::int)
        into ok from jsonb_array_elements(r->'by_source') k;
      tn := tn || format('SANITY every step ≤ the step it depends on (%s)', case when win->>'fr' is null then 'all time, real data' else 'test window' end);
      tp := tp || coalesce(ok, true); td := td || coalesce(ok::text, 'no rows');
    end loop;

    raise exception 'ZDONE';
  exception when others then
    if sqlerrm <> 'ZDONE' then tn := tn || text 'HARNESS'; tp := tp || false; td := td || sqlerrm; end if;
  end;
  return query select * from unnest(tn, tp, td);
end $$;

select * from pg_temp.t_0129();

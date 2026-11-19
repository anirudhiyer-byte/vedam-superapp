-- Growth → Payment Cohort · tests for migration 0117 (STAGING ONLY)
--
-- How to run: apply 0117 on staging first, then paste this whole file into the staging SQL editor
-- or run it through the Supabase MCP. The last statement returns one row per test: test | pass | detail.
-- Everything is created inside a block that is rolled back at the end (ZDONE): nothing stays.
-- Fake data only (@example.invalid, ZZTEST names), all dated around January 2090 so real rows never mix in.
-- "Today" is passed to the private helper so the default window is fixed; the public function uses the real IST date.
-- It refuses to run unless app_flags.environment = 'staging'.

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

create or replace function pg_temp.rpc(p_fn text, p jsonb)
returns text language sql as $$ select format('select public.%I(%L::jsonb)', p_fn, p::text) $$;

-- one lead registered at p_at (null = no registration date), with an optional first payment at p_paid_at
create or replace function pg_temp.mk_lead(p_tag text, p_at timestamptz, p_paid_at timestamptz default null)
returns uuid language plpgsql as $$
declare v uuid := pg_temp.mk_user('zztest-cohort-' || p_tag || '@example.invalid');
begin
  delete from public.lead_manager where lead_id = v;   -- in case a sign-up trigger already made an empty row
  insert into public.lead_manager (lead_id, registered_name, registered_email, created_at, user_registration_date)
  values (v, 'ZZTEST ' || p_tag, 'zztest-cohort-' || p_tag || '@example.invalid', coalesce(p_at, '2090-01-05 12:00:00+05:30'), p_at);
  if p_paid_at is not null then
    insert into public.vsat_payments (lead_id, paid_at, payment_ref, provider, amount, currency)
    values (v, p_paid_at, 'ZZTEST-COHORT-' || p_tag, 'simulated', 500, 'INR');
  end if;
  return v;
end $$;

-- n of one {p|d|l…, n} entry in a jsonb array
create or replace function pg_temp.n_of(a jsonb, k text, v text, k2 text default null, v2 text default null)
returns int language sql as $$
  select coalesce(sum((x->>'n')::int), 0)::int from jsonb_array_elements(coalesce(a, '[]'::jsonb)) x
   where x->>k = v and (k2 is null or x->>k2 = v2)
$$;
create or replace function pg_temp.sum_n(a jsonb)
returns int language sql as $$ select coalesce(sum((x->>'n')::int), 0)::int from jsonb_array_elements(coalesce(a, '[]'::jsonb)) x $$;

create or replace function pg_temp.run_cohort_tests()
returns table (test text, pass boolean, detail text) language plpgsql as $$
declare
  t_name text[] := '{}'; t_pass boolean[] := '{}'; t_det text[] := '{}';
  adm uuid; staff uuid; l1 uuid; l2 uuid; l3 uuid; l4 uuid; l5 uuid; l6 uuid; l7 uuid; l8 uuid; ghost uuid := gen_random_uuid();
  camp uuid; c_nod uuid; c_long uuid; c_rev uuid; r jsonb; s text;
  win jsonb := '{"from":"2090-01-04","to":"2090-01-10"}'::jsonb;
begin
  begin -- rolled back at the end (ZDONE)
    if coalesce((select value from public.app_flags where key = 'environment'), '') <> 'staging' then
      raise exception 'Refusing to run: this is not the staging database.';
    end if;
    perform set_config('vedam.allow_simulated_payments', 'on', true);
    adm := pg_temp.mk_user('zztest-cohort-admin@example.invalid');
    insert into public.user_roles (user_id, role) values (adm, 'admin');
    staff := pg_temp.mk_user('zztest-cohort-staff@vedam.org');   -- @vedam.org but not an admin

    -- window 4..10 Jan 2090 (IST). paid_on = first payment's IST day; lead_on = registration IST day.
    l1 := pg_temp.mk_lead('l1', '2090-01-05 12:00:00+05:30', '2090-01-05 15:00:00+05:30');   -- cell 5×5 (same day)
    -- (vsat_payments has lead_id as its primary key: one payment per lead, so there is no "2nd payment" case)
    l2 := pg_temp.mk_lead('l2', '2090-01-06 00:00:00+05:30', '2090-01-07 10:00:00+05:30');   -- 00:00 IST is 6 Jan → cell 6×7
    l3 := pg_temp.mk_lead('l3', '2090-01-06 23:59:00+05:30', '2090-01-06 23:59:30+05:30');   -- 23:59 IST still 6 Jan → cell 6×6
    l4 := pg_temp.mk_lead('l4', '2089-12-20 12:00:00+05:30', '2090-01-08 12:00:00+05:30');   -- lead before the window → Before row
    l5 := pg_temp.mk_lead('l5', null, '2090-01-09 12:00:00+05:30');                          -- no registration date → Unknown row
    l6 := pg_temp.mk_lead('l6', '2090-01-20 12:00:00+05:30', '2090-01-09 12:00:00+05:30');   -- lead after the window → After row
    l7 := pg_temp.mk_lead('l7', '2090-01-07 12:00:00+05:30');                                -- lead, no payment
    l8 := pg_temp.mk_lead('l8', '2090-01-04 00:30:00+05:30', '2090-01-15 12:00:00+05:30');   -- paid after the window: not paid here
    insert into public.vsat_payments (lead_id, paid_at, payment_ref, provider, amount, currency)
      values (ghost, '2090-01-08 12:00:00+05:30', 'ZZTEST-COHORT-ghost', 'simulated', 500, 'INR');  -- lead not in lead_manager
    insert into public.vsat_campaigns (name, campaign_start, campaign_end, exam_date) values ('ZZTEST Cohort C', '2090-01-04', '2090-01-10', '2090-01-25') returning id into camp;
    insert into public.vsat_campaigns (name, campaign_start, campaign_end, exam_date) values ('ZZTEST Cohort NoDates', null, null, '2090-01-25') returning id into c_nod;
    insert into public.vsat_campaigns (name, campaign_start, campaign_end, exam_date) values ('ZZTEST Cohort Long', '2090-01-01', '2090-05-01', '2090-05-10') returning id into c_long;
    insert into public.vsat_campaigns (name, campaign_start, campaign_end, exam_date) values ('ZZTEST Cohort Reversed', '2090-01-10', '2090-01-04', '2090-01-25') returning id into c_rev;

    -- ════ A. who may use it ════
    r := pg_temp.call_as(null, pg_temp.rpc('growth_cohort_report', win), true);
    t_name := t_name || text 'A anon is refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = '42501');
    r := pg_temp.call_as(staff, pg_temp.rpc('growth_cohort_report', win));
    t_name := t_name || text 'A a @vedam.org login that is not an admin is refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'FORBIDDEN');
    r := pg_temp.call_as(staff, pg_temp.rpc('growth_cohort_report', jsonb_build_object('campaign_id', camp)));
    t_name := t_name || text 'A a non-admin is refused even with a real campaign id'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'FORBIDDEN');
    r := pg_temp.call_as(adm, 'select public.growth__cohort_data(''{}''::jsonb, ''2090-01-10''::date)');
    t_name := t_name || text 'A the private helper is not callable by a browser role'; t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = '42501');
    r := pg_temp.call_as(adm, 'select to_jsonb(count(*)) from public.vsat_payments');
    t_name := t_name || text 'A the tables stay closed to the browser role (RLS / no grant)'; t_det := t_det || r::text; t_pass := t_pass || (r::text = '0' or r->>'sqlstate' = '42501');
    t_name := t_name || text 'A grants: anon none, authenticated only the public function, helper nobody';
    t_det := t_det || text 'see test';
    t_pass := t_pass || (not has_function_privilege('anon', 'public.growth_cohort_report(jsonb)', 'execute')
                     and has_function_privilege('authenticated', 'public.growth_cohort_report(jsonb)', 'execute')
                     and not has_function_privilege('authenticated', 'public.growth__cohort_data(jsonb, date)', 'execute')
                     and not has_function_privilege('anon', 'public.growth__cohort_data(jsonb, date)', 'execute'));
    -- owner-approved change (security review, 19 Nov): the private helper is SECURITY INVOKER, so a wrong grant later
    -- could not hand out the report; only the public function runs as the owner
    t_name := t_name || text 'A public function SECURITY DEFINER, private helper SECURITY INVOKER, both search_path empty';
    t_det := t_det || text 'see test';
    t_pass := t_pass || ((select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
                           and p.proname = 'growth_cohort_report' and p.prosecdef and p.proconfig @> array['search_path=""']) = 1
                     and (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
                           and p.proname = 'growth__cohort_data' and not p.prosecdef and p.proconfig @> array['search_path=""']) = 1);

    -- ════ B. request checks (public function, as admin) ════
    foreach s in array array[
      '{"from":"2090-01-04","to":"2090-01-10","hack":1}|UNKNOWN_KEY: hack',
      '{"from":"2090-01-04","to":"2090-01-10","role":"admin"}|UNKNOWN_KEY: role',
      '{"from":"2090-01-10","to":"2090-01-04"}|BAD_VALUE: to',
      '{"from":"2090-01-01","to":"2090-05-01"}|BAD_VALUE: range',
      '{"from":"2090-02-30","to":"2090-03-01"}|BAD_VALUE: from',
      '{"from":"1999-01-01","to":"1999-01-05"}|BAD_VALUE: from',
      '{"from":"abc","to":"2090-01-10"}|BAD_VALUE: from',
      '{"to":"2090-01-10"}|REQUIRED: from',
      '{"from":"2090-01-04"}|REQUIRED: to',
      '{"from":5,"to":"2090-01-10"}|BAD_VALUE: from',
      '{"campaign_id":"not-a-uuid"}|BAD_VALUE: campaign_id',
      '{"campaign_id":"00000000-0000-0000-0000-000000000000"}|NOT_FOUND',
      '{"campaign_id":123}|BAD_VALUE: campaign_id',
      '{"campaign_id":{"a":1}}|BAD_VALUE: campaign_id',
      '[]|BAD_REQUEST',
      '"x"|BAD_REQUEST'] loop
      r := pg_temp.call_as(adm, pg_temp.rpc('growth_cohort_report', split_part(s, '|', 1)::jsonb));
      t_name := t_name || ('B ' || split_part(s, '|', 1) || ' → ' || split_part(s, '|', 2)); t_det := t_det || r::text;
      t_pass := t_pass || (r->>'message' = split_part(s, '|', 2));
    end loop;
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_cohort_report', jsonb_build_object('campaign_id', camp, 'from', '2090-01-04', 'to', '2090-01-10')));
    t_name := t_name || text 'B a campaign together with dates is refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'BAD_VALUE: from');
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_cohort_report', jsonb_build_object('campaign_id', c_nod)));
    t_name := t_name || text 'B a campaign without dates is refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'BAD_VALUE: campaign_id');
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_cohort_report', jsonb_build_object('campaign_id', c_long)));
    t_name := t_name || text 'B a campaign window longer than 120 days is refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'BAD_VALUE: range');
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_cohort_report', jsonb_build_object('campaign_id', c_rev)));
    t_name := t_name || text 'B a campaign whose start is after its end is refused (never an empty report)'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'BAD_VALUE: campaign_id');
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_cohort_report', '{"campaign_id":null}'));
    t_name := t_name || text 'B {"campaign_id":null} alone opens the default 30 days'; t_det := t_det || left(r::text, 120);
    t_pass := t_pass || (r->>'source' = 'default' and (r->>'to')::date - (r->>'from')::date = 29);
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_cohort_report', jsonb_build_object('from', repeat('9', 100000), 'to', '2090-01-10')));
    t_name := t_name || text 'B 100 000 characters of text are refused'; t_det := t_det || left(r::text, 120); t_pass := t_pass || (r->>'message' = 'BAD_VALUE: from');
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_cohort_report', '{"from":"2090-01-01","to":"2090-04-30"}'));
    t_name := t_name || text 'B exactly 120 days is allowed'; t_det := t_det || left(r::text, 120); t_pass := t_pass || (r->>'from' = '2090-01-01' and r->>'to' = '2090-04-30');
    r := pg_temp.call_as(adm, 'select public.growth_cohort_report(null::jsonb)');
    t_name := t_name || text 'B a null body opens the default 30 days (IST today − 29 .. today)'; t_det := t_det || left(r::text, 160);
    t_pass := t_pass || ((r->>'to')::date - (r->>'from')::date = 29 and r->>'source' = 'default' and (r->>'to')::date = (now() at time zone 'Asia/Kolkata')::date);
    r := pg_temp.call_as(adm, 'select public.growth_cohort_report()');
    t_name := t_name || text 'B no argument works the same'; t_det := t_det || left(r::text, 120); t_pass := t_pass || (r->>'source' = 'default');

    -- ════ C. numbers (private helper, fixed today) ════
    r := public.growth__cohort_data(win, '2090-01-31');
    t_name := t_name || text 'C range, source, not locked'; t_det := t_det || left(r::text, 200);
    t_pass := t_pass || (r->>'from' = '2090-01-04' and r->>'to' = '2090-01-10' and r->>'source' = 'custom' and r->>'locked' = 'false' and r->'campaign' = 'null'::jsonb);
    t_name := t_name || text 'C leads per IST day (00:30 and 23:59 edges, no-date lead not counted)'; t_det := t_det || (r->'leads')::text;
    t_pass := t_pass || (pg_temp.n_of(r->'leads', 'd', '2090-01-04') = 1 and pg_temp.n_of(r->'leads', 'd', '2090-01-05') = 1
                     and pg_temp.n_of(r->'leads', 'd', '2090-01-06') = 2 and pg_temp.n_of(r->'leads', 'd', '2090-01-07') = 1
                     and pg_temp.sum_n(r->'leads') = 5);
    t_name := t_name || text 'C cells: 5×5 same day, 6×7, 6×6 (23:59 IST edge)'; t_det := t_det || (r->'cells')::text;
    t_pass := t_pass || (pg_temp.n_of(r->'cells', 'l', '2090-01-05', 'p', '2090-01-05') = 1 and pg_temp.n_of(r->'cells', 'l', '2090-01-06', 'p', '2090-01-07') = 1
                     and pg_temp.n_of(r->'cells', 'l', '2090-01-06', 'p', '2090-01-06') = 1 and pg_temp.sum_n(r->'cells') = 3);
    t_name := t_name || text 'C Before row: 1 payment on 8 Jan, 1 earlier lead day'; t_det := t_det || ((r->'before')::text || ' days=' || (r->>'before_days'));
    t_pass := t_pass || (pg_temp.n_of(r->'before', 'p', '2090-01-08') = 1 and pg_temp.sum_n(r->'before') = 1 and (r->>'before_days')::int = 1);
    t_name := t_name || text 'C Unknown row: lead without registration date, paid 9 Jan'; t_det := t_det || (r->'unknown')::text;
    t_pass := t_pass || (pg_temp.n_of(r->'unknown', 'p', '2090-01-09') = 1 and pg_temp.sum_n(r->'unknown') = 1);
    t_name := t_name || text 'C After row: lead registered after the window, paid inside it'; t_det := t_det || ((r->'after')::text || ' days=' || (r->>'after_days'));
    t_pass := t_pass || (pg_temp.n_of(r->'after', 'p', '2090-01-09') = 1 and pg_temp.sum_n(r->'after') = 1 and (r->>'after_days')::int = 1);
    t_name := t_name || text 'C not counted: payment after the window, payment of a lead not in lead_manager';
    t_det := t_det || ('paid=' || (pg_temp.sum_n(r->'cells') + pg_temp.sum_n(r->'before') + pg_temp.sum_n(r->'unknown') + pg_temp.sum_n(r->'after')));
    t_pass := t_pass || (pg_temp.sum_n(r->'cells') + pg_temp.sum_n(r->'before') + pg_temp.sum_n(r->'unknown') + pg_temp.sum_n(r->'after') = 6);
    t_name := t_name || text 'C every bucket together = the paid rule (growth__paid_rows) for the window';
    t_det := t_det || text 'see test';
    t_pass := t_pass || (pg_temp.sum_n(r->'cells') + pg_temp.sum_n(r->'before') + pg_temp.sum_n(r->'unknown') + pg_temp.sum_n(r->'after')
                         = (select count(*) from public.growth__paid_rows('2090-01-04', '2090-01-10')));
    t_name := t_name || text 'C every row total = sum of its cells (per lead day)';
    t_det := t_det || text 'see test';
    t_pass := t_pass || (not exists (
      select 1 from (select x->>'l' l, sum((x->>'n')::int) n from jsonb_array_elements(r->'cells') x group by 1) a
       where a.n <> (select count(*) from public.growth__paid_rows('2090-01-04', '2090-01-10') q where q.lead_on::text = a.l)));
    t_name := t_name || text 'C every cell / day is inside the window; counts are > 0';
    t_det := t_det || text 'see test';
    t_pass := t_pass || (not exists (select 1 from jsonb_array_elements(r->'cells') x
                                    where (x->>'l')::date not between '2090-01-04' and '2090-01-10' or (x->>'p')::date not between '2090-01-04' and '2090-01-10' or (x->>'n')::int <= 0)
                     and not exists (select 1 from jsonb_array_elements(r->'leads') x where (x->>'d')::date not between '2090-01-04' and '2090-01-10'));
    t_name := t_name || text 'C only day counts leave the database (no name / email / phone / id)';
    t_det := t_det || text 'see test';
    t_pass := t_pass || (r::text not like '%@%' and r::text not like '%ZZTEST l%' and r::text not like ('%' || l1::text || '%')
                     and (select array_agg(jk.key order by jk.key) from jsonb_object_keys(r) as jk(key))
                         = array['after','after_days','before','before_days','campaign','cells','from','leads','locked','source','to','today','unknown']);

    -- campaign window (locked)
    r := public.growth__cohort_data(jsonb_build_object('campaign_id', camp), '2090-01-31');
    t_name := t_name || text 'C campaign: its window, locked, name returned, same numbers'; t_det := t_det || left(r::text, 220);
    t_pass := t_pass || (r->>'from' = '2090-01-04' and r->>'to' = '2090-01-10' and r->>'locked' = 'true' and r->>'source' = 'campaign'
                         and r->'campaign'->>'name' = 'ZZTEST Cohort C' and r->'campaign'->>'id' = camp::text
                         and pg_temp.sum_n(r->'cells') = 3 and pg_temp.sum_n(r->'leads') = 5);

    -- default window from p_today
    r := public.growth__cohort_data('{}'::jsonb, '2090-01-10');
    t_name := t_name || text 'C default: today − 29 .. today, source default'; t_det := t_det || left(r::text, 200);
    t_pass := t_pass || (r->>'from' = '2089-12-12' and r->>'to' = '2090-01-10' and r->>'source' = 'default' and r->>'today' = '2090-01-10');
    t_name := t_name || text 'C default: the Dec lead is now inside (no Before row), After still there'; t_det := t_det || left(r::text, 300);
    t_pass := t_pass || (pg_temp.n_of(r->'cells', 'l', '2089-12-20', 'p', '2090-01-08') = 1 and pg_temp.sum_n(r->'before') = 0
                         and pg_temp.sum_n(r->'after') = 1 and pg_temp.n_of(r->'leads', 'd', '2089-12-20') = 1);
    r := public.growth__cohort_data(null, '2090-01-10');
    t_name := t_name || text 'C null body = default'; t_det := t_det || left(r::text, 120); t_pass := t_pass || (r->>'source' = 'default' and r->>'from' = '2089-12-12');

    -- an empty window
    r := public.growth__cohort_data('{"from":"2090-03-01","to":"2090-03-03"}'::jsonb, '2090-03-31');
    t_name := t_name || text 'C empty window: empty lists, never null'; t_det := t_det || r::text;
    t_pass := t_pass || (r->'leads' = '[]'::jsonb and r->'cells' = '[]'::jsonb and r->'before' = '[]'::jsonb and r->'unknown' = '[]'::jsonb
                         and r->'after' = '[]'::jsonb and (r->>'before_days')::int = 0 and (r->>'after_days')::int = 0);

    -- nothing was written
    t_name := t_name || text 'D reading changes no data';
    t_det := t_det || text 'see test';
    t_pass := t_pass || ((select count(*) from public.vsat_payments where payment_ref like 'ZZTEST-COHORT-%') = 8);

    raise exception using errcode = 'ZDONE';
  exception when sqlstate 'ZDONE' then null;
  end;
  return query select * from unnest(t_name, t_pass, t_det);
end $$;

select * from pg_temp.run_cohort_tests();

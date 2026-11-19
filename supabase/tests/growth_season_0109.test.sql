-- Growth → Season Dashboard · tests for migration 0109 (STAGING ONLY)
--
-- 0109: the Paid card counts only payments whose lead exists in lead_manager, so the card equals its list.
-- How to run: apply 0109 on staging, then paste this whole file into the staging SQL editor (or the Supabase MCP).
-- The last statement returns one row per test: test | pass | detail. Everything is rolled back at the end (ZDONE).
-- Fake data only (@example.invalid, ZZTEST names), dated 2090. Refuses to run unless app_flags.environment = 'staging'.

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

create or replace function pg_temp.run_season_0109_tests()
returns table (test text, pass boolean, detail text) language plpgsql as $$
declare
  t_name text[] := '{}'; t_pass boolean[] := '{}'; t_det text[] := '{}';
  adm uuid; l1 uuid; l2 uuid; ghost uuid := gen_random_uuid(); e1 uuid; camp uuid; r jsonb; d jsonb; k text;
  jan jsonb := '{"from":"2090-01-01","to":"2090-01-31"}'::jsonb;
begin
  begin -- rolled back at the end (ZDONE)
    if coalesce((select value from public.app_flags where key = 'environment'), '') <> 'staging' then
      raise exception 'Refusing to run: this is not the staging database.';
    end if;
    adm := pg_temp.mk_user('zztest-s109-admin@example.invalid');
    insert into public.user_roles (user_id, role) values (adm, 'admin');
    l1 := pg_temp.mk_user('zztest-s109-l1@example.invalid'); l2 := pg_temp.mk_user('zztest-s109-l2@example.invalid');
    delete from public.lead_manager where lead_id in (l1, l2);
    insert into public.lead_manager (lead_id, registered_name, registered_email, created_at) values
      (l1, 'ZZTEST S109 One', 'zzs1@example.invalid', '2090-01-05 12:00:00+05:30'),
      (l2, 'ZZTEST S109 Two', 'zzs2@example.invalid', '2090-01-06 12:00:00+05:30');
    -- like real rows (both default to now() on sign-up): the registration date equals created_at.
    -- Needed since 0121: leads are counted by their registration day.
    update public.lead_manager set user_registration_date = created_at where lead_id in (l1, l2);
    insert into public.vsat_exam_dates (label, wheebox_test_id, exam_date, start_at, end_at) values
      ('ZZTEST S109 E1', 'ZZTEST-S109-1', '2090-03-01', '2090-03-01 10:00:00+05:30', '2090-03-01 12:00:00+05:30') returning id into e1;
    insert into public.vsat_campaigns (name, campaign_start, campaign_end, exam_date) values ('ZZTEST S109 C', '2090-01-01', '2090-01-31', '2090-03-01') returning id into camp;
    insert into public.application_manager (application_id, lead_id, application_no, registered_name, exam_date_id, enrollment_stage, enrollment_paid_at, last_updated_date) values
      ('ZZTEST-S109-APP-1', l1, 'ZZS109A1', 'ZZTEST S109 One', e1, 'approved', '2090-01-20 12:00:00+05:30', '2090-01-20 12:00:00+05:30');
    perform set_config('vedam.allow_simulated_payments', 'on', true);
    insert into public.vsat_payments (lead_id, paid_at, payment_ref, provider, amount, currency) values
      (l1,    '2090-01-12 12:00:00+05:30', 'ZZTEST-S109-PAY-1',     'simulated', 500, 'INR'),
      (ghost, '2090-01-13 12:00:00+05:30', 'ZZTEST-S109-PAY-GHOST', 'simulated', 500, 'INR');   -- lead not in lead_manager

    -- ════ the fix ════
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_season_counts', jan));
    t_name := t_name || text 'Paid ignores a payment whose lead is not in lead_manager (dates)'; t_det := t_det || r::text;
    t_pass := t_pass || ((r->>'paid')::int = (select count(*) from public.vsat_payments v join public.lead_manager lm on lm.lead_id = v.lead_id
                                                   where v.paid_at >= '2090-01-01 00:00:00+05:30' and v.paid_at < '2090-02-01 00:00:00+05:30'));
    t_name := t_name || text 'Paid still counts the real paid lead (1)'; t_det := t_det || r::text; t_pass := t_pass || ((r->>'paid')::int = 1);

    foreach k in array array['leads', 'paid', 'enrolled'] loop
      d := pg_temp.call_as(adm, pg_temp.rpc('growth_season_drill', jsonb_build_object('kind', k, 'from', '2090-01-01', 'to', '2090-01-31')));
      t_name := t_name || ('Card equals list total: ' || k); t_det := t_det || (r->>k || ' vs ' || coalesce(d->>'total', d::text));
      t_pass := t_pass || ((r->>k)::int = (d->>'total')::int);
    end loop;

    r := pg_temp.call_as(adm, pg_temp.rpc('growth_season_counts', jsonb_build_object('campaign_id', camp)));
    d := pg_temp.call_as(adm, pg_temp.rpc('growth_season_drill', jsonb_build_object('kind', 'paid', 'campaign_id', camp)));
    t_name := t_name || text 'Campaign mode: Paid = 1 and equals its list'; t_det := t_det || (r::text || ' / ' || coalesce(d->>'total', d::text));
    t_pass := t_pass || ((r->>'paid')::int = 1 and (d->>'total')::int = 1);
    t_name := t_name || text 'Campaign mode: Leads and Enrolments unchanged (2 / 1)'; t_det := t_det || r::text;
    t_pass := t_pass || ((r->>'leads')::int = 2 and (r->>'enrolled')::int = 1);

    -- ════ nothing else changed ════
    r := pg_temp.call_as(adm, 'select to_jsonb(count(*)) from public.growth__season_ids(''paid'', ''2090-01-01'', ''2090-01-31'', null)');
    t_name := t_name || text 'growth__season_ids is still not callable by a browser role'; t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = '42501');
    t_name := t_name || text 'growth__season_ids is still SECURITY DEFINER with search_path empty';
    t_det := t_det || (select p.prosecdef::text || ' ' || coalesce(p.proconfig::text, 'null') from pg_proc p where p.oid = 'public.growth__season_ids(text, date, date, date)'::regprocedure);
    t_pass := t_pass || (select p.prosecdef and p.proconfig = array['search_path=""'] from pg_proc p where p.oid = 'public.growth__season_ids(text, date, date, date)'::regprocedure);
    t_name := t_name || text 'The ghost payment is still stored (write-once table untouched)';
    t_det := t_det || text 'ZZTEST-S109-PAY-GHOST'; t_pass := t_pass || exists (select 1 from public.vsat_payments where payment_ref = 'ZZTEST-S109-PAY-GHOST');

    raise exception using errcode = 'ZDONE';
  exception when sqlstate 'ZDONE' then null;
  end;
  return query select * from unnest(t_name, t_pass, t_det);
end $$;

select * from pg_temp.run_season_0109_tests();

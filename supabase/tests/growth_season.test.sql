-- Growth → Season Dashboard · tests for migrations 0108–0110 (STAGING ONLY; 0110 = the CRM's list columns)
--
-- How to run: apply 0108 on staging first, then paste this whole file into the staging SQL editor
-- or run it through the Supabase MCP. The last statement returns one row per test: test | pass | detail.
-- Everything is created inside a block that is rolled back at the end (ZDONE): nothing stays.
-- Fake data only (@example.invalid, ZZTEST names), all dated in the year 2090 so real rows never mix in.
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

create or replace function pg_temp.run_season_tests()
returns table (test text, pass boolean, detail text) language plpgsql as $$
declare
  t_name text[] := '{}'; t_pass boolean[] := '{}'; t_det text[] := '{}';
  adm uuid; staff uuid; r jsonb; r2 jsonb; e1 uuid; e2 uuid; camp uuid; ids text[];
  l1 uuid; l2 uuid; l3 uuid; l4 uuid; l5 uuid; l6 uuid;
  jan jsonb := '{"from":"2090-01-01","to":"2090-01-31"}'::jsonb;
begin
  begin -- rolled back at the end (ZDONE)
    if coalesce((select value from public.app_flags where key = 'environment'), '') <> 'staging' then
      raise exception 'Refusing to run: this is not the staging database.';
    end if;
    adm := pg_temp.mk_user('zztest-season-admin@example.invalid');
    insert into public.user_roles (user_id, role) values (adm, 'admin');
    staff := pg_temp.mk_user('zztest-season-staff@vedam.org');   -- @vedam.org but not an admin

    -- ── fake data ── (a lead is a profile: lead_manager.lead_id → profiles.id)
    l1 := pg_temp.mk_user('zztest-season-l1@example.invalid'); l2 := pg_temp.mk_user('zztest-season-l2@example.invalid');
    l3 := pg_temp.mk_user('zztest-season-l3@example.invalid'); l4 := pg_temp.mk_user('zztest-season-l4@example.invalid');
    l5 := pg_temp.mk_user('zztest-season-l5@example.invalid'); l6 := pg_temp.mk_user('zztest-season-l6@example.invalid');
    delete from public.lead_manager where lead_id in (l1, l2, l3, l4, l5, l6);   -- in case a signup trigger already made empty rows
    -- IST dates: l1 Jan 5 · l2 Jan 10 · l3 Jan 20 · l6 Jan 1 00:00 IST (UTC date is Dec 31) · l4 Feb 15 · l5 Feb 1 00:30 IST (UTC date is Jan 31)
    insert into public.lead_manager (lead_id, registered_name, registered_email, city, state, campus_preference, passing_year, utm_source, created_at) values
      (l1, 'ZZTEST Asha',   'zz1@example.invalid', 'Pune',  'MH', 'Pune',  2026, 'zzmeta',   '2090-01-05 12:00:00+05:30'),
      (l2, 'ZZTEST Ravi',   'zz2@example.invalid', 'Delhi', 'DL', 'Delhi', 2025, 'zzgoogle', '2090-01-10 12:00:00+05:30'),
      (l3, 'ZZTEST Meena',  'zz3@example.invalid', 'Pune',  'MH', 'Pune',  2027, 'zzmeta',   '2090-01-20 12:00:00+05:30'),
      (l6, 'ZZTEST Zoya',   'zz6@example.invalid', 'Agra',  'UP', 'Agra',  null, 'zzgoogle', '2090-01-01 00:00:00+05:30'),
      (l4, 'ZZTEST Outside','zz4@example.invalid', 'Pune',  'MH', 'Pune',  null, 'zzmeta',   '2090-02-15 12:00:00+05:30'),
      (l5, 'ZZTEST Late',   'zz5@example.invalid', 'Pune',  'MH', 'Pune',  2026, 'zzmeta',   '2090-02-01 00:30:00+05:30');
    -- like real rows (both default to now() on sign-up): the sign-up time shown in the list equals created_at
    update public.lead_manager set user_registration_date = created_at where lead_id in (l1, l2, l3, l4, l5, l6);
    insert into public.vsat_exam_dates (label, wheebox_test_id, exam_date, start_at, end_at) values
      ('ZZTEST E1', 'ZZTEST-1', '2090-03-01', '2090-03-01 10:00:00+05:30', '2090-03-01 12:00:00+05:30') returning id into e1;
    insert into public.vsat_exam_dates (label, wheebox_test_id, exam_date, start_at, end_at) values
      ('ZZTEST E2', 'ZZTEST-2', '2090-04-01', '2090-04-01 10:00:00+05:30', '2090-04-01 12:00:00+05:30') returning id into e2;
    insert into public.vsat_campaigns (name, campaign_start, campaign_end, exam_date) values ('ZZTEST Season C', '2090-01-01', '2090-01-31', '2090-03-01') returning id into camp;
    perform set_config('vedam.allow_simulated_payments', 'on', true);
    insert into public.vsat_payments (lead_id, paid_at, payment_ref, provider, amount, currency) values
      (l1, '2090-01-12 12:00:00+05:30', 'ZZTEST-PAY-1', 'simulated', 500, 'INR'),
      (l2, '2090-01-25 12:00:00+05:30', 'ZZTEST-PAY-2', 'simulated', 500, 'INR'),
      (l4, '2090-01-15 12:00:00+05:30', 'ZZTEST-PAY-4', 'simulated', 500, 'INR');   -- lead arrived in Feb, paid in Jan
    insert into public.application_manager (application_id, lead_id, application_no, registered_name, exam_date_id, enrollment_stage) values
      ('ZZTEST-APP-1', l1, 'ZZAPP1', 'ZZTEST Asha',  e1, 'approved'),
      ('ZZTEST-APP-2', l2, 'ZZAPP2', 'ZZTEST Ravi',  e1, 'approved'),
      ('ZZTEST-APP-3', l3, 'ZZAPP3', 'ZZTEST Meena', e2, 'not_initiated');
    update public.application_manager set enrollment_paid_at = '2090-01-28 12:00:00+05:30', last_updated_date = '2090-01-28 12:00:00+05:30' where application_id = 'ZZTEST-APP-1';
    update public.application_manager set enrollment_paid_at = null,                          last_updated_date = '2090-01-29 12:00:00+05:30' where application_id = 'ZZTEST-APP-2';

    -- ════ A. who may use it ════
    r := pg_temp.call_as(null, pg_temp.rpc('growth_season_counts', jan), true);
    t_name := t_name || text 'A anon cannot read the cards'; t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = '42501');
    r := pg_temp.call_as(null, pg_temp.rpc('growth_season_drill', '{"kind":"leads","from":"2090-01-01","to":"2090-01-31"}'), true);
    t_name := t_name || text 'A anon cannot read the list'; t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = '42501');
    r := pg_temp.call_as(staff, pg_temp.rpc('growth_season_counts', jan));
    t_name := t_name || text 'A a @vedam.org login that is not an admin is refused (cards)'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'FORBIDDEN');
    r := pg_temp.call_as(staff, pg_temp.rpc('growth_season_drill', '{"kind":"leads","from":"2090-01-01","to":"2090-01-31"}'));
    t_name := t_name || text 'A a non-admin is refused (list)'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'FORBIDDEN');
    r := pg_temp.call_as(adm, 'select to_jsonb(count(*)) from public.growth__season_ids(''leads'', ''2090-01-01'', ''2090-01-31'', null)');
    t_name := t_name || text 'A private helper growth__season_ids is not callable by a browser role'; t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = '42501');
    r := pg_temp.call_as(adm, 'select to_jsonb(count(*)) from public.growth__season_rows(''leads'', ''2090-01-01'', ''2090-01-31'', null)');
    t_name := t_name || text 'A private helper growth__season_rows is not callable by a browser role'; t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = '42501');
    t_name := t_name || text 'A grants: anon none, authenticated only the two public functions';
    t_det := t_det || text 'see test';
    t_pass := t_pass || (not has_function_privilege('anon', 'public.growth_season_counts(jsonb)', 'execute')
                     and not has_function_privilege('anon', 'public.growth_season_drill(jsonb)', 'execute')
                     and has_function_privilege('authenticated', 'public.growth_season_counts(jsonb)', 'execute')
                     and has_function_privilege('authenticated', 'public.growth_season_drill(jsonb)', 'execute')
                     and not has_function_privilege('authenticated', 'public.growth__season_window(jsonb)', 'execute')
                     and not has_function_privilege('authenticated', 'public.growth__season_cols(text)', 'execute')
                     and not has_function_privilege('authenticated', 'public.growth__like_esc(text)', 'execute'));
    t_name := t_name || text 'A the 5 SECURITY DEFINER functions all have search_path empty (the 2 pure helpers are not definer)';
    t_det := t_det || text 'see test';
    t_pass := t_pass || ((select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
                           and p.proname in ('growth_season_counts','growth_season_drill','growth__season_window','growth__season_ids','growth__season_rows')
                           and p.prosecdef and p.proconfig @> array['search_path=""']) = 5);
    r := pg_temp.call_as(adm, 'select to_jsonb(count(*)) from public.lead_manager');
    t_name := t_name || text 'A the tables stay closed to the browser role (RLS / no grant)'; t_det := t_det || r::text; t_pass := t_pass || (r::text = '0' or r->>'sqlstate' = '42501');

    -- ════ B. the three cards (IST dates) ════
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_season_counts', jan));
    t_name := t_name || text 'B January: 4 leads (IST: Jan 1 00:00 counts, Feb 1 00:30 does not), 3 paid (by paid date), 2 enrolled (fallback date used)';
    t_det := t_det || r::text; t_pass := t_pass || ((r->>'leads')::int = 4 and (r->>'paid')::int = 3 and (r->>'enrolled')::int = 2 and r->>'locked' = 'false');
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_season_counts', '{"from":"2090-02-01","to":"2090-02-01"}'));
    t_name := t_name || text 'B a one-day range uses the IST day (the 00:30 IST lead is on Feb 1)'; t_det := t_det || r::text; t_pass := t_pass || ((r->>'leads')::int = 1 and (r->>'paid')::int = 0);
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_season_counts', '{"from":"2000-01-01","to":"2100-12-31"}'));
    t_name := t_name || text 'B a very wide range works and includes the fake leads'; t_det := t_det || r::text; t_pass := t_pass || ((r->>'leads')::int >= 6 and (r->>'paid')::int >= 3);

    -- ════ C. campaign = locked window + exam date ════
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_season_counts', jsonb_build_object('campaign_id', camp)));
    t_name := t_name || text 'C campaign: leads in its window (4), paid and enrolled on its exam date (2 and 2), window locked, name returned';
    t_det := t_det || r::text;
    t_pass := t_pass || ((r->>'leads')::int = 4 and (r->>'paid')::int = 2 and (r->>'enrolled')::int = 2 and r->>'locked' = 'true'
                         and r->>'campaign' = 'ZZTEST Season C' and r->>'from' = '2090-01-01' and r->>'to' = '2090-01-31');
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_season_counts', jsonb_build_object('campaign_id', camp, 'from', '2090-01-01')));
    t_name := t_name || text 'C a campaign together with dates is refused (the campaign locks the window)'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'BAD_VALUE: from');
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_season_counts', jsonb_build_object('campaign_id', gen_random_uuid())));
    t_name := t_name || text 'C an unknown campaign is NOT_FOUND'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'NOT_FOUND');
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_season_counts', '{"campaign_id":"not-a-uuid"}'));
    t_name := t_name || text 'C a malformed campaign id is BAD_VALUE'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'BAD_VALUE: campaign_id');

    -- ════ D. request checks ════
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_season_counts', '{"from":"2090-02-01","to":"2090-01-01"}'));
    t_name := t_name || text 'D From after To is refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'BAD_VALUE: to');
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_season_counts', '{"to":"2090-01-01"}'));
    t_name := t_name || text 'D missing From is REQUIRED'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'REQUIRED: from');
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_season_counts', '{"from":"2090-01-01"}'));
    t_name := t_name || text 'D missing To is REQUIRED'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'REQUIRED: to');
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_season_counts', '{"from":"2090-02-30","to":"2090-03-01"}'));
    t_name := t_name || text 'D an impossible date is BAD_VALUE'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'BAD_VALUE: from');
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_season_counts', '{"from":"1999-01-01","to":"2090-03-01"}'));
    t_name := t_name || text 'D a year outside 2000–2100 is BAD_VALUE'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'BAD_VALUE: from');
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_season_counts', '{"from":"2090-01-01","to":"2090-01-31","hack":1}'));
    t_name := t_name || text 'D unknown keys are refused (cards)'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'UNKNOWN_KEY: hack');
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_season_drill', '{"kind":"leads","from":"2090-01-01","to":"2090-01-31","hack":1}'));
    t_name := t_name || text 'D unknown keys are refused (list)'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'UNKNOWN_KEY: hack');
    r := pg_temp.call_as(adm, 'select public.growth_season_counts(''[]''::jsonb)');
    t_name := t_name || text 'D a request that is not an object is refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'BAD_REQUEST');
    r := pg_temp.call_as(adm, 'select public.growth_season_counts(null::jsonb)');
    t_name := t_name || text 'D a null request is refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'BAD_REQUEST');
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_season_drill', '{"from":"2090-01-01","to":"2090-01-31"}'));
    t_name := t_name || text 'D the list needs a kind'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'REQUIRED: kind');
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_season_drill', '{"kind":"everything","from":"2090-01-01","to":"2090-01-31"}'));
    t_name := t_name || text 'D an unknown kind is BAD_VALUE'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'BAD_VALUE: kind');

    -- ════ E. the card number and the list always agree ════
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_season_drill', jan || '{"kind":"leads"}'));
    r2 := pg_temp.call_as(adm, pg_temp.rpc('growth_season_counts', jan));
    t_name := t_name || text 'E leads: list total = card, 4 rows'; t_det := t_det || left(r::text, 120);
    t_pass := t_pass || ((r->>'total')::int = (r2->>'leads')::int and jsonb_array_length(r->'rows') = 4);
    t_name := t_name || text 'E leads rows carry exactly the 22 CRM columns';
    t_det := t_det || (select string_agg(k, ',') from jsonb_object_keys(r->'rows'->0) k);
    t_pass := t_pass || ((select array_agg(k order by k) from jsonb_object_keys(r->'rows'->0) k) = (select array_agg(c order by c) from unnest(public.growth__season_cols('leads')) c));
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_season_drill', jan || '{"kind":"paid"}'));
    t_name := t_name || text 'E paid: list total = card (3); rows carry exactly the 41 CRM columns'; t_det := t_det || left(r::text, 120);
    t_pass := t_pass || ((r->>'total')::int = (r2->>'paid')::int and jsonb_array_length(r->'rows') = 3
                         and (select array_agg(k order by k) from jsonb_object_keys(r->'rows'->0) k) = (select array_agg(c order by c) from unnest(public.growth__season_cols('paid')) c));
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_season_drill', jan || '{"kind":"enrolled"}'));
    t_name := t_name || text 'E enrolled: list total = card (2)'; t_det := t_det || left(r::text, 120);
    t_pass := t_pass || ((r->>'total')::int = (r2->>'enrolled')::int and jsonb_array_length(r->'rows') = 2);
    r2 := pg_temp.call_as(adm, pg_temp.rpc('growth_season_counts', jsonb_build_object('campaign_id', camp)));
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_season_drill', jsonb_build_object('kind', 'paid', 'campaign_id', camp)));
    t_name := t_name || text 'E campaign mode: list total = card too (paid 2)'; t_det := t_det || left(r::text, 120);
    t_pass := t_pass || ((r->>'total')::int = (r2->>'paid')::int and (r->>'total')::int = 2);
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_season_drill', jan || '{"kind":"paid"}'));
    t_name := t_name || text 'E a paid row has the payment, the exam date and the enrolment (IST times)';
    t_det := t_det || (select x::text from jsonb_array_elements(r->'rows') x where x->>'registered_email' = 'zz1@example.invalid');
    t_pass := t_pass || (exists (select 1 from jsonb_array_elements(r->'rows') x
                          where x->>'registered_email' = 'zz1@example.invalid' and x->>'payment_approved_date' = '2090-01-12T12:00:00' and x->>'exam_date' = '2090-03-01'
                            and x->>'exam_slot' = '10:00–12:00' and x->>'seat_booking_amount_date' = '2090-01-28T12:00:00' and (x->>'payment_amount')::numeric = 500
                            and x->>'application_no' = 'ZZAPP1'));
    t_name := t_name || text 'E a paid lead with no application still shows (name and email from the lead)';
    t_det := t_det || (select x::text from jsonb_array_elements(r->'rows') x where x->>'registered_email' = 'zz4@example.invalid');
    t_pass := t_pass || (exists (select 1 from jsonb_array_elements(r->'rows') x where x->>'registered_email' = 'zz4@example.invalid' and x->>'registered_name' = 'ZZTEST Outside' and x->>'application_no' is null));

    -- ════ F. search: comma = many, ! = exclude, text is only ever a value ════
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_season_drill', jan || '{"kind":"leads","search":"pune"}'));
    t_name := t_name || text 'F search "pune" → 2'; t_det := t_det || (r->>'total'); t_pass := t_pass || ((r->>'total')::int = 2);
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_season_drill', jan || '{"kind":"leads","search":"pune, delhi"}'));
    t_name := t_name || text 'F search "pune, delhi" → 3 (any term)'; t_det := t_det || (r->>'total'); t_pass := t_pass || ((r->>'total')::int = 3);
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_season_drill', jan || '{"kind":"leads","search":"!pune"}'));
    t_name := t_name || text 'F search "!pune" → 2 (everything except pune)'; t_det := t_det || (r->>'total'); t_pass := t_pass || ((r->>'total')::int = 2);
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_season_drill', jan || '{"kind":"leads","search":"zztest, !asha"}'));
    t_name := t_name || text 'F search "zztest, !asha" → 3'; t_det := t_det || (r->>'total'); t_pass := t_pass || ((r->>'total')::int = 3);
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_season_drill', jan || '{"kind":"leads","search":"ZZ1@EXAMPLE.invalid"}'));
    t_name := t_name || text 'F search is not case sensitive and finds an email'; t_det := t_det || (r->>'total'); t_pass := t_pass || ((r->>'total')::int = 1);
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_season_drill', jan || '{"kind":"leads","search":"%"}'));
    t_name := t_name || text 'F "%" is a plain character, not a wildcard (0 rows)'; t_det := t_det || (r->>'total'); t_pass := t_pass || ((r->>'total')::int = 0);
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_season_drill', jan || '{"kind":"leads","search":"_"}'));
    t_name := t_name || text 'F "_" is a plain character, not a wildcard (0 rows)'; t_det := t_det || (r->>'total'); t_pass := t_pass || ((r->>'total')::int = 0);
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_season_drill', jan || jsonb_build_object('kind', 'leads', 'search', '''; drop table public.lead_manager; --')));
    t_name := t_name || text 'F SQL text in the search finds nothing and drops nothing'; t_det := t_det || (r->>'total');
    t_pass := t_pass || ((r->>'total')::int = 0 and to_regclass('public.lead_manager') is not null);
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_season_drill', jan || jsonb_build_object('kind', 'leads', 'search', repeat('a', 601))));
    t_name := t_name || text 'F a search over 600 characters is refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'BAD_VALUE: search');

    -- ════ G. column filters ════
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_season_drill', jan || '{"kind":"leads","filters":{"campus_preference":"pune"}}'));
    t_name := t_name || text 'G filter campus_preference "pune" → 2'; t_det := t_det || (r->>'total'); t_pass := t_pass || ((r->>'total')::int = 2);
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_season_drill', jan || '{"kind":"leads","filters":{"campus_preference":"pune","registered_name":"asha"}}'));
    t_name := t_name || text 'G two filters must both match → 1'; t_det := t_det || (r->>'total'); t_pass := t_pass || ((r->>'total')::int = 1);
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_season_drill', jan || '{"kind":"leads","search":"zztest","filters":{"campaign_source":"zzmeta"}}'));
    t_name := t_name || text 'G search and filter work together → 2'; t_det := t_det || (r->>'total'); t_pass := t_pass || ((r->>'total')::int = 2);
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_season_drill', jan || '{"kind":"leads","filters":{"password":"x"}}'));
    t_name := t_name || text 'G a column that is not in the list is refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'BAD_VALUE: filters');
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_season_drill', jan || '{"kind":"leads","filters":{"payment_amount":"x"}}'));
    t_name := t_name || text 'G a column of another kind is refused (payment_amount is not a leads column)'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'BAD_VALUE: filters');
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_season_drill', jan || '{"kind":"leads","filters":{"campus_preference":5}}'));
    t_name := t_name || text 'G a filter value that is not text is refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'BAD_VALUE: filters');
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_season_drill', jan || jsonb_build_object('kind', 'leads', 'filters', jsonb_build_object('campus_preference', repeat('a', 101)))));
    t_name := t_name || text 'G a filter value over 100 characters is refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'BAD_VALUE: filters');
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_season_drill', jan || '{"kind":"leads","filters":[1]}'));
    t_name := t_name || text 'G filters that are not an object are refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'BAD_VALUE: filters');

    -- ════ H. sort ════
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_season_drill', jan || '{"kind":"leads","sort":{"col":"registered_name","dir":"asc"}}'));
    t_name := t_name || text 'H name ascending starts with Asha'; t_det := t_det || (r->'rows'->0->>'registered_name'); t_pass := t_pass || (r->'rows'->0->>'registered_name' = 'ZZTEST Asha');
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_season_drill', jan || '{"kind":"leads","sort":{"col":"registered_name","dir":"desc"}}'));
    t_name := t_name || text 'H name descending starts with Zoya'; t_det := t_det || (r->'rows'->0->>'registered_name'); t_pass := t_pass || (r->'rows'->0->>'registered_name' = 'ZZTEST Zoya');
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_season_drill', jan || '{"kind":"paid","sort":{"col":"year_of_passing_class_12th","dir":"desc"}}'));
    t_name := t_name || text 'H numbers sort as numbers (2026 first) and an empty value goes last (paid list, year_of_passing_class_12th)';
    t_det := t_det || (coalesce(r->'rows'->0->>'year_of_passing_class_12th', 'null') || ' / ' || coalesce(r->'rows'->2->>'year_of_passing_class_12th', 'null'));
    t_pass := t_pass || ((r->'rows'->0->>'year_of_passing_class_12th') = '2026' and jsonb_typeof(r->'rows'->0->'year_of_passing_class_12th') = 'number' and (r->'rows'->2->>'year_of_passing_class_12th') is null);
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_season_drill', jan || '{"kind":"paid","sort":{"col":"year_of_passing_class_12th","dir":"asc"}}'));
    t_name := t_name || text 'H ascending: 2025 first, the empty value still last'; t_det := t_det || (r->'rows'->0->>'year_of_passing_class_12th');
    t_pass := t_pass || ((r->'rows'->0->>'year_of_passing_class_12th') = '2025' and (r->'rows'->2->>'year_of_passing_class_12th') is null);
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_season_drill', jan || '{"kind":"leads"}'));
    t_name := t_name || text 'H default order is newest lead first by user_registration_date (Jan 20 before Jan 1)'; t_det := t_det || (r->'rows'->0->>'user_registration_date');
    t_pass := t_pass || ((r->'rows'->0->>'user_registration_date') = '2090-01-20T12:00:00' and (r->'rows'->3->>'user_registration_date') = '2090-01-01T00:00:00');
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_season_drill', jan || '{"kind":"leads","sort":{"col":"password","dir":"asc"}}'));
    t_name := t_name || text 'H a sort column that is not in the list is refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'BAD_VALUE: sort');
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_season_drill', jan || '{"kind":"leads","sort":{"col":"registered_name","dir":"sideways"}}'));
    t_name := t_name || text 'H a sort direction that is not asc/desc is refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'BAD_VALUE: sort');
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_season_drill', jan || '{"kind":"leads","sort":{"col":"registered_name","dir":"asc","x":1}}'));
    t_name := t_name || text 'H an extra key inside sort is refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'BAD_VALUE: sort');
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_season_drill', jan || '{"kind":"leads","sort":"registered_name"}'));
    t_name := t_name || text 'H sort that is not an object is refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'BAD_VALUE: sort');

    -- ════ I. paging and export ════
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_season_drill', jan || '{"kind":"leads","page":1,"page_size":2,"sort":{"col":"registered_name","dir":"asc"}}'));
    r2 := pg_temp.call_as(adm, pg_temp.rpc('growth_season_drill', jan || '{"kind":"leads","page":2,"page_size":2,"sort":{"col":"registered_name","dir":"asc"}}'));
    t_name := t_name || text 'I page 1 and page 2 (2 per page) are different rows, total stays 4';
    t_det := t_det || (coalesce(r->>'total', r::text) || '/' || coalesce(r2->>'total', r2::text));
    t_pass := t_pass || ((r->>'total')::int = 4 and (r2->>'total')::int = 4 and jsonb_array_length(r->'rows') = 2 and jsonb_array_length(r2->'rows') = 2
                         and (select count(distinct x->>'registered_email') from (select jsonb_array_elements(r->'rows') x union all select jsonb_array_elements(r2->'rows')) q) = 4);
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_season_drill', jan || '{"kind":"leads","page":3,"page_size":2}'));
    t_name := t_name || text 'I a page past the end is empty but the total is still 4'; t_det := t_det || (r->>'total'); t_pass := t_pass || ((r->>'total')::int = 4 and jsonb_array_length(r->'rows') = 0);
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_season_drill', jan || '{"kind":"leads","page_size":101}'));
    t_name := t_name || text 'I page size 101 is refused (max 100)'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'BAD_VALUE: page_size');
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_season_drill', jan || '{"kind":"leads","page_size":0}'));
    t_name := t_name || text 'I page size 0 is refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'BAD_VALUE: page_size');
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_season_drill', jan || '{"kind":"leads","page":0}'));
    t_name := t_name || text 'I page 0 is refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'BAD_VALUE: page');
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_season_drill', jan || '{"kind":"leads","page":"abc"}'));
    t_name := t_name || text 'I a page that is not a number is refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'BAD_VALUE: page');
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_season_drill', jan || '{"kind":"leads","export":true}'));
    t_name := t_name || text 'I export returns all rows in one call, not truncated'; t_det := t_det || (coalesce(r->>'page_size', 'none') || '/' || coalesce(r->>'truncated', 'none'));
    t_pass := t_pass || (jsonb_array_length(r->'rows') = 4 and (r->>'page_size')::int = 5000 and r->>'truncated' = 'false');
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_season_drill', jan || '{"kind":"leads","export":"yes"}'));
    t_name := t_name || text 'I export must be true/false'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'BAD_VALUE: export');

    -- ════ J. nothing was written ════
    t_name := t_name || text 'J reading changes no data (fake rows unchanged)';
    t_det := t_det || text 'see test';
    t_pass := t_pass || ((select count(*) from public.lead_manager where registered_email like 'zz_@example.invalid') = 6
                     and (select count(*) from public.vsat_payments where payment_ref like 'ZZTEST-PAY-%') = 3);

    raise exception using errcode = 'ZDONE';
  exception when sqlstate 'ZDONE' then null;
  end;
  return query select * from unnest(t_name, t_pass, t_det);
end $$;

select * from pg_temp.run_season_tests();

-- Growth → Season Dashboard + Payment Cohort · tests for migration 0121 (STAGING ONLY)
--
-- 0121: one lead rule on the Overview pages.
--   * A lead is counted on its registration day (user_registration_date, IST). The Season Dashboard used created_at.
--     On the Season Dashboard a lead with an empty registration date falls back to created_at (as its list shows).
--   * A lead whose email ends in @vedam.org (any case) is staff, never a lead — now also on the Season Dashboard and
--     the Payment Cohort (the VSAT Campaign Report already did this). Payments are not changed.
-- How to run: apply 0121 on staging, then paste this whole file into the staging SQL editor (or the Supabase MCP).
-- The last statement returns one row per test: test | pass | detail. Everything is rolled back at the end (ZDONE).
-- Fake data only (ZZTEST names), dated 2089–2090. Refuses to run unless app_flags.environment = 'staging'.

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

-- one lead: created at p_created, registered at p_reg (null = empty), with this email (null = no email)
create or replace function pg_temp.mk_lead(p_tag text, p_email text, p_created timestamptz, p_reg timestamptz, p_paid timestamptz default null)
returns uuid language plpgsql as $$
declare v uuid := pg_temp.mk_user('zztest-olr-' || p_tag || '@example.invalid');
begin
  delete from public.lead_manager where lead_id = v;   -- in case a sign-up trigger already made an empty row
  insert into public.lead_manager (lead_id, registered_name, registered_email, created_at, user_registration_date)
  values (v, 'ZZTEST OLR ' || p_tag, p_email, p_created, p_reg);
  if p_paid is not null then
    insert into public.vsat_payments (lead_id, paid_at, payment_ref, provider, amount, currency)
    values (v, p_paid, 'ZZTEST-OLR-' || p_tag, 'simulated', 500, 'INR');
  end if;
  return v;
end $$;

create or replace function pg_temp.sum_n(a jsonb)
returns int language sql as $$ select coalesce(sum((x->>'n')::int), 0)::int from jsonb_array_elements(coalesce(a, '[]'::jsonb)) x $$;

create or replace function pg_temp.run_overview_lead_rule_tests()
returns table (test text, pass boolean, detail text) language plpgsql as $$
declare
  t_name text[] := '{}'; t_pass boolean[] := '{}'; t_det text[] := '{}';
  adm uuid; camp uuid; r jsonb; d jsonb; c jsonb; v jsonb; s text;
  jan jsonb := '{"from":"2090-01-01","to":"2090-01-31"}'::jsonb;
begin
  begin -- rolled back at the end (ZDONE)
    if coalesce((select value from public.app_flags where key = 'environment'), '') <> 'staging' then
      raise exception 'Refusing to run: this is not the staging database.';
    end if;
    perform set_config('vedam.allow_simulated_payments', 'on', true);
    adm := pg_temp.mk_user('zztest-olr-admin@example.invalid');
    insert into public.user_roles (user_id, role) values (adm, 'admin');

    -- window: January 2090 (IST)
    perform pg_temp.mk_lead('a', 'zzolr-a@example.invalid', '2090-01-05 12:00+05:30', '2090-01-05 12:00+05:30', '2090-01-12 12:00+05:30'); -- plain lead, paid
    perform pg_temp.mk_lead('b', 'zzolr-b@example.invalid', '2090-02-20 12:00+05:30', '2090-01-10 12:00+05:30');   -- row made in Feb (an import), registered in Jan
    perform pg_temp.mk_lead('c', 'zzolr-c@example.invalid', '2090-01-15 12:00+05:30', '2089-12-20 12:00+05:30');   -- row made in Jan, registered in Dec
    perform pg_temp.mk_lead('d', 'zzolr-d@example.invalid', '2090-01-20 12:00+05:30', null);                       -- no registration date
    perform pg_temp.mk_lead('e', 'zzolr-e@vedam.org',       '2090-01-08 12:00+05:30', '2090-01-08 12:00+05:30', '2090-01-13 12:00+05:30'); -- staff, paid
    perform pg_temp.mk_lead('f', 'ZZOLR-F@VEDAM.ORG',       '2090-01-09 12:00+05:30', '2090-01-09 12:00+05:30');   -- staff, capital letters
    perform pg_temp.mk_lead('g', null,                      '2090-01-09 12:00+05:30', '2090-01-09 12:00+05:30');   -- no email: still a lead
    perform pg_temp.mk_lead('h', 'zzolr-h@vedam.org.example.invalid', '2090-01-11 12:00+05:30', '2090-01-11 12:00+05:30'); -- not a vedam.org address
    insert into public.vsat_campaigns (name, campaign_start, campaign_end) values ('ZZTEST OLR Jan', '2090-01-01', '2090-01-31') returning id into camp;

    -- ════ A. Season Dashboard ════
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_season_counts', jan));
    t_name := t_name || text 'A Season January: 5 leads (a, b, d, g, h) — by registration day, staff left out; 2 paid (payments unchanged)';
    t_det := t_det || r::text; t_pass := t_pass || ((r->>'leads')::int = 5 and (r->>'paid')::int = 2);
    d := pg_temp.call_as(adm, pg_temp.rpc('growth_season_drill', jan || '{"kind":"leads"}'));
    s := coalesce((select string_agg(coalesce(x->>'registered_email', '(no email)'), ', ' order by x->>'registered_name') from jsonb_array_elements(d->'rows') x), d::text);
    t_name := t_name || text 'A Leads list = the card (5)'; t_det := t_det || (coalesce(d->>'total', d::text) || ' :: ' || s);
    t_pass := t_pass || ((d->>'total')::int = 5 and (r->>'leads')::int = 5);
    t_name := t_name || text 'A a lead registered in January is counted even when its row was made later (b)'; t_det := t_det || s;
    t_pass := t_pass || (s like '%zzolr-b@example.invalid%');
    t_name := t_name || text 'A a lead registered in December is not a January lead, even when its row was made in January (c)'; t_det := t_det || s;
    t_pass := t_pass || (jsonb_typeof(d->'rows') = 'array' and s not like '%zzolr-c@%');
    t_name := t_name || text 'A a lead with no registration date is counted on the day its row was made (d)'; t_det := t_det || s;
    t_pass := t_pass || (s like '%zzolr-d@example.invalid%');
    t_name := t_name || text 'A @vedam.org leads are not leads, in any letter case (e, f)'; t_det := t_det || s;
    t_pass := t_pass || (jsonb_typeof(d->'rows') = 'array' and s not like '%zzolr-e@vedam.org%' and lower(s) not like '%zzolr-f@vedam.org%');
    t_name := t_name || text 'A a lead without an email, and an address that only contains "vedam.org", are still leads (g, h)'; t_det := t_det || s;
    t_pass := t_pass || (s like '%(no email)%' and s like '%zzolr-h@vedam.org.example.invalid%');
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_season_counts', '{"from":"2090-02-01","to":"2090-02-28"}'));
    t_name := t_name || text 'A February: the lead whose row was made in February is not a February lead (0)'; t_det := t_det || r::text; t_pass := t_pass || ((r->>'leads')::int = 0);
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_season_counts', '{"from":"2089-12-01","to":"2089-12-31"}'));
    t_name := t_name || text 'A December: the lead registered in December is a December lead (1)'; t_det := t_det || r::text; t_pass := t_pass || ((r->>'leads')::int = 1);
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_season_counts', jsonb_build_object('campaign_id', camp)));
    t_name := t_name || text 'A campaign mode: the same 5 leads and 2 paid'; t_det := t_det || r::text;
    t_pass := t_pass || ((r->>'leads')::int = 5 and (r->>'paid')::int = 2 and r->>'locked' = 'true');
    d := pg_temp.call_as(adm, pg_temp.rpc('growth_season_drill', jan || '{"kind":"paid"}'));
    t_name := t_name || text 'A Paid list unchanged: a staff account that paid is still in it (2 rows)'; t_det := t_det || coalesce(d->>'total', d::text);
    t_pass := t_pass || ((d->>'total')::int = 2 and exists (select 1 from jsonb_array_elements(d->'rows') x where x->>'registered_email' = 'zzolr-e@vedam.org'));

    -- ════ B. Payment Cohort ════
    c := public.growth__cohort_data(jan, '2090-01-31');
    t_name := t_name || text 'B Cohort January: 4 leads (a, b, g, h) — staff left out; the lead with no registration date is not a lead day (as before)';
    t_det := t_det || (c->'leads')::text; t_pass := t_pass || (pg_temp.sum_n(c->'leads') = 4);
    t_name := t_name || text 'B Cohort: no lead on 8 Jan (staff e); 9 Jan has 1 (g, not staff f)';
    t_det := t_det || (c->'leads')::text;
    t_pass := t_pass || (not exists (select 1 from jsonb_array_elements(c->'leads') x where x->>'d' = '2090-01-08')
                     and (select (x->>'n')::int from jsonb_array_elements(c->'leads') x where x->>'d' = '2090-01-09') = 1);
    t_name := t_name || text 'B Cohort payments unchanged: 2 paid cells (a and the staff account e)'; t_det := t_det || (c->'cells')::text;
    t_pass := t_pass || (pg_temp.sum_n(c->'cells') = 2 and pg_temp.sum_n(c->'unknown') = 0);
    c := public.growth__cohort_data(jsonb_build_object('campaign_id', camp), '2090-01-31');
    t_name := t_name || text 'B Cohort campaign mode: the same 4 leads'; t_det := t_det || (c->'leads')::text; t_pass := t_pass || (pg_temp.sum_n(c->'leads') = 4);

    -- ════ C. the three Overview pages agree ════
    v := public.growth__vcamp_data(camp, '2090-01-31');
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_season_counts', jsonb_build_object('campaign_id', camp)));
    t_name := t_name || text 'C VSAT Campaign Report unchanged: 4 leads'; t_det := t_det || (v->'rows'->'total_leads')::text;
    t_pass := t_pass || ((v->'rows'->'total_leads'->>'total')::int = 4);
    t_name := t_name || text 'C Cohort leads = Report leads (4); Season = the same + the one lead with no registration date (5)';
    t_det := t_det || format('season %s, cohort %s, report %s', r->>'leads', pg_temp.sum_n(c->'leads'), v->'rows'->'total_leads'->>'total');
    t_pass := t_pass || (pg_temp.sum_n(c->'leads') = (v->'rows'->'total_leads'->>'total')::int and (r->>'leads')::int = pg_temp.sum_n(c->'leads') + 1);
    t_name := t_name || text 'C Paid agrees on all three (2)';
    t_det := t_det || format('season %s, cohort %s, report %s', r->>'paid', pg_temp.sum_n(c->'cells'), v->'rows'->'achievement'->>'total');
    t_pass := t_pass || ((r->>'paid')::int = 2 and pg_temp.sum_n(c->'cells') = 2 and (v->'rows'->'achievement'->>'total')::int = 2);

    -- ════ D. security unchanged ════
    r := pg_temp.call_as(adm, 'select to_jsonb(count(*)) from public.growth__season_ids(''leads'', ''2090-01-01'', ''2090-01-31'', null)');
    t_name := t_name || text 'D growth__season_ids is still not callable by a browser role'; t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = '42501');
    r := pg_temp.call_as(adm, 'select public.growth__cohort_data(''{}''::jsonb, ''2090-01-31''::date)');
    t_name := t_name || text 'D growth__cohort_data is still not callable by a browser role'; t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = '42501');
    t_name := t_name || text 'D growth__season_ids SECURITY DEFINER, growth__cohort_data SECURITY INVOKER, both search_path empty';
    t_det := t_det || (select string_agg(p.proname || ' ' || p.prosecdef::text || ' ' || coalesce(p.proconfig::text, 'null'), ' | ' order by p.proname) from pg_proc p
                        where p.pronamespace = 'public'::regnamespace and p.proname in ('growth__season_ids', 'growth__cohort_data'));
    t_pass := t_pass || ((select p.prosecdef and p.proconfig = array['search_path=""'] from pg_proc p where p.oid = 'public.growth__season_ids(text, date, date, date)'::regprocedure)
                     and (select not p.prosecdef and p.proconfig = array['search_path=""'] from pg_proc p where p.oid = 'public.growth__cohort_data(jsonb, date)'::regprocedure));
    r := pg_temp.call_as(null, pg_temp.rpc('growth_season_counts', jan), true);
    t_name := t_name || text 'D anon still cannot read the Season cards'; t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = '42501');

    raise exception using errcode = 'ZDONE';
  exception when sqlstate 'ZDONE' then null;
  end;
  return query select * from unnest(t_name, t_pass, t_det);
end $$;

select * from pg_temp.run_overview_lead_rule_tests();

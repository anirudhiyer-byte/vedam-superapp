-- Growth → Ads / Influencers · tests for migration 0122 (STAGING ONLY)
--
-- 0122: the Ads / Influencers pages use the same lead rule as the Overview pages (0121) and list campaigns
-- newest first.
--   * a lead's day = its registration day (user_registration_date, IST); the row's creation day when that is empty
--   * a lead whose email ends in @vedam.org (any case) is staff: not a lead, and its payment is not counted
--   * growth_mkt_meta lists campaigns newest first, the same order as growth_campaigns_list
-- How to run: apply 0122 on staging, then paste this whole file into the staging SQL editor (or the Supabase MCP).
-- The last statement returns one row per test: test | pass | detail. Everything is rolled back at the end (ZDONE).
-- Fake data only (ZZTEST names, zz* UTMs), dated 2089–2090. Refuses to run unless app_flags.environment = 'staging'.

create or replace function pg_temp.alr_user(p_email text)
returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, aud, role, email_confirmed_at, raw_user_meta_data)
  values (v, p_email, 'authenticated', 'authenticated', now(), '{}'::jsonb);
  insert into public.profiles (id, email, full_name) values (v, p_email, 'ZZTEST ' || split_part(p_email, '@', 1))
  on conflict (id) do update set email = excluded.email, full_name = excluded.full_name;
  return v;
end $$;

-- one lead on the UTM zzalr/zzmed/zz rule: row made at p_created, registered at p_reg (null = empty)
create or replace function pg_temp.alr_lead(p_tag text, p_email text, p_created timestamptz, p_reg timestamptz, p_paid timestamptz default null)
returns uuid language plpgsql as $$
declare u uuid := pg_temp.alr_user('zztest-alr-' || p_tag || '@example.invalid');
begin
  insert into public.lead_manager (lead_id, registered_name, registered_email, utm_source, utm_medium, utm_campaign, created_at, user_registration_date)
  values (u, 'ZZTEST ALR ' || p_tag, p_email, 'zzalr', 'zzmed', 'zz rule', p_created, p_reg)
  on conflict (lead_id) do update set registered_email = excluded.registered_email, utm_source = excluded.utm_source, utm_medium = excluded.utm_medium,
    utm_campaign = excluded.utm_campaign, created_at = excluded.created_at, user_registration_date = excluded.user_registration_date;
  if p_paid is not null then
    insert into public.vsat_payments (lead_id, paid_at, payment_ref, provider, amount, currency)
    values (u, p_paid, 'ZZTEST-ALR-' || p_tag, 'simulated', 500, 'INR');
  end if;
  return u;
end $$;

create or replace function pg_temp.alr_call(p_uid uuid, p_sql text, p_anon boolean default false)
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

create or replace function pg_temp.alr_rpc(p_fn text, p jsonb)
returns text language sql as $$ select format('select public.%I(%L::jsonb)', p_fn, p::text) $$;

create or replace function pg_temp.alr_row(p_res jsonb, p_id uuid)
returns jsonb language sql as $$ select x from jsonb_array_elements(p_res->'rows') x where x->>'id' = p_id::text $$;

create or replace function pg_temp.run_ads_lead_rule_tests()
returns table (test text, pass boolean, detail text) language plpgsql as $$
declare
  tn text[] := '{}'; tp boolean[] := '{}'; td text[] := '{}';
  adm uuid; cj uuid; cm uuid; ad uuid; r jsonb; x jsonb; s text; n int; i_new int; i_old int;
  utm text := 'https://apply.vedam.org/?utm_source=ZZALR&utm_medium=zzmed&utm_campaign=zz%20rule';
begin
  begin -- rolled back at the end (ZDONE)
    if coalesce((select value from public.app_flags where key = 'environment'), '') <> 'staging' then
      raise exception 'Refusing to run: this is not the staging database.';
    end if;
    perform set_config('vedam.allow_simulated_payments', 'on', true);
    adm := pg_temp.alr_user('zztest-alr-admin@example.invalid');
    insert into public.user_roles (user_id, role) values (adm, 'admin');

    insert into public.vsat_campaigns (name, campaign_start, campaign_end) values ('ZZTEST ALR Jan', '2090-01-01', '2090-01-31') returning id into cj;
    insert into public.vsat_campaigns (name, campaign_start, campaign_end) values ('ZZTEST ALR Mar', '2090-03-01', '2090-03-31') returning id into cm;
    insert into public.growth_ad_rows (ad_name, platform, campaign_id, live_date, spend, utm_link)
    values ('ZZTEST ALR ad', 'Meta', cj, '2090-01-01', 1000, utm) returning id into ad;

    perform pg_temp.alr_lead('a', 'zzalr-a@example.invalid', '2090-01-05 12:00+05:30', '2090-01-05 12:00+05:30', '2090-01-12 12:00+05:30'); -- plain lead, paid
    perform pg_temp.alr_lead('b', 'zzalr-b@example.invalid', '2090-02-20 12:00+05:30', '2090-01-10 12:00+05:30');   -- row made in Feb (an import), registered in Jan
    perform pg_temp.alr_lead('c', 'zzalr-c@example.invalid', '2090-01-15 12:00+05:30', '2089-12-20 12:00+05:30');   -- row made in Jan, registered in Dec
    perform pg_temp.alr_lead('d', 'zzalr-d@example.invalid', '2090-01-20 12:00+05:30', null);                       -- no registration date
    perform pg_temp.alr_lead('e', 'zzalr-e@VEDAM.org',       '2090-01-08 12:00+05:30', '2090-01-08 12:00+05:30', '2090-01-13 12:00+05:30'); -- staff, paid
    perform pg_temp.alr_lead('g', null,                      '2090-01-09 12:00+05:30', '2090-01-09 12:00+05:30');   -- no email: still a lead

    -- ════ A. listing ════
    r := pg_temp.alr_call(adm, pg_temp.alr_rpc('growth_rows_list', '{"channel":"ads"}'));
    x := pg_temp.alr_row(r, ad);
    tn := tn || text 'A listing in-window: 4 leads (a, b, d, g) and 1 payment — by registration day, staff left out with its payment';
    td := td || coalesce(format('leads %s, payments %s', x->>'leads', x->>'payments'), r::text);
    tp := tp || ((x->>'leads')::int = 4 and (x->>'payments')::int = 1);
    tn := tn || text 'A listing all-time: 5 leads (a, b, c, d, g) and 1 payment';
    td := td || coalesce(format('leads_all %s, payments_all %s', x->>'leads_all', x->>'payments_all'), r::text);
    tp := tp || ((x->>'leads_all')::int = 5 and (x->>'payments_all')::int = 1);

    -- ════ B. performance ════
    r := pg_temp.alr_call(adm, pg_temp.alr_rpc('growth_perf', jsonb_build_object('channel', 'ads', 'campaign_ids', jsonb_build_array(cj))));
    x := pg_temp.alr_row(r, ad);
    tn := tn || text 'B campaign view: 4 leads, 1 payment'; td := td || coalesce(format('leads %s, payments %s', x->>'leads', x->>'payments'), r::text);
    tp := tp || ((x->>'leads')::int = 4 and (x->>'payments')::int = 1);
    r := pg_temp.alr_call(adm, pg_temp.alr_rpc('growth_perf', '{"channel":"ads","from":"2090-02-01","to":"2090-02-28"}'));
    x := pg_temp.alr_row(r, ad);
    tn := tn || text 'B February: the lead whose row was made in February is not a February lead'; td := td || coalesce(x->>'leads', 'row not shown');
    tp := tp || (x is null or (x->>'leads')::int = 0);
    r := pg_temp.alr_call(adm, pg_temp.alr_rpc('growth_perf', '{"channel":"ads","from":"2089-12-01","to":"2089-12-31"}'));
    x := pg_temp.alr_row(r, ad);
    tn := tn || text 'B December: the lead registered in December is a December lead (1)'; td := td || coalesce(x->>'leads', 'row not shown');
    tp := tp || ((x->>'leads')::int = 1);
    r := pg_temp.alr_call(adm, pg_temp.alr_rpc('growth_weekly', jsonb_build_object('channel', 'ads', 'ids', jsonb_build_array(ad))));
    select format('%s/%s', coalesce(sum((w->>'leads')::int), 0), coalesce(sum((w->>'payments')::int), 0)) into s from jsonb_array_elements(r->'weeks') w;
    tn := tn || text 'B weekly: 5 leads and 1 payment in all (staff and its payment not counted)'; td := td || coalesce(s, r::text); tp := tp || (s = '5/1');

    -- ════ C. lead timing (days from the ad's live date, 1 Jan) ════
    r := pg_temp.alr_call(adm, pg_temp.alr_rpc('growth_lead_timing', jsonb_build_object('channel', 'ads', 'ids', jsonb_build_array(ad))));
    s := coalesce(format('%s/%s/%s/%s/%s', r->>'before', r->>'d0_7', r->>'d8_30', r->>'d31p', r->>'no_live'), r::text);
    tn := tn || text 'C timing by registration day: 1 before (c), 1 in days 0-7 (a), 3 in days 8-30 (g, b, d), 0 later';
    td := td || s; tp := tp || (s = '1/1/3/0/0');

    -- ════ D. campaign order ════
    r := pg_temp.alr_call(adm, 'select public.growth_mkt_meta()');
    select min(o) filter (where v->>'id' = cm::text), min(o) filter (where v->>'id' = cj::text) into i_new, i_old
      from jsonb_array_elements(r->'campaigns') with ordinality q(v, o);
    tn := tn || text 'D Ads / Influencers campaign list: the newer campaign comes first'; td := td || format('Mar at %s, Jan at %s', i_new, i_old);
    tp := tp || (i_new < i_old);
    tn := tn || text 'D the order is the same as on the Campaigns page';
    x := pg_temp.alr_call(adm, 'select public.growth_campaigns_list()');
    td := td || left((select string_agg(v->>'name', ' > ' order by o) from jsonb_array_elements(r->'campaigns') with ordinality q(v, o)), 160);
    tp := tp || ((select array_agg(v->>'id' order by o) from jsonb_array_elements(r->'campaigns') with ordinality q(v, o))
               = (select array_agg(v->>'id' order by o) from jsonb_array_elements(x) with ordinality q(v, o)));
    tn := tn || text 'D every campaign still has the same fields'; td := td || (select string_agg(k, ',' order by k) from jsonb_object_keys(r->'campaigns'->0) k);
    tp := tp || ((r->'campaigns'->0) ?& array['id', 'name', 'campaign_start', 'campaign_end', 'exam_date', 'budget', 'application_target', 'used']);

    -- ════ E. security unchanged ════
    r := pg_temp.alr_call(adm, 'select to_jsonb(count(*)) from public.growth__leads(array[''zzalr/zzmed/zz rule''])');
    tn := tn || text 'E growth__leads is still private (even an admin cannot call it)'; td := td || r::text; tp := tp || (r->>'sqlstate' = '42501');
    r := pg_temp.alr_call(null, 'select public.growth_mkt_meta()', true);
    tn := tn || text 'E anon still cannot call growth_mkt_meta'; td := td || r::text; tp := tp || (r->>'sqlstate' = '42501');
    select count(*) into n from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('growth__leads', 'growth_mkt_meta')
       and p.prosecdef and p.proconfig = array['search_path=""'];
    tn := tn || text 'E both functions are still SECURITY DEFINER with search_path empty'; td := td || n::text; tp := tp || (n = 2);
    tn := tn || text 'E grants unchanged: growth_mkt_meta for logged-in only, growth__leads for nobody in the browser'; td := td || text 'see test';
    tp := tp || (has_function_privilege('authenticated', 'public.growth_mkt_meta()', 'execute') and not has_function_privilege('anon', 'public.growth_mkt_meta()', 'execute')
             and not has_function_privilege('authenticated', 'public.growth__leads(text[])', 'execute') and not has_function_privilege('anon', 'public.growth__leads(text[])', 'execute'));

    raise exception using errcode = 'ZDONE';
  exception when sqlstate 'ZDONE' then null;
  end;
  return query select * from unnest(tn, tp, td);
end $$;

select * from pg_temp.run_ads_lead_rule_tests();

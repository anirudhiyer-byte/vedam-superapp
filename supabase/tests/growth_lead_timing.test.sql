-- Growth · tests for migration 0118 (growth_lead_timing: when leads arrive after a post goes live). STAGING ONLY.
--
-- How to run: paste this whole file into the staging SQL editor, or run it through the Supabase MCP.
-- The last statement returns one row per test: test | pass | detail.
-- Everything happens inside a block that is rolled back at the end (ZDONE): nothing stays.
-- Fake data only (@example.invalid, ZZTEST names, zz* UTMs).
--
-- Story (influencer channel unless said otherwise):
--   VSAT-9 window 05-01 .. 05-20
--   P1  post, UTM "zzlt/zzmed/zz timing", VSAT-9, live 05-01
--   P1b post, same UTM, no campaign, live 06-01 (a rerun: owns the leads from 06-01 on, 0113)
--   P2  post, UTM "zzlt/zzmed/zz timing2", planned, no live date
--   AD  ad,   same UTM as P1, live 05-01 (ads channel: counted on its own)
--   leads on P1's UTM: 04-25 (6 days before live), 05-01 (day 0), 05-08 (day 7), 05-09 (day 8),
--                      05-31 (day 30), 06-01 (P1b's day 0), 07-15 (P1b's day 44)
--   lead on P2's UTM:  05-05

create or replace function pg_temp.lt_user(p_email text)
returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, aud, role, email_confirmed_at, raw_user_meta_data)
  values (v, p_email, 'authenticated', 'authenticated', now(), '{}'::jsonb);
  insert into public.profiles (id, email, full_name) values (v, p_email, 'ZZTEST ' || split_part(p_email, '@', 1))
  on conflict (id) do update set email = excluded.email, full_name = excluded.full_name;
  return v;
end $$;

create or replace function pg_temp.lt_lead(p_tag text, p_campaign text, p_at timestamptz)
returns uuid language plpgsql as $$
declare u uuid := pg_temp.lt_user('zztest-lt-' || lower(p_tag) || '@example.invalid');
begin
  insert into public.lead_manager (lead_id, registered_name, registered_email, utm_source, utm_medium, utm_campaign, created_at)
  values (u, 'ZZTEST ' || p_tag, 'zztest-lt-' || lower(p_tag) || '@example.invalid', 'zzlt', 'zzmed', p_campaign, p_at)
  on conflict (lead_id) do update set utm_source = excluded.utm_source, utm_medium = excluded.utm_medium,
    utm_campaign = excluded.utm_campaign, created_at = excluded.created_at;
  return u;
end $$;

create or replace function pg_temp.lt_call(p_uid uuid, p_sql text, p_anon boolean default false)
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

create or replace function pg_temp.lt_rpc(p jsonb)
returns text language sql as $$ select format('select public.growth_lead_timing(%L::jsonb)', p::text) $$;

-- before / d0_7 / d8_30 / d31p / no_live of an answer
create or replace function pg_temp.lt_b(r jsonb)
returns text language sql as $$
  select coalesce(format('%s/%s/%s/%s/%s', r->>'before', r->>'d0_7', r->>'d8_30', r->>'d31p', r->>'no_live'), r::text)
$$;

create or replace function pg_temp.t_0118()
returns table (test text, pass boolean, detail text) language plpgsql as $$
declare
  tn text[] := '{}'; tp boolean[] := '{}'; td text[] := '{}';
  adm uuid; usr uuid; v9 uuid; inf uuid; p1 uuid; p1b uuid; p2 uuid; ad uuid; r jsonb; s text; n int;
  u1 text := 'https://apply.vedam.org/?utm_source=ZZLT&utm_medium=zzmed&utm_campaign=zz%20timing';
  u2 text := 'https://apply.vedam.org/?utm_source=ZZLT&utm_medium=zzmed&utm_campaign=zz%20timing2';
begin
  begin -- rolled back at the end (ZDONE)
    adm := pg_temp.lt_user('zztest-lt-admin@example.invalid');
    insert into public.user_roles (user_id, role) values (adm, 'admin');
    usr := pg_temp.lt_user('zztest-lt-user@example.invalid');

    insert into public.vsat_campaigns (name, campaign_start, campaign_end, exam_date) values ('ZZTEST LT VSAT-9', '2026-05-01', '2026-05-20', '2026-05-21') returning id into v9;
    insert into public.growth_influencers (name) values ('ZZTEST LT creator') returning id into inf;
    insert into public.growth_infl_posts (influencer_id, platform, campaign_id, live_date, live_status, cost, utm_link)
    values (inf, 'Instagram Reel', v9, '2026-05-01', 'Live', 1000, u1) returning id into p1;
    insert into public.growth_infl_posts (influencer_id, platform, campaign_id, live_date, live_status, cost, utm_link)
    values (inf, 'Instagram Reel', null, '2026-06-01', 'Live', 500, u1) returning id into p1b;
    insert into public.growth_infl_posts (influencer_id, platform, campaign_id, live_date, live_status, cost, utm_link)
    values (inf, 'YouTube Shorts', null, null, 'Planned', 0, u2) returning id into p2;
    insert into public.growth_ad_rows (ad_name, platform, campaign_id, live_date, spend, utm_link)
    values ('ZZTEST LT ad', 'Meta', null, '2026-05-01', 2000, u1) returning id into ad;

    perform pg_temp.lt_lead('B6',  'zz timing',  '2026-04-25 10:00+05:30');
    perform pg_temp.lt_lead('D0',  'zz timing',  '2026-05-01 10:00+05:30');
    perform pg_temp.lt_lead('D7',  'zz timing',  '2026-05-08 23:30+05:30');
    perform pg_temp.lt_lead('D8',  'zz timing',  '2026-05-09 00:15+05:30');
    perform pg_temp.lt_lead('D30', 'zz timing',  '2026-05-31 10:00+05:30');
    perform pg_temp.lt_lead('R0',  'zz timing',  '2026-06-01 10:00+05:30');
    perform pg_temp.lt_lead('R44', 'zz timing',  '2026-07-15 10:00+05:30');
    perform pg_temp.lt_lead('PL',  'zz timing2', '2026-05-05 10:00+05:30');

    -- ── security ──
    r := pg_temp.lt_call(null, pg_temp.lt_rpc(jsonb_build_object('channel', 'influencers', 'ids', jsonb_build_array(p1))), true);
    tn := tn || text 'SEC anon cannot call it'; tp := tp || (r->>'sqlstate' = '42501'); td := td || r::text;
    r := pg_temp.lt_call(usr, pg_temp.lt_rpc(jsonb_build_object('channel', 'influencers', 'ids', jsonb_build_array(p1))));
    tn := tn || text 'SEC a signed-in non-admin is refused (FORBIDDEN)'; tp := tp || (r->>'message' = 'FORBIDDEN'); td := td || r::text;
    r := pg_temp.lt_call(adm, pg_temp.lt_rpc(jsonb_build_object('channel', 'influencers', 'ids', jsonb_build_array(p1), 'evil', 1)));
    tn := tn || text 'SEC an unknown key is refused'; tp := tp || (r->>'message' = 'UNKNOWN_KEY: evil'); td := td || r::text;
    r := pg_temp.lt_call(adm, pg_temp.lt_rpc('{"channel":"influencers","ids":["not-a-uuid"]}'));
    tn := tn || text 'SEC bad ids are refused'; tp := tp || (r->>'message' = 'BAD_VALUE: ids'); td := td || r::text;
    r := pg_temp.lt_call(adm, pg_temp.lt_rpc('{"channel":"influencers","ids":[]}'));
    tn := tn || text 'SEC an empty ids list is refused'; tp := tp || (r->>'message' = 'BAD_VALUE: ids'); td := td || r::text;
    r := pg_temp.lt_call(adm, pg_temp.lt_rpc(jsonb_build_object('channel', 'influencers', 'ids', jsonb_build_array(p1), 'from', '2026-06-01', 'to', '2026-05-01')));
    tn := tn || text 'SEC to before from is refused'; tp := tp || (r->>'message' = 'BAD_VALUE: to'); td := td || r::text;
    r := pg_temp.lt_call(adm, pg_temp.lt_rpc(jsonb_build_object('channel', 'tiktok', 'ids', jsonb_build_array(p1))));
    tn := tn || text 'SEC an unknown channel is refused'; tp := tp || (r ? 'sqlstate' and r->>'sqlstate' = '22023'); td := td || r::text;
    select count(*) into n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname = 'growth_lead_timing' and p.prosecdef
       and array_to_string(p.proconfig, ',') = 'search_path=""'
       and not has_function_privilege('anon', p.oid, 'execute') and has_function_privilege('authenticated', p.oid, 'execute');
    tn := tn || text 'SEC SECURITY DEFINER, empty search_path, authenticated only'; tp := tp || (n = 1); td := td || n::text;

    -- ── buckets: day 0..7 / 8..30 / 31+ from the row''s own live date, IST days ──
    s := pg_temp.lt_b(pg_temp.lt_call(adm, pg_temp.lt_rpc(jsonb_build_object('channel', 'influencers', 'ids', jsonb_build_array(p1)))));
    tn := tn || text 'BUCKETS P1: 1 before, day 0 + day 7 (23:30 IST) in 0-7, day 8 (00:15 IST) + day 30 in 8-30, the rerun''s leads not P1''s'; tp := tp || (s = '1/2/2/0/0'); td := td || s;
    s := pg_temp.lt_b(pg_temp.lt_call(adm, pg_temp.lt_rpc(jsonb_build_object('channel', 'influencers', 'ids', jsonb_build_array(p1b)))));
    tn := tn || text 'OWNER the rerun P1b counts from its own live date: day 0 and day 44'; tp := tp || (s = '0/1/0/1/0'); td := td || s;
    s := pg_temp.lt_b(pg_temp.lt_call(adm, pg_temp.lt_rpc(jsonb_build_object('channel', 'influencers', 'ids', jsonb_build_array(p1, p1b, p2)))));
    tn := tn || text 'SUM all three posts = every lead once (8), the planned post''s lead under no live date'; tp := tp || (s = '1/3/2/1/1'); td := td || s;

    -- ── same leads as growth_perf ──
    r := pg_temp.lt_call(adm, pg_temp.lt_rpc(jsonb_build_object('channel', 'influencers', 'ids', jsonb_build_array(p1), 'campaign_id', v9)));
    s := pg_temp.lt_b(r);
    tn := tn || text 'CAMPAIGN VSAT-9 cohort (05-01..05-20): day 0, day 7, day 8 only'; tp := tp || (s = '0/2/1/0/0'); td := td || s;
    select (x->>'leads')::int into n from jsonb_array_elements(pg_temp.lt_call(adm, format('select public.growth_perf(%L::jsonb)',
             jsonb_build_object('channel', 'influencers', 'live', 'all', 'campaign_ids', jsonb_build_array(v9))::text))->'rows') x where x->>'id' = p1::text;
    tn := tn || text 'CAMPAIGN the buckets add up to growth_perf''s cohort leads for P1'; tp := tp || (n = 3); td := td || coalesce(n::text, 'null');
    s := pg_temp.lt_b(pg_temp.lt_call(adm, pg_temp.lt_rpc(jsonb_build_object('channel', 'influencers', 'ids', jsonb_build_array(p1b), 'campaign_id', v9))));
    tn := tn || text 'CAMPAIGN a row outside the campaign counts nothing'; tp := tp || (s = '0/0/0/0/0'); td := td || s;

    s := pg_temp.lt_b(pg_temp.lt_call(adm, pg_temp.lt_rpc(jsonb_build_object('channel', 'influencers', 'ids', jsonb_build_array(p1), 'from', '2026-05-01', 'to', '2026-05-31'))));
    tn := tn || text 'DATES from / to keep only the leads that arrived in them (May: 4)'; tp := tp || (s = '0/2/2/0/0'); td := td || s;
    select (x->>'leads')::int into n from jsonb_array_elements(pg_temp.lt_call(adm, format('select public.growth_perf(%L::jsonb)',
             '{"channel":"influencers","live":"all","from":"2026-05-01","to":"2026-05-31"}'))->'rows') x where x->>'id' = p1::text;
    tn := tn || text 'DATES the buckets add up to growth_perf''s May leads for P1'; tp := tp || (n = 4); td := td || coalesce(n::text, 'null');

    -- ── channels are separate ──
    s := pg_temp.lt_b(pg_temp.lt_call(adm, pg_temp.lt_rpc(jsonb_build_object('channel', 'ads', 'ids', jsonb_build_array(ad)))));
    tn := tn || text 'CHANNEL the ad with the same UTM counts all 7 of its leads on its own'; tp := tp || (s = '1/2/2/2/0'); td := td || s;
    s := pg_temp.lt_b(pg_temp.lt_call(adm, pg_temp.lt_rpc(jsonb_build_object('channel', 'ads', 'ids', jsonb_build_array(p1)))));
    tn := tn || text 'CHANNEL a post id asked as an ad counts nothing'; tp := tp || (s = '0/0/0/0/0'); td := td || s;

    -- ── trash ──
    update public.growth_infl_posts set deleted_at = now() where id = p1b;
    s := pg_temp.lt_b(pg_temp.lt_call(adm, pg_temp.lt_rpc(jsonb_build_object('channel', 'influencers', 'ids', jsonb_build_array(p1, p1b)))));
    tn := tn || text 'TRASH the trashed rerun counts nothing and its leads go back to P1 (day 31 and day 75)'; tp := tp || (s = '1/2/2/2/0'); td := td || s;

    -- ── read only ──
    select count(*) into n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname = 'growth_lead_timing' and p.provolatile = 's';
    tn := tn || text 'READ-ONLY the function is STABLE (cannot write)'; tp := tp || (n = 1); td := td || n::text;

    raise exception 'ZDONE';
  exception when others then
    if sqlerrm <> 'ZDONE' then tn := tn || text 'HARNESS'; tp := tp || false; td := td || sqlerrm; end if;
  end;
  return query select * from unnest(tn, tp, td);
end $$;

select * from pg_temp.t_0118();

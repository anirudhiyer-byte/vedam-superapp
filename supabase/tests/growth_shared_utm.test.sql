-- Growth · tests for migration 0113 (a lead counts for one ad / post when rows share a UTM). STAGING ONLY.
--
-- How to run: paste this whole file into the staging SQL editor, or run it through the Supabase MCP.
-- The last statement returns one row per test: test | pass | detail.
-- Everything happens inside a block that is rolled back at the end (ZDONE): nothing stays.
-- Fake data only (@example.invalid, ZZTEST names, zz* UTMs).
--
-- Story (one UTM "zzsu/zzmed/zz shared", used by three ads and one influencer post):
--   VSAT-8  window 03-01 .. 03-15   ad A8  live 03-01
--   VSAT-9  window 05-01 .. 05-12   ad A9  live 05-01, ad A9b live 05-08 (same VSAT, later start)
--   leads:  LF 02-20 (before every ad)          -> A8  (all went live later: the first one)
--           LM 03-05 (in VSAT-8), paid 03-10     -> A8  (its window)
--           LG 04-10 (between the windows)       -> A8  (went live most recently before it)
--           LA 05-03 (in VSAT-9)                 -> A9  (A9b not live yet)
--           LB 05-10 (in VSAT-9), paid 05-11     -> A9b (both in window; A9b went live most recently)
--           LJ 06-05 (after), paid + enrolled    -> A9b (went live most recently before it)

create or replace function pg_temp.su_user(p_email text)
returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, aud, role, email_confirmed_at, raw_user_meta_data)
  values (v, p_email, 'authenticated', 'authenticated', now(), '{}'::jsonb);
  insert into public.profiles (id, email, full_name) values (v, p_email, 'ZZTEST ' || split_part(p_email, '@', 1))
  on conflict (id) do update set email = excluded.email, full_name = excluded.full_name;
  return v;
end $$;

create or replace function pg_temp.su_lead(p_tag text, p_at timestamptz, p_paid timestamptz default null, p_enrolled timestamptz default null)
returns uuid language plpgsql as $$
declare u uuid := pg_temp.su_user('zztest-su-' || lower(p_tag) || '@example.invalid');
begin
  -- 0122: leads are counted by their registration day; a real row has it equal to created_at (both default to now())
  insert into public.lead_manager (lead_id, registered_name, registered_email, utm_source, utm_medium, utm_campaign, created_at, user_registration_date)
  values (u, 'ZZTEST ' || p_tag, 'zztest-su-' || lower(p_tag) || '@example.invalid', 'zzsu', 'zzmed', 'zz shared', p_at, p_at)
  on conflict (lead_id) do update set utm_source = excluded.utm_source, utm_medium = excluded.utm_medium,
    utm_campaign = excluded.utm_campaign, created_at = excluded.created_at, user_registration_date = excluded.user_registration_date;
  if p_paid is not null then
    insert into public.vsat_payments (lead_id, paid_at, payment_ref, provider, amount, currency)
    values (u, p_paid, 'zz-su-' || p_tag, 'simulated', 1000, 'INR');
  end if;
  if p_enrolled is not null then
    insert into public.application_manager (application_id, lead_id, application_no, registered_name, registered_email)
    values ('ZZSU-' || p_tag, u, 'ZZSU-' || p_tag, 'ZZTEST ' || p_tag, 'zztest-su-' || lower(p_tag) || '@example.invalid');
    update public.application_manager set enrollment_stage = 'approved', enrollment_paid_at = p_enrolled where application_id = 'ZZSU-' || p_tag;
  end if;
  return u;
end $$;

create or replace function pg_temp.su_call(p_uid uuid, p_sql text, p_anon boolean default false)
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

create or replace function pg_temp.su_rpc(p_fn text, p jsonb)
returns text language sql as $$ select format('select public.%I(%L::jsonb)', p_fn, p::text) $$;

-- leads / payments / enrollments of one row in a growth_perf answer ("-" when the row is not there)
create or replace function pg_temp.su_lpe(p_res jsonb, p_id uuid)
returns text language sql as $$
  select coalesce((select format('%s/%s/%s', x->>'leads', x->>'payments', x->>'enrollments')
                     from jsonb_array_elements(p_res->'rows') x where x->>'id' = p_id::text), '-')
$$;

-- total leads / payments / enrollments of a growth_weekly answer
create or replace function pg_temp.su_wk(p_res jsonb)
returns text language sql as $$
  select format('%s/%s/%s', coalesce(sum((w->>'leads')::int), 0), coalesce(sum((w->>'payments')::int), 0), coalesce(sum((w->>'enrollments')::int), 0))
    from jsonb_array_elements(p_res->'weeks') w
$$;

create or replace function pg_temp.t_0113()
returns table (test text, pass boolean, detail text) language plpgsql as $$
declare
  tn text[] := '{}'; tp boolean[] := '{}'; td text[] := '{}';
  adm uuid; v8 uuid; v9 uuid; a8 uuid; a9 uuid; a9b uuid; inf uuid; p9 uuid; r jsonb; s text; n int;
  utm text := 'https://apply.vedam.org/?utm_source=ZZSU&utm_medium=zzmed&utm_campaign=zz%20shared';
begin
  begin -- rolled back at the end (ZDONE)
    perform set_config('vedam.allow_simulated_payments', 'on', true);
    adm := pg_temp.su_user('zztest-su-admin@example.invalid');
    insert into public.user_roles (user_id, role) values (adm, 'admin');

    insert into public.vsat_campaigns (name, campaign_start, campaign_end, exam_date) values ('ZZTEST SU VSAT-8', '2026-03-01', '2026-03-15', '2026-03-16') returning id into v8;
    insert into public.vsat_campaigns (name, campaign_start, campaign_end, exam_date) values ('ZZTEST SU VSAT-9', '2026-05-01', '2026-05-12', '2026-05-13') returning id into v9;
    insert into public.growth_ad_rows (ad_name, platform, campaign_id, live_date, spend, utm_link) values ('ZZTEST SU reel', 'Meta', v8, '2026-03-01', 1000, utm) returning id into a8;
    insert into public.growth_ad_rows (ad_name, platform, campaign_id, live_date, spend, utm_link) values ('ZZTEST SU reel (rerun)', 'Meta', v9, '2026-05-01', 2000, utm) returning id into a9;
    insert into public.growth_ad_rows (ad_name, platform, campaign_id, live_date, spend, utm_link) values ('ZZTEST SU reel (rerun 2)', 'Meta', v9, '2026-05-08', 500, utm) returning id into a9b;
    insert into public.growth_influencers (name) values ('ZZTEST SU creator') returning id into inf;
    insert into public.growth_infl_posts (influencer_id, platform, campaign_id, live_date, live_status, cost, utm_link)
    values (inf, 'YouTube Shorts', v9, '2026-05-01', 'Live', 300, utm) returning id into p9;

    perform pg_temp.su_lead('LF', '2026-02-20 10:00+05:30');
    perform pg_temp.su_lead('LM', '2026-03-05 10:00+05:30', '2026-03-10 10:00+05:30');
    perform pg_temp.su_lead('LG', '2026-04-10 10:00+05:30');
    perform pg_temp.su_lead('LA', '2026-05-03 10:00+05:30');
    perform pg_temp.su_lead('LB', '2026-05-10 10:00+05:30', '2026-05-11 10:00+05:30');
    perform pg_temp.su_lead('LJ', '2026-06-05 10:00+05:30', '2026-06-06 10:00+05:30', '2026-06-20 10:00+05:30');

    -- ── security ──
    r := pg_temp.su_call(adm, 'select to_jsonb(count(*)) from public.growth__owned_leads(''ads'', array[''zzsu/zzmed/zz shared''])');
    tn := tn || text 'SEC the owner helper is private (even an admin cannot call it)'; tp := tp || (r->>'sqlstate' = '42501'); td := td || r::text;
    r := pg_temp.su_call(null, pg_temp.su_rpc('growth_perf', '{"channel":"ads"}'), true);
    tn := tn || text 'SEC anon still cannot call growth_perf'; tp := tp || (r->>'sqlstate' = '42501'); td := td || r::text;
    select count(*) into n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname = 'growth__owned_leads' and p.prosecdef
       and array_to_string(p.proconfig, ',') = 'search_path=""';
    tn := tn || text 'SEC helper is SECURITY DEFINER with an empty search_path'; tp := tp || (n = 1); td := td || n::text;

    -- ── date view (no campaign) ──
    r := pg_temp.su_call(adm, pg_temp.su_rpc('growth_perf', '{"channel":"ads"}'));
    s := concat_ws(' | ', pg_temp.su_lpe(r, a8), pg_temp.su_lpe(r, a9), pg_temp.su_lpe(r, a9b));
    tn := tn || text 'ALL-TIME each lead goes to one ad: A8 3/1/0, A9 1/0/0, A9b 2/2/1'; tp := tp || (s = '3/1/0 | 1/0/0 | 2/2/1'); td := td || s;
    select sum((x->>'leads')::int) into n from jsonb_array_elements(r->'rows') x where (x->>'id')::uuid in (a8, a9, a9b);
    tn := tn || text 'ALL-TIME the three ads add up to the UTM''s 6 leads (no double counting)'; tp := tp || (n = 6); td := td || n::text;

    r := pg_temp.su_call(adm, pg_temp.su_rpc('growth_perf', '{"channel":"ads","from":"2026-05-01","to":"2026-05-31"}'));
    s := concat_ws(' | ', pg_temp.su_lpe(r, a8), pg_temp.su_lpe(r, a9), pg_temp.su_lpe(r, a9b));
    tn := tn || text 'MAY leads in VSAT-9 go to the VSAT-9 ads only (A8 not shown; A9 1, A9b 1 lead + 1 paid)'; tp := tp || (s = '- | 1/0/0 | 1/1/0'); td := td || s;

    r := pg_temp.su_call(adm, pg_temp.su_rpc('growth_perf', '{"channel":"ads","from":"2026-03-01","to":"2026-04-30"}'));
    s := concat_ws(' | ', pg_temp.su_lpe(r, a8), pg_temp.su_lpe(r, a9), pg_temp.su_lpe(r, a9b));
    tn := tn || text 'MAR-APR VSAT-8 window lead and the gap lead go to A8; the reruns show nothing'; tp := tp || (s = '2/1/0 | - | -'); td := td || s;

    r := pg_temp.su_call(adm, pg_temp.su_rpc('growth_perf', '{"channel":"ads","from":"2026-06-01","to":"2026-06-30"}'));
    s := concat_ws(' | ', pg_temp.su_lpe(r, a8), pg_temp.su_lpe(r, a9), pg_temp.su_lpe(r, a9b));
    tn := tn || text 'JUNE a lead after every window goes to the ad that went live most recently (A9b)'; tp := tp || (s = '- | - | 1/1/1'); td := td || s;

    -- ── campaign view (cohort): totals unchanged, rows no longer overlap ──
    r := pg_temp.su_call(adm, pg_temp.su_rpc('growth_perf', jsonb_build_object('channel', 'ads', 'campaign_ids', jsonb_build_array(v9))));
    s := concat_ws(' | ', pg_temp.su_lpe(r, a8), pg_temp.su_lpe(r, a9), pg_temp.su_lpe(r, a9b));
    tn := tn || text 'CAMPAIGN VSAT-9 cohort = 2 leads, split A9 1 / A9b 1 (was 2 + 2)'; tp := tp || (s = '- | 1/0/0 | 1/1/0'); td := td || s;
    r := pg_temp.su_call(adm, pg_temp.su_rpc('growth_perf', jsonb_build_object('channel', 'ads', 'campaign_ids', jsonb_build_array(v8))));
    s := pg_temp.su_lpe(r, a8);
    tn := tn || text 'CAMPAIGN VSAT-8 cohort = only the lead inside its dates (1 lead, 1 paid)'; tp := tp || (s = '1/1/0'); td := td || s;

    -- ── weekly ──
    s := pg_temp.su_wk(pg_temp.su_call(adm, pg_temp.su_rpc('growth_weekly', jsonb_build_object('channel', 'ads', 'ids', jsonb_build_array(a9)))));
    tn := tn || text 'WEEKLY one ad = only the leads it owns (A9: 1/0/0)'; tp := tp || (s = '1/0/0'); td := td || s;
    s := pg_temp.su_wk(pg_temp.su_call(adm, pg_temp.su_rpc('growth_weekly', jsonb_build_object('channel', 'ads', 'ids', jsonb_build_array(a8, a9, a9b)))));
    tn := tn || text 'WEEKLY all three ads = each lead once (6/3/1)'; tp := tp || (s = '6/3/1'); td := td || s;
    s := pg_temp.su_wk(pg_temp.su_call(adm, pg_temp.su_rpc('growth_weekly', jsonb_build_object('channel', 'ads', 'ids', jsonb_build_array(a8, a9b), 'campaign_id', v9))));
    tn := tn || text 'WEEKLY with a campaign = that campaign''s rows, own leads in its dates (A9b in VSAT-9: 1/1/0)'; tp := tp || (s = '1/1/0'); td := td || s;

    -- ── channels are separate ──
    r := pg_temp.su_call(adm, pg_temp.su_rpc('growth_perf', '{"channel":"influencers","live":"all"}'));
    s := pg_temp.su_lpe(r, p9);
    tn := tn || text 'CHANNEL an influencer post with the same UTM keeps its own count (6/3/1); ads are not affected'; tp := tp || (s = '6/3/1'); td := td || s;

    -- ── listing unchanged (in-window per row, all-time per UTM) ──
    r := pg_temp.su_call(adm, pg_temp.su_rpc('growth_rows_list', '{"channel":"ads"}'));
    select format('%s/%s', x->>'leads', x->>'leads_all') into s from jsonb_array_elements(r->'rows') x where x->>'id' = a9::text;
    tn := tn || text 'LISTING unchanged: A9 in-window 2 (VSAT-9 dates), all-time 6 (whole UTM)'; tp := tp || (s = '2/6'); td := td || coalesce(s, 'null');

    -- ── a trashed row owns nothing ──
    update public.growth_ad_rows set deleted_at = now() where id = a9b;
    r := pg_temp.su_call(adm, pg_temp.su_rpc('growth_perf', '{"channel":"ads"}'));
    s := concat_ws(' | ', pg_temp.su_lpe(r, a8), pg_temp.su_lpe(r, a9), pg_temp.su_lpe(r, a9b));
    tn := tn || text 'TRASH a trashed ad''s leads move to the next owner (A9 3/2/1)'; tp := tp || (s = '3/1/0 | 3/2/1 | -'); td := td || s;

    raise exception 'ZDONE';
  exception when others then
    if sqlerrm <> 'ZDONE' then tn := tn || text 'HARNESS'; tp := tp || false; td := td || sqlerrm; end if;
  end;
  return query select * from unnest(tn, tp, td);
end $$;

select * from pg_temp.t_0113();

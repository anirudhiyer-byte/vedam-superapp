-- Growth → Ads + Influencers · tests for migration 0105 (STAGING ONLY)
--
-- How to run: paste this whole file into the staging SQL editor, or run it through the
-- Supabase MCP. The last statement returns one row per test: test | pass | detail.
-- Everything is created inside a block that is rolled back at the end (ZDONE): nothing stays.
-- Fake data only (@example.invalid, ZZTEST names, zz* UTMs).

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

-- a lead whose FIRST touch is src/med/camp, arriving at p_at (IST); optional paid / enrolled
create or replace function pg_temp.mk_lead(p_tag text, p_src text, p_med text, p_camp text, p_at timestamptz,
                                           p_paid timestamptz default null, p_enrolled timestamptz default null)
returns uuid language plpgsql as $$
declare u uuid := pg_temp.mk_user('zztest-gai-' || lower(p_tag) || '@example.invalid');
begin
  insert into public.lead_manager (lead_id, registered_name, registered_email, utm_source, utm_medium, utm_campaign, created_at)
  values (u, 'ZZTEST ' || p_tag, 'zztest-gai-' || lower(p_tag) || '@example.invalid', p_src, p_med, p_camp, p_at);
  if p_paid is not null then
    insert into public.vsat_payments (lead_id, paid_at, payment_ref, provider, amount, currency)
    values (u, p_paid, 'zz-gai-' || p_tag, 'simulated', 1000, 'INR');
  end if;
  if p_enrolled is not null then
    insert into public.application_manager (application_id, lead_id, application_no, registered_name, registered_email)
    values ('ZZGAI-' || p_tag, u, 'ZZGAI-' || p_tag, 'ZZTEST ' || p_tag, 'zztest-gai-' || lower(p_tag) || '@example.invalid');
    update public.application_manager set enrollment_stage = 'approved', enrollment_paid_at = p_enrolled where application_id = 'ZZGAI-' || p_tag;
  end if;
  return u;
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

create or replace function pg_temp.row_of(p_list jsonb, p_id text)
returns jsonb language sql as $$ select x from jsonb_array_elements(p_list->'rows') x where x->>'id' = p_id $$;

create or replace function pg_temp.run_growth_tests()
returns table (test text, pass boolean, detail text) language plpgsql as $$
declare
  t_name text[] := '{}'; t_pass boolean[] := '{}'; t_det text[] := '{}';
  adm uuid; staff uuid; r jsonb; r2 jsonb; c9 uuid; c10 uuid; cx uuid; a1 uuid; a2 uuid; a3 uuid; a4 uuid; inf uuid; p1 uuid; p2 uuid;
  n int; s text; e text;
  utm9 text := 'https://apply.vedam.org/?utm_source=ZZSRC9&utm_medium=zzmed&utm_campaign=zz%20camp%209';
  utm_other text := 'https://apply.vedam.org/?utm_source=zzsrcX&utm_medium=zzmed&utm_campaign=zzother';
begin
  begin -- rolled back at the end (ZDONE)
    -- test payments are 'simulated' (allowed only on staging, only with this switch, only in this transaction)
    perform set_config('vedam.allow_simulated_payments', 'on', true);
    adm := pg_temp.mk_user('zztest-gai-admin@example.invalid');
    insert into public.user_roles (user_id, role) values (adm, 'admin');
    staff := pg_temp.mk_user('zztest-gai-staff@vedam.org');   -- @vedam.org but not an admin

    -- leads for UTM 9 (window 2026-05-01 .. 2026-05-12, IST)
    perform pg_temp.mk_lead('L1', 'zzsrc9', 'zzmed', 'zz camp 9', '2026-05-02 10:00+05:30', '2026-05-05 10:00+05:30', '2026-07-01 10:00+05:30'); -- in, paid, enrolled
    perform pg_temp.mk_lead('L2', 'zzsrc9', 'zzmed', 'zz camp 9', '2026-05-12 23:30+05:30', '2026-05-20 10:00+05:30');                             -- in (last day IST), paid after window
    perform pg_temp.mk_lead('L3', 'zzsrc9', 'zzmed', 'zz camp 9', '2026-05-01 00:10+05:30');                                                      -- in (first day IST)
    perform pg_temp.mk_lead('L4', 'zzsrc9', 'zzmed', 'zz camp 9', '2026-05-13 00:05+05:30', '2026-05-14 10:00+05:30');                             -- after window, paid
    perform pg_temp.mk_lead('L5', 'zzsrcX', 'zzmed', 'zzother', '2026-05-03 10:00+05:30', '2026-05-04 10:00+05:30');                              -- other UTM
    -- L6: first touch is "other", a later touch is UTM 9 -> belongs to "other" only (primary = first touch)
    perform pg_temp.mk_lead('L6', 'zzsrcX', 'zzmed', 'zzother', '2026-05-03 11:00+05:30');
    update public.lead_manager set utm_source = 'zzsrc9', utm_medium = 'zzmed', utm_campaign = 'zz camp 9' where registered_email = 'zztest-gai-l6@example.invalid';

    -- ════ A. who may use it ════
    r := pg_temp.call_as(null, 'select public.growth_mkt_meta()', true);
    t_name := t_name || text 'A anon cannot call the RPCs'; t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = '42501');
    r := pg_temp.call_as(staff, 'select public.growth_mkt_meta()');
    t_name := t_name || text 'A a @vedam.org login that is not an admin is refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'FORBIDDEN');
    r := pg_temp.call_as(staff, pg_temp.rpc('growth_rows_list', '{"channel":"ads"}'));
    t_name := t_name || text 'A non-admin cannot list rows'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'FORBIDDEN');
    r := pg_temp.call_as(staff, pg_temp.rpc('growth_campaign_save', '{"name":"ZZTEST hack","campaign_start":"2026-01-01","campaign_end":"2026-01-02"}'));
    t_name := t_name || text 'A non-admin cannot create a campaign'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'FORBIDDEN');
    r := pg_temp.call_as(adm, 'select to_jsonb(public.growth__leads(array[''x'']))');
    t_name := t_name || text 'A private helpers are not callable, even by an admin'; t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = '42501');
    r := pg_temp.call_as(adm, 'select to_jsonb(count(*)) from public.growth_ad_rows');
    t_name := t_name || text 'A tables are not readable directly'; t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = '42501');
    r := pg_temp.call_as(adm, 'select public.growth_mkt_meta()');
    t_name := t_name || text 'A admin reads meta (platform lists incl. Instagram Story)'; t_det := t_det || (r - 'campaigns' - 'influencers')::text;
    t_pass := t_pass || (r->'infl_platforms' ? 'Instagram Story' and r->'ad_platforms' = '["Meta","Google"]'::jsonb);

    -- ════ B. campaigns ════
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_campaign_save', '{"name":"ZZTEST VSAT-9","campaign_start":"2026-05-01"}'));
    t_name := t_name || text 'B a campaign needs an end date'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'REQUIRED: campaign_end');
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_campaign_save', '{"name":"ZZTEST VSAT-9","campaign_start":"2026-05-12","campaign_end":"2026-05-01"}'));
    t_name := t_name || text 'B end before start is refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'BAD_VALUE: campaign_end');
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_campaign_save', '{"name":"ZZTEST VSAT-9","campaign_start":"2026-05-01","campaign_end":"2026-05-12"}'));
    t_name := t_name || text 'B a campaign needs its exam date'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'REQUIRED: exam_date');
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_campaign_save', '{"name":"ZZTEST VSAT-9","campaign_start":"01-05-2026","campaign_end":"12/05/2026","exam_date":"2026-05-13","budget":"5,00,000","application_target":400}'));
    c9 := (r->>'id')::uuid;
    t_name := t_name || text 'B campaign saved (DD-MM-YYYY, DD/MM/YYYY and Indian commas accepted)'; t_det := t_det || r::text;
    t_pass := t_pass || (c9 is not null and (select campaign_start = '2026-05-01' and campaign_end = '2026-05-12' and budget = 500000 and application_target = 400 from public.vsat_campaigns where id = c9));
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_campaign_save', '{"name":"zztest vsat-9","campaign_start":"2026-06-01","campaign_end":"2026-06-02","exam_date":"2026-06-03"}'));
    t_name := t_name || text 'B duplicate name (any case) is refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'DUPLICATE');
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_campaign_save', '{"name":"ZZTEST VSAT-10","campaign_start":"2026-31-05","campaign_end":"2026-06-10"}'));
    t_name := t_name || text 'B an impossible date is refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'BAD_VALUE: campaign_start');
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_campaign_save', '{"name":"ZZTEST VSAT-10","campaign_start":"2026-05-13","campaign_end":"2026-05-31","exam_date":"2026-06-01"}'));
    c10 := (r->>'id')::uuid;
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_campaign_save', '{"name":"ZZTEST spare","campaign_start":"2026-01-01","campaign_end":"2026-01-02","exam_date":"2026-01-03"}'));
    cx := (r->>'id')::uuid;
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_campaign_save', '{"name":"ZZTEST spare","campaign_start":"2026-01-01","campaign_end":"2026-01-02","exam_date":"2026-01-03","hack":1}'));
    t_name := t_name || text 'B unknown request keys are refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'UNKNOWN_KEY: hack');

    -- ════ C. ads rows ════
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_row_save', jsonb_build_object('channel', 'ads', 'row', jsonb_build_object('platform', 'Meta', 'campaign', c9))));
    t_name := t_name || text 'C ad name is required'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'REQUIRED: ad_name');
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_row_save', jsonb_build_object('channel', 'ads', 'row', jsonb_build_object('ad_name', 'ZZTEST ad', 'platform', 'Meta'))));
    t_name := t_name || text 'C "Used in" (campaign) is required'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'REQUIRED: campaign');
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_row_save', jsonb_build_object('channel', 'ads', 'row', jsonb_build_object('ad_name', 'ZZTEST ad', 'platform', 'TikTok', 'campaign', c9))));
    t_name := t_name || text 'C only Meta / Google'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'BAD_VALUE: platform');
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_row_save', jsonb_build_object('channel', 'ads', 'row', jsonb_build_object('ad_name', 'ZZTEST ad', 'platform', 'Meta', 'campaign', c9, 'utm_link', 'javascript:alert(1)'))));
    t_name := t_name || text 'C a UTM link must be http(s)'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'BAD_VALUE: utm_link');
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_row_save', jsonb_build_object('channel', 'ads', 'row', jsonb_build_object('ad_name', 'ZZTEST ad', 'platform', 'Meta', 'campaign', 'no such campaign'))));
    t_name := t_name || text 'C an unknown campaign is refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'BAD_VALUE: campaign');
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_row_save', jsonb_build_object('channel', 'ads', 'row', jsonb_build_object('ad_name', 'ZZTEST ad', 'platform', 'Meta', 'campaign', c9, 'leads', 99))));
    t_name := t_name || text 'C leads cannot be typed in (computed only)'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'UNKNOWN_KEY: leads');
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_row_save', jsonb_build_object('channel', 'ads', 'row', jsonb_build_object(
          'ad_name', 'ZZTEST ad A', 'platform', 'google', 'campaign', 'ZZTEST VSAT-9', 'campaign_status', 'Paused', 'live_date', '11-05-2026',
          'spend', '12,011.08', 'utm_link', utm9))));
    a1 := (r->>'id')::uuid;
    t_name := t_name || text 'C ad saved (campaign by name, platform any case, date DD-MM-YYYY, serial auto)'; t_det := t_det || r::text;
    t_pass := t_pass || (select platform = 'Google' and campaign_id = c9 and live_date = '2026-05-11' and spend = 12011.08 and serial_no >= 1 from public.growth_ad_rows where id = a1);
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_row_save', jsonb_build_object('channel', 'ads', 'row', jsonb_build_object(
          'ad_name', 'ZZTEST ad B (same UTM)', 'platform', 'Meta', 'campaign', c9, 'spend', 3000, 'utm_link', utm9))));
    a2 := (r->>'id')::uuid;
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_row_save', jsonb_build_object('channel', 'ads', 'row', jsonb_build_object(
          'ad_name', 'ZZTEST ad C (VSAT-10, same UTM)', 'platform', 'Meta', 'campaign', c10, 'spend', 1000, 'utm_link', utm9))));
    a3 := (r->>'id')::uuid;
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_row_save', jsonb_build_object('channel', 'ads', 'row', jsonb_build_object(
          'ad_name', 'ZZTEST ad D (other)', 'platform', 'Meta', 'campaign', c9, 'spend', 500, 'utm_link', utm_other, 'live_date', '2026-04-01'))));
    a4 := (r->>'id')::uuid;

    -- ════ D. listing attribution ════
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_rows_list', '{"channel":"ads"}'));
    r2 := pg_temp.row_of(r, a1::text);
    t_name := t_name || text 'D in-window = 3 leads (first/last IST day included), 2 paid, 1 enrolled'; t_det := t_det || r2::text;
    t_pass := t_pass || ((r2->>'leads')::int = 3 and (r2->>'payments')::int = 2 and (r2->>'enrollments')::int = 1);
    t_name := t_name || text 'D all-time = 4 leads, 3 paid, 1 enrolled (in-window is a subset)'; t_det := t_det || r2::text;
    t_pass := t_pass || ((r2->>'leads_all')::int = 4 and (r2->>'payments_all')::int = 3 and (r2->>'enrollments_all')::int = 1);
    t_name := t_name || text 'D UTM match ignores case and %20 (link ZZSRC9 + zz%20camp%209 = lead zzsrc9 / zz camp 9)'; t_det := t_det || (r2->>'utm_key');
    t_pass := t_pass || (r2->>'utm_key' = 'zzsrc9/zzmed/zz camp 9');
    r2 := pg_temp.row_of(r, a3::text);
    t_name := t_name || text 'D same UTM in VSAT-10 window: in-window = only the lead after VSAT-9 window (1 lead, 1 paid)'; t_det := t_det || r2::text;
    t_pass := t_pass || ((r2->>'leads')::int = 1 and (r2->>'payments')::int = 1 and (r2->>'leads_all')::int = 4);
    r2 := pg_temp.row_of(r, a4::text);
    t_name := t_name || text 'D primary (first touch) only: the lead that later touched UTM 9 stays with "other" (2 leads)'; t_det := t_det || r2::text;
    t_pass := t_pass || ((r2->>'leads_all')::int = 2 and (r2->>'leads')::int = 2 and (r2->>'payments')::int = 1);
    t_name := t_name || text 'D two rows sharing a UTM carry the same utm_key (cards de-duplicate on it)'; t_det := t_det || text '-';
    t_pass := t_pass || (pg_temp.row_of(r, a1::text)->>'utm_key' = pg_temp.row_of(r, a2::text)->>'utm_key');
    t_name := t_name || text 'D listing returns no lead names, emails or ids'; t_det := t_det || text '-';
    t_pass := t_pass || (r::text not like '%zztest-gai-l1%' and r::text not like '%ZZTEST L1%');

    -- ════ E. custom columns ════
    -- The test's own columns carry a ZZTEST name, so a real column on the database (e.g. the staging demo seed's
    -- "Creative type") cannot collide with them. Every check below is the same as before; only the names differ.
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_column_add', '{"channel":"ads","label":"ZZTEST Creative Type","type":"select","required":true,"options":["Static","Video"," Video "]}'));
    t_name := t_name || text 'E select column added (options de-duplicated)'; t_det := t_det || r::text;
    t_pass := t_pass || (r->>'key' = 'x_zztest_creative_type' and (select options = '["Static","Video"]'::jsonb from public.growth_custom_columns where col_key = 'x_zztest_creative_type' and deleted_at is null));
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_column_add', '{"channel":"ads","label":"ZZTEST Impressions","type":"number"}'));
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_column_add', '{"channel":"ads","label":"zztest creative type","type":"text"}'));
    t_name := t_name || text 'E duplicate column label refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'DUPLICATE');
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_column_add', '{"channel":"ads","label":"Spend","type":"number"}'));
    t_name := t_name || text 'E a label that clashes with a standard column is refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'DUPLICATE');
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_column_add', '{"channel":"ads","label":"Bad","type":"json"}'));
    t_name := t_name || text 'E unknown column type refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'BAD_VALUE: type');
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_row_save', jsonb_build_object('channel', 'ads', 'row', jsonb_build_object('ad_name', 'ZZTEST E', 'platform', 'Meta', 'campaign', c9))));
    t_name := t_name || text 'E a required custom column must be filled on a new row'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'REQUIRED: x_zztest_creative_type');
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_row_save', jsonb_build_object('channel', 'ads', 'row', jsonb_build_object('ad_name', 'ZZTEST E', 'platform', 'Meta', 'campaign', c9,
          'extra', jsonb_build_object('x_zztest_creative_type', 'Carousel')))));
    t_name := t_name || text 'E a select value must be one of the options'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'BAD_VALUE: x_zztest_creative_type');
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_row_save', jsonb_build_object('channel', 'ads', 'row', jsonb_build_object('ad_name', 'ZZTEST E', 'platform', 'Meta', 'campaign', c9,
          'extra', jsonb_build_object('x_zztest_creative_type', 'Video', 'x_zztest_impressions', 'lots')))));
    t_name := t_name || text 'E a number column refuses text'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'BAD_VALUE: x_zztest_impressions');
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_row_save', jsonb_build_object('channel', 'ads', 'row', jsonb_build_object('ad_name', 'ZZTEST E', 'platform', 'Meta', 'campaign', c9,
          'extra', jsonb_build_object('x_zztest_creative_type', 'Video', 'x_nope', '1')))));
    t_name := t_name || text 'E a value for a column that does not exist is refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'UNKNOWN_KEY: x_nope');
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_row_save', jsonb_build_object('channel', 'ads', 'row', jsonb_build_object('ad_name', 'ZZTEST E', 'platform', 'Meta', 'campaign', c9,
          'extra', jsonb_build_object('x_zztest_creative_type', 'Video', 'x_zztest_impressions', '1,20,000')))));
    t_name := t_name || text 'E custom values saved in the database'; t_det := t_det || r::text;
    t_pass := t_pass || (select extra = '{"x_zztest_creative_type":"Video","x_zztest_impressions":"120000"}'::jsonb from public.growth_ad_rows where id = (r->>'id')::uuid);
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_row_save', jsonb_build_object('channel', 'ads', 'row', jsonb_build_object('id', a2, 'ad_name', 'ZZTEST ad B (same UTM)', 'platform', 'Meta', 'campaign', c9, 'spend', 3000, 'utm_link', utm9))));
    t_name := t_name || text 'E an old row must get the required value when it is next edited'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'REQUIRED: x_zztest_creative_type');
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_column_remove', '{"channel":"ads","key":"x_zztest_creative_type"}'));
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_row_save', jsonb_build_object('channel', 'ads', 'row', jsonb_build_object('id', a2, 'ad_name', 'ZZTEST ad B (same UTM)', 'platform', 'Meta', 'campaign', c9, 'spend', 3000, 'utm_link', utm9))));
    t_name := t_name || text 'E after removing the column it is no longer required'; t_det := t_det || r::text; t_pass := t_pass || (r->>'id' = a2::text);
    r := pg_temp.call_as(adm, 'select public.growth_mkt_meta()');
    t_name := t_name || text 'E meta lists the live columns only'; t_det := t_det || (r->'columns')::text;
    t_pass := t_pass || (r->'columns' @> '[{"key":"x_zztest_impressions"}]'::jsonb and not (r->'columns' @> '[{"key":"x_zztest_creative_type"}]'::jsonb));

    -- ════ F. trash ════
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_rows_trash', jsonb_build_object('channel', 'ads', 'ids', jsonb_build_array(a2), 'trash', true)));
    r2 := pg_temp.call_as(adm, pg_temp.rpc('growth_rows_list', '{"channel":"ads","view":"trash"}'));
    t_name := t_name || text 'F trashed row shows in Trash, not in Active'; t_det := t_det || r::text;
    t_pass := t_pass || (pg_temp.row_of(r2, a2::text) is not null and pg_temp.row_of(pg_temp.call_as(adm, pg_temp.rpc('growth_rows_list', '{"channel":"ads"}')), a2::text) is null);
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_rows_trash', jsonb_build_object('channel', 'ads', 'ids', jsonb_build_array(a2), 'trash', false)));
    t_name := t_name || text 'F restore brings it back'; t_det := t_det || r::text;
    t_pass := t_pass || (pg_temp.row_of(pg_temp.call_as(adm, pg_temp.rpc('growth_rows_list', '{"channel":"ads"}')), a2::text) is not null);
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_campaign_delete', jsonb_build_object('id', c9)));
    t_name := t_name || text 'F a campaign in use cannot be deleted'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'IN_USE');
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_campaign_delete', jsonb_build_object('id', cx)));
    t_name := t_name || text 'F an unused campaign can be deleted'; t_det := t_det || r::text; t_pass := t_pass || (r->>'ok' = 'true');

    -- ════ G. CSV import (all or nothing) ════
    select count(*) into n from public.growth_ad_rows;
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_rows_import', jsonb_build_object('channel', 'ads', 'rows', jsonb_build_array(
          jsonb_build_object('ad_name', 'ZZTEST imp 1', 'platform', 'Meta', 'campaign', 'ZZTEST VSAT-9'),
          jsonb_build_object('ad_name', 'ZZTEST imp 2', 'platform', 'Snap', 'campaign', 'ZZTEST VSAT-9')))));
    t_name := t_name || text 'G one bad row: nothing is imported'; t_det := t_det || r::text;
    t_pass := t_pass || (r->>'message' = 'IMPORT_FAILED' and (select count(*) from public.growth_ad_rows) = n);
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
      perform public.growth_rows_import(jsonb_build_object('channel', 'ads', 'rows', jsonb_build_array(
          jsonb_build_object('ad_name', 'ZZTEST imp 1', 'platform', 'Meta', 'campaign', 'ZZTEST VSAT-9'),
          jsonb_build_object('ad_name', 'ZZTEST imp 2', 'platform', 'Snap', 'campaign', 'ZZTEST VSAT-9'))));
      s := 'no error';
    exception when others then get stacked diagnostics s = pg_exception_detail;
    end;
    perform set_config('request.jwt.claims', '', true);
    t_name := t_name || text 'G the error says which row and why'; t_det := t_det || coalesce(s, 'null');
    t_pass := t_pass || (s::jsonb = '[{"row":2,"error":"BAD_VALUE: platform"}]'::jsonb);
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_rows_import', jsonb_build_object('channel', 'ads', 'rows', jsonb_build_array(
          jsonb_build_object('ad_name', 'ZZTEST imp 1', 'platform', 'Meta', 'campaign', 'ZZTEST VSAT-9', 'spend', '1,000'),
          jsonb_build_object('ad_name', 'ZZTEST imp 2', 'platform', 'Google', 'campaign', 'zztest vsat-10', 'live_date', '2026-05-20')))));
    t_name := t_name || text 'G good file imports every row'; t_det := t_det || r::text;
    t_pass := t_pass || ((r->>'inserted')::int = 2 and (select count(*) from public.growth_ad_rows) = n + 2);
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_rows_import', jsonb_build_object('channel', 'ads', 'rows', jsonb_build_array(jsonb_build_object('id', a1, 'ad_name', 'x', 'platform', 'Meta', 'campaign', c9)))));
    t_name := t_name || text 'G import cannot overwrite existing rows (no id)'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'IMPORT_FAILED');

    -- ════ H. performance ════
    -- a1, a2 (VSAT-9) and a3 (VSAT-10) share UTM 9. Since 0113 each lead counts for ONE of them
    -- (see 0113 header / growth_shared_utm.test.sql): L1 and L3 -> a2 (live from the campaign start,
    -- a1 only went live on 05-11), L2 -> a1 (went live most recently before it), L4 -> a3 (its window).
    -- The UTM's totals are unchanged; they are now the sum of a1 + a2 + a3.
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_perf', jsonb_build_object('channel', 'ads', 'campaign_ids', jsonb_build_array(c9))));
    t_name := t_name || text 'H campaign filter = in-window cohort (3 leads, 2 paid, 1 enrolled = a1 + a2, each lead once)';
    t_det := t_det || format('a1=%s a2=%s', pg_temp.row_of(r, a1::text), pg_temp.row_of(r, a2::text));
    t_pass := t_pass || ((select sum((x->>'leads')::int) = 3 and sum((x->>'payments')::int) = 2 and sum((x->>'enrollments')::int) = 1
                            from jsonb_array_elements(r->'rows') x where x->>'id' in (a1::text, a2::text))
                         and (pg_temp.row_of(r, a1::text)->>'leads')::int = 1 and (pg_temp.row_of(r, a2::text)->>'leads')::int = 2);
    t_name := t_name || text 'H campaign filter leaves out other campaigns'' rows'; t_det := t_det || text '-';
    t_pass := t_pass || (pg_temp.row_of(r, a3::text) is null);
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_perf', '{"channel":"ads","from":"2026-05-13","to":"2026-05-31"}'));
    t_name := t_name || text 'H date range = events in the range: 1 lead (L4, a3), 2 payments (L2 on a1 + L4 on a3), 0 enrolled';
    t_det := t_det || format('a1=%s a3=%s', pg_temp.row_of(r, a1::text), pg_temp.row_of(r, a3::text));
    t_pass := t_pass || ((select sum((x->>'leads')::int) = 1 and sum((x->>'payments')::int) = 2 and sum((x->>'enrollments')::int) = 0
                            from jsonb_array_elements(r->'rows') x where x->>'id' in (a1::text, a2::text, a3::text))
                         and (pg_temp.row_of(r, a3::text)->>'leads')::int = 1 and (pg_temp.row_of(r, a1::text)->>'payments')::int = 1);
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_perf', '{"channel":"ads","from":"2026-07-01","to":"2026-07-31"}'));
    r2 := pg_temp.row_of(r, a2::text);
    t_name := t_name || text 'H date range counts the enrolment by its own date (July: 1 enrolled on L1''s ad a2, 0 leads)'; t_det := t_det || coalesce(r2::text, 'null');
    t_pass := t_pass || ((r2->>'enrollments')::int = 1 and (r2->>'leads')::int = 0);
    t_name := t_name || text 'H date range drops a row with no live date and no activity in it'; t_det := t_det || text '-';
    t_pass := t_pass || (pg_temp.row_of(r, a4::text) is null);
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_perf', '{"channel":"ads"}'));
    t_name := t_name || text 'H no filter = all-time (4 leads, 3 paid, 1 enrolled = a1 + a2 + a3, each lead once)';
    t_det := t_det || format('a1=%s a2=%s a3=%s', pg_temp.row_of(r, a1::text), pg_temp.row_of(r, a2::text), pg_temp.row_of(r, a3::text));
    t_pass := t_pass || (select sum((x->>'leads')::int) = 4 and sum((x->>'payments')::int) = 3 and sum((x->>'enrollments')::int) = 1
                           from jsonb_array_elements(r->'rows') x where x->>'id' in (a1::text, a2::text, a3::text));
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_perf', '{"channel":"ads","from":"2026-06-01","to":"2026-05-01"}'));
    t_name := t_name || text 'H to before from is refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'BAD_VALUE: to');
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_weekly', jsonb_build_object('channel', 'ads', 'ids', jsonb_build_array(a1, a2))));
    t_name := t_name || text 'H weekly: two rows sharing a UTM count each of their own leads once (3 leads, 2 paid, 1 enrolled; L4 is a3''s)'; t_det := t_det || r::text;
    t_pass := t_pass || ((select sum((w->>'leads')::int) from jsonb_array_elements(r->'weeks') w) = 3
                        and (select sum((w->>'payments')::int) from jsonb_array_elements(r->'weeks') w) = 2
                        and (select sum((w->>'enrollments')::int) from jsonb_array_elements(r->'weeks') w) = 1);
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_weekly', jsonb_build_object('channel', 'ads', 'ids', jsonb_build_array(a1, a3), 'campaign_id', c10)));
    t_name := t_name || text 'H weekly with a campaign = that campaign''s rows + window (1 lead)'; t_det := t_det || r::text;
    t_pass := t_pass || ((select sum((w->>'leads')::int) from jsonb_array_elements(r->'weeks') w) = 1 and r->>'from' = '2026-05-13');

    -- ════ I. influencers ════
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_influencer_add', '{"name":"ZZTEST Hiten Codes"}'));
    inf := (r->>'id')::uuid;
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_influencer_add', '{"name":"  zztest hiten codes "}'));
    t_name := t_name || text 'I adding the same influencer again returns the existing one'; t_det := t_det || r::text;
    t_pass := t_pass || ((r->>'id')::uuid = inf and r->>'created' = 'false');
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_row_save', jsonb_build_object('channel', 'influencers', 'row', jsonb_build_object('influencer', 'ZZTEST nobody', 'platform', 'YouTube Shorts'))));
    t_name := t_name || text 'I a post needs an influencer from the list'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'BAD_VALUE: influencer');
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_row_save', jsonb_build_object('channel', 'influencers', 'row', jsonb_build_object('influencer', inf, 'platform', 'Facebook'))));
    t_name := t_name || text 'I platform must be a YouTube type or Instagram Reel / Story'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'BAD_VALUE: platform');
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_row_save', jsonb_build_object('channel', 'influencers', 'row', jsonb_build_object(
          'influencer', inf, 'platform', 'YouTube - Dedicated', 'live_status', 'Live', 'live_date', '2026-05-03', 'campaign', c9, 'cost', 25000,
          'live_link', 'https://www.youtube.com/watch?v=zzTEST00001', 'utm_link', utm9, 'expected_views', 50000))));
    p1 := (r->>'id')::uuid;
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_row_save', jsonb_build_object('channel', 'influencers', 'row', jsonb_build_object(
          'influencer', 'zztest hiten codes', 'platform', 'Instagram Story', 'live_status', 'Planned', 'cost', 0, 'notes', 'bulk deal',
          'live_link', 'https://www.instagram.com/stories/zztest/1', 'actual_views', 900))));
    p2 := (r->>'id')::uuid;
    t_name := t_name || text 'I posts saved (influencer by id or name, cost 0 allowed, Instagram views typed in)'; t_det := t_det || r::text;
    t_pass := t_pass || (p1 is not null and p2 is not null and (select actual_views from public.growth_infl_posts where id = p2) = 900);
    r := pg_temp.call_as(adm, 'select public.growth_infl_youtube_targets()');
    t_name := t_name || text 'I YouTube sync targets = YouTube posts with a link only'; t_det := t_det || r::text;
    t_pass := t_pass || (r @> jsonb_build_array(jsonb_build_object('id', p1)) and not (r @> jsonb_build_array(jsonb_build_object('id', p2))));
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_infl_views_set', jsonb_build_object('items', jsonb_build_array(jsonb_build_object('id', p1, 'views', 17200), jsonb_build_object('id', p2, 'views', 5)))));
    t_name := t_name || text 'I view sync updates YouTube posts only and stamps the time'; t_det := t_det || r::text;
    t_pass := t_pass || ((r->>'updated')::int = 1 and (select actual_views = 17200 and views_synced_at is not null from public.growth_infl_posts where id = p1)
                        and (select actual_views = 900 and views_synced_at is null from public.growth_infl_posts where id = p2));
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_rows_list', '{"channel":"influencers"}'));
    r2 := pg_temp.row_of(r, p1::text);
    t_name := t_name || text 'I influencer post attribution: in-window 3 / all-time 4 leads'; t_det := t_det || r2::text;
    t_pass := t_pass || ((r2->>'leads')::int = 3 and (r2->>'leads_all')::int = 4 and r2->>'influencer' = 'ZZTEST Hiten Codes');
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_perf', '{"channel":"influencers","live":"planned"}'));
    t_name := t_name || text 'I performance "Planned" shows planned posts only'; t_det := t_det || r::text;
    t_pass := t_pass || (pg_temp.row_of(r, p2::text) is not null and pg_temp.row_of(r, p1::text) is null);
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_rows_import', jsonb_build_object('channel', 'influencers', 'rows', jsonb_build_array(
          jsonb_build_object('influencer', 'ZZTEST New Creator', 'platform', 'YouTube Shorts', 'campaign', 'ZZTEST VSAT-9')))));
    t_name := t_name || text 'I import adds a new influencer to the list'; t_det := t_det || r::text;
    t_pass := t_pass || ((r->>'inserted')::int = 1 and exists (select 1 from public.growth_influencers where name = 'ZZTEST New Creator'));

    raise exception using errcode = 'ZDONE';
  exception when sqlstate 'ZDONE' then null;
  end;
  return query select * from unnest(t_name, t_pass, t_det);
end $$;

select * from pg_temp.run_growth_tests();

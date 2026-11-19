-- Growth → Campaigns page · tests for migration 0107 (STAGING ONLY)
--
-- How to run: apply 0107 on staging first, then paste this whole file into the staging SQL editor
-- or run it through the Supabase MCP. The last statement returns one row per test: test | pass | detail.
-- Everything is created inside a block that is rolled back at the end (ZDONE): nothing stays.
-- Fake data only (@example.invalid, ZZTEST names).

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


create or replace function pg_temp.run_campaign_tests()
returns table (test text, pass boolean, detail text) language plpgsql as $$
declare
  t_name text[] := '{}'; t_pass boolean[] := '{}'; t_det text[] := '{}';
  adm uuid; staff uuid; r jsonb; r2 jsonb; c1 uuid; c2 uuid; a1 uuid; row1 jsonb; n int;
begin
  begin -- rolled back at the end (ZDONE)
    adm := pg_temp.mk_user('zztest-gcp-admin@example.invalid');
    insert into public.user_roles (user_id, role) values (adm, 'admin');
    staff := pg_temp.mk_user('zztest-gcp-staff@vedam.org');   -- @vedam.org but not an admin

    -- ════ A. who may use it ════
    r := pg_temp.call_as(null, 'select public.growth_campaigns_list()', true);
    t_name := t_name || text 'A anon cannot list campaigns'; t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = '42501');
    r := pg_temp.call_as(staff, 'select public.growth_campaigns_list()');
    t_name := t_name || text 'A a @vedam.org login that is not an admin is refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'FORBIDDEN');
    r := pg_temp.call_as(staff, pg_temp.rpc('growth_campaign_save', '{"name":"ZZTEST hack","campaign_start":"2026-01-01","campaign_end":"2026-01-02","exam_date":"2026-01-03"}'));
    t_name := t_name || text 'A non-admin cannot save'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'FORBIDDEN');

    -- ════ B. create with the new fields ════
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_campaign_save', jsonb_build_object('name', 'ZZTEST VSAT-C1', 'campaign_start', '2026-05-01', 'campaign_end', '2026-05-12',
         'exam_date', '2026-05-20', 'last_date_to_apply', '2026-05-15', 'application_target', 400, 'budget', 500000, 'planned_l2p', 12.5, 'planned_cpp', 8000,
         'metadata', jsonb_build_object('filters', jsonb_build_object('campus_preference', 'ZZ Pune')))));
    c1 := (r->>'id')::uuid;
    t_name := t_name || text 'B create saves all 11 fields'; t_det := t_det || r::text;
    t_pass := t_pass || (c1 is not null and (select last_date_to_apply = '2026-05-15' and planned_l2p = 12.5 and planned_cpp = 8000 and application_target = 400
                           and budget = 500000 and metadata #>> '{filters,campus_preference}' = 'ZZ Pune' from public.vsat_campaigns where id = c1));
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_campaign_save', '{"name":"ZZTEST VSAT-C2","campaign_start":"2026-06-01","campaign_end":"2026-06-10","exam_date":"2026-06-20"}'));
    c2 := (r->>'id')::uuid;
    t_name := t_name || text 'B create without the optional fields: nulls and {}'; t_det := t_det || r::text;
    t_pass := t_pass || (c2 is not null and (select last_date_to_apply is null and planned_l2p is null and planned_cpp is null and metadata = '{}'::jsonb from public.vsat_campaigns where id = c2));

    -- ════ C. validation ════
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_campaign_save', '{"name":"ZZTEST bad","campaign_start":"2026-06-01","campaign_end":"2026-06-10","exam_date":"2026-06-20","planned_l2p":101}'));
    t_name := t_name || text 'C planned L2P above 100 is refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'BAD_VALUE: planned_l2p');
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_campaign_save', '{"name":"ZZTEST bad","campaign_start":"2026-06-01","campaign_end":"2026-06-10","exam_date":"2026-06-20","planned_cpp":-1}'));
    t_name := t_name || text 'C negative planned CPP is refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'BAD_VALUE: planned_cpp');
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_campaign_save', '{"name":"ZZTEST bad","campaign_start":"2026-06-01","campaign_end":"2026-06-10","exam_date":"2026-06-20","last_date_to_apply":"2026-31-05"}'));
    t_name := t_name || text 'C an impossible last date to apply is refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'BAD_VALUE: last_date_to_apply');
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_campaign_save', '{"name":"ZZTEST bad","campaign_start":"2026-06-01","campaign_end":"2026-06-10","exam_date":"2026-06-20","metadata":[1,2]}'));
    t_name := t_name || text 'C metadata must be a JSON object (array refused)'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'BAD_VALUE: metadata');
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_campaign_save', '{"name":"ZZTEST bad","campaign_start":"2026-06-01","campaign_end":"2026-06-10","exam_date":"2026-06-20","metadata":"text"}'));
    t_name := t_name || text 'C metadata must be a JSON object (string refused)'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'BAD_VALUE: metadata');
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_campaign_save', jsonb_build_object('name', 'ZZTEST bad', 'campaign_start', '2026-06-01', 'campaign_end', '2026-06-10',
         'exam_date', '2026-06-20', 'metadata', jsonb_build_object('x', repeat('a', 4100)))));
    t_name := t_name || text 'C an oversized metadata is refused'; t_det := t_det || left(r::text, 120); t_pass := t_pass || (r->>'message' = 'BAD_VALUE: metadata');
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_campaign_save', '{"name":"ZZTEST bad","campaign_start":"2026-06-01","campaign_end":"2026-06-10","exam_date":"2026-06-20","hack":1}'));
    t_name := t_name || text 'C unknown keys are still refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'UNKNOWN_KEY: hack');
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_campaign_save', '{"name":"zztest vsat-c1","campaign_start":"2026-06-01","campaign_end":"2026-06-10","exam_date":"2026-06-20"}'));
    t_name := t_name || text 'C duplicate name (any case) still refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'DUPLICATE');
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_campaign_save', '{"name":"ZZTEST bad","campaign_start":"2026-06-10","campaign_end":"2026-06-01","exam_date":"2026-06-20"}'));
    t_name := t_name || text 'C end before start still refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'BAD_VALUE: campaign_end');
    select count(*) into n from public.vsat_campaigns where name = 'ZZTEST bad';
    t_name := t_name || text 'C a refused save writes nothing'; t_det := t_det || n::text; t_pass := t_pass || (n = 0);

    -- ════ D. edit: absent keys keep, present keys change ════
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_campaign_save', jsonb_build_object('id', c1, 'name', 'ZZTEST VSAT-C1', 'campaign_start', '2026-05-01', 'campaign_end', '2026-05-12',
         'exam_date', '2026-05-20', 'budget', 600000, 'application_target', 450)));
    t_name := t_name || text 'D the old Ads/Influencers dialog (7 keys) edits without wiping the 4 new fields'; t_det := t_det || r::text;
    t_pass := t_pass || ((select budget = 600000 and application_target = 450 and last_date_to_apply = '2026-05-15' and planned_l2p = 12.5 and planned_cpp = 8000
                           and metadata #>> '{filters,campus_preference}' = 'ZZ Pune' from public.vsat_campaigns where id = c1));
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_campaign_save', jsonb_build_object('id', c1, 'name', 'ZZTEST VSAT-C1', 'campaign_start', '2026-05-01', 'campaign_end', '2026-05-12',
         'exam_date', '2026-05-20', 'budget', 600000, 'application_target', 450, 'last_date_to_apply', null, 'planned_l2p', null, 'planned_cpp', '', 'metadata', '{}'::jsonb)));
    t_name := t_name || text 'D sending the new keys empty clears them'; t_det := t_det || r::text;
    t_pass := t_pass || ((select last_date_to_apply is null and planned_l2p is null and planned_cpp is null and metadata = '{}'::jsonb from public.vsat_campaigns where id = c1));
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_campaign_save', jsonb_build_object('id', gen_random_uuid(), 'name', 'ZZTEST ghost', 'campaign_start', '2026-05-01', 'campaign_end', '2026-05-12', 'exam_date', '2026-05-20')));
    t_name := t_name || text 'D editing an unknown id is NOT_FOUND'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'NOT_FOUND');

    -- ════ E. list ════
    r := pg_temp.call_as(adm, 'select public.growth_campaigns_list()');
    t_name := t_name || text 'E list returns every campaign with all fields, newest start first'; t_det := t_det || left(r::text, 200);
    t_pass := t_pass || (jsonb_typeof(r) = 'array'
        and (select x from jsonb_array_elements(r) x where x->>'id' = c2::text) ?& array['id','name','campaign_start','campaign_end','last_date_to_apply','exam_date','application_target','budget','planned_l2p','planned_cpp','metadata','used']
        and (select min(o) from (select ordinality o from jsonb_array_elements(r) with ordinality x where x.value->>'id' = c2::text) q)
            < (select min(o) from (select ordinality o from jsonb_array_elements(r) with ordinality x where x.value->>'id' = c1::text) q));

    -- ════ F. used + delete ════
    a1 := gen_random_uuid();
    insert into public.growth_ad_rows (id, platform, ad_name, campaign_id, serial_no) values (a1, 'Meta', 'ZZTEST ad', c1, (select coalesce(max(serial_no), 0) + 1 from public.growth_ad_rows));
    r := pg_temp.call_as(adm, 'select public.growth_campaigns_list()');
    row1 := (select x from jsonb_array_elements(r) x where x->>'id' = c1::text);
    t_name := t_name || text 'F "used" counts the ad rows'; t_det := t_det || row1::text; t_pass := t_pass || ((row1->>'used')::int = 1);
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_campaign_delete', jsonb_build_object('id', c1)));
    t_name := t_name || text 'F a campaign in use cannot be deleted'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'IN_USE');
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_campaign_delete', jsonb_build_object('id', c2)));
    t_name := t_name || text 'F an unused campaign can be deleted'; t_det := t_det || r::text;
    t_pass := t_pass || (r->>'ok' = 'true' and not exists (select 1 from public.vsat_campaigns where id = c2));

    -- ════ G. table stays closed ════
    r := pg_temp.call_as(adm, 'select to_jsonb(count(*)) from public.vsat_campaigns');
    t_name := t_name || text 'G the table itself is still not readable from the browser role (RLS)'; t_det := t_det || r::text; t_pass := t_pass || (r::text = '0' or r->>'sqlstate' = '42501');

    raise exception using errcode = 'ZDONE';
  exception when sqlstate 'ZDONE' then null;
  end;
  return query select * from unnest(t_name, t_pass, t_det);
end $$;

select * from pg_temp.run_campaign_tests();

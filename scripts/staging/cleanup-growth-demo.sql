-- STAGING ONLY · remove every row created by scripts/staging/seed-growth-demo.sql.
--
-- How: run this whole file once in the STAGING SQL editor (project kyhakenhbgcissmaacws), or via the Supabase MCP.
--      It ends with a check that returns one row per table; every "left_over" must be 0.
--
-- Finds the demo data only by its tags:
--   users     : auth.users with raw_user_meta_data.dummy_seed = 'growth-demo-v1' AND email like 'zzgrowth-%@example.invalid'
--   payments  : vsat_payments.payment_ref like 'growth-demo-%' (provider 'simulated')
--   campaigns : vsat_campaigns.name like '% (Demo)'
--   growth    : growth_ad_rows / growth_infl_posts / growth_influencers / growth_custom_columns tied to the demo
--               (rows on a demo campaign, the 8 demo creators, the 2 demo columns)
-- Deleting the users removes (ON DELETE CASCADE) profiles → lead_manager → application_manager → vsat_pipeline, history.

begin;

do $$ begin
  if coalesce((select value from public.app_flags where key = 'environment'), '') <> 'staging' then
    raise exception 'Refusing to run: this is not the staging database (app_flags.environment <> staging).';
  end if;
end $$;

create temp table zgid on commit drop as
select u.id from auth.users u
where u.raw_user_meta_data->>'dummy_seed' = 'growth-demo-v1' and u.email like 'zzgrowth-%@example.invalid';

create temp table zgkeys on commit drop as
select id::text as k from zgid
union select application_id from public.application_manager where application_id like 'GDEMO-%'
union select id::text from public.vsat_campaigns where name like '% (Demo)';

-- simulated payments (write-once table: only simulated rows can be deleted, and only on staging with this flag)
select set_config('vedam.allow_simulated_payments', 'on', true);
delete from public.vsat_payments p using zgid z where p.lead_id = z.id and p.provider = 'simulated' and p.payment_ref like 'growth-demo-%';

-- growth rows on the demo campaigns, the demo creators and columns
delete from public.growth_ad_rows where campaign_id in (select id from public.vsat_campaigns where name like '% (Demo)');
delete from public.growth_infl_posts where campaign_id in (select id from public.vsat_campaigns where name like '% (Demo)');
delete from public.growth_influencers i
 where (i.channel_link like '%-demo' or i.channel_link like '%.demo')
   and not exists (select 1 from public.growth_infl_posts p where p.influencer_id = i.id);
delete from public.growth_custom_columns where (channel, col_key) in (('ads', 'x_creative_type'), ('influencers', 'x_language'));
delete from public.vsat_campaigns where name like '% (Demo)';

-- tables with no cascade from auth.users
delete from public.profiles_archive x using zgid z where x.id = z.id;
delete from public.signup_failures x using zgid z where x.user_id = z.id;
delete from public.vedam_one_refresh_queue x using zgid z where x.user_id = z.id;

-- the users (cascades to profiles → lead_manager → application_manager → pipeline)
delete from auth.users u using zgid z where u.id = z.id;
delete from public.application_manager where application_id like 'GDEMO-%';

-- the audit rows the seed (and this cleanup) wrote
delete from public.audit_log a
where a.record_id in (select k from zgkeys)
   or coalesce(a.new_data, a.old_data)->>'user_id'        in (select k from zgkeys)
   or coalesce(a.new_data, a.old_data)->>'lead_id'        in (select k from zgkeys)
   or coalesce(a.new_data, a.old_data)->>'application_id' in (select k from zgkeys)
   or coalesce(a.new_data, a.old_data)->>'id'             in (select k from zgkeys);

-- check: every count must be 0
select t, left_over from (
  select 'auth.users' as t, (select count(*) from auth.users where email like 'zzgrowth-%@example.invalid') as left_over
  union all select 'profiles', (select count(*) from public.profiles where email like 'zzgrowth-%@example.invalid')
  union all select 'lead_manager', (select count(*) from public.lead_manager where 'growth_demo' = any (tags) or registered_email like 'zzgrowth-%@example.invalid')
  union all select 'application_manager', (select count(*) from public.application_manager where application_id like 'GDEMO-%')
  union all select 'vsat_pipeline', (select count(*) from public.vsat_pipeline where application_id like 'GDEMO-%')
  union all select 'vsat_stage_history', (select count(*) from public.vsat_stage_history where application_id like 'GDEMO-%')
  union all select 'vsat_payments', (select count(*) from public.vsat_payments where payment_ref like 'growth-demo-%')
  union all select 'vsat_campaigns', (select count(*) from public.vsat_campaigns where name like '% (Demo)')
  union all select 'growth_custom_columns', (select count(*) from public.growth_custom_columns where col_key in ('x_creative_type', 'x_language'))
  union all select 'growth_influencers', (select count(*) from public.growth_influencers where channel_link like '%-demo' or channel_link like '%.demo')
) c;

commit;

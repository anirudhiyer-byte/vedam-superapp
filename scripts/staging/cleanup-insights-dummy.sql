-- STAGING ONLY · remove every row created by scripts/staging/seed-insights-dummy.sql.
--
-- How: run this whole file once in the STAGING SQL editor (project kyhakenhbgcissmaacws).
--      It ends with a check that returns one row per table; every "left" must be 0.
--
-- Finds the dummy data only by its tags — never by date or by guesswork:
--   users  : auth.users with raw_user_meta_data.dummy_seed = 'insights-scale-v1'
--            AND email like 'zzdummy-%@example.invalid' (both must match)
--   events : event_code like 'ZZDUMMY-BC%'
--   traffic: session_id like 'zzdummy-%'
-- Deleting the users removes (ON DELETE CASCADE) their profiles, leads, vedam_one rows,
-- enrolments, lessons, event registrations, bootcamp/codesprint participation, PYQ attempts
-- and VSAT registrations. Tables without a cascade are cleared explicitly first.

begin;

do $$ begin
  if coalesce((select value from public.app_flags where key = 'environment'), '') <> 'staging' then
    raise exception 'Refusing to run: this is not the staging database (app_flags.environment <> staging).';
  end if;
end $$;

create temp table zid on commit drop as
select u.id from auth.users u
where u.raw_user_meta_data->>'dummy_seed' = 'insights-scale-v1' and u.email like 'zzdummy-%@example.invalid';

create temp table zev on commit drop as
select e.id from public.events e where e.event_code like 'ZZDUMMY-BC%';

create temp table zkeys on commit drop as
select id::text as k from zid union select id::text from zev;

-- tables with no cascade from auth.users (or a "set null" one)
delete from public.traffic_events where session_id like 'zzdummy-%';
delete from public.cp_predictions c using zid z where c.user_id = z.id;
delete from public.pyq_events x using zid z where x.user_id = z.id;
delete from public.product_active_daily x using zid z where x.user_id = z.id;
delete from public.profiles_archive x using zid z where x.id = z.id;
delete from public.signup_failures x using zid z where x.user_id = z.id;
delete from public.vedam_one_refresh_queue x using zid z where x.user_id = z.id;

select set_config('vedam.allow_simulated_payments', 'on', true);
delete from public.vsat_payments x using zid z where x.lead_id = z.id and x.provider = 'simulated';

-- the users (cascades to everything else) and the dummy bootcamps
delete from auth.users u using zid z where u.id = z.id;
delete from public.events e using zev z where e.id = z.id;

-- the audit rows the seed (and this cleanup) wrote
delete from public.audit_log a
where a.record_id in (select k from zkeys)
   or coalesce(a.new_data, a.old_data)->>'user_id'  in (select k from zkeys)
   or coalesce(a.new_data, a.old_data)->>'lead_id'  in (select k from zkeys)
   or coalesce(a.new_data, a.old_data)->>'event_id' in (select k from zkeys)
   or coalesce(a.new_data, a.old_data)->>'session_id' like 'zzdummy-%';

-- check: every count must be 0
select t, left_over from (
  select 'auth.users' as t, (select count(*) from auth.users where email like 'zzdummy-%@example.invalid') as left_over
  union all select 'profiles', (select count(*) from public.profiles where email like 'zzdummy-%@example.invalid')
  union all select 'leads', (select count(*) from public.leads where registered_email like 'zzdummy-%@example.invalid')
  union all select 'events', (select count(*) from public.events where event_code like 'ZZDUMMY-BC%')
  union all select 'event_registrations', (select count(*) from public.event_registrations where event_code like 'ZZDUMMY-BC%')
  union all select 'traffic_events', (select count(*) from public.traffic_events where session_id like 'zzdummy-%')
  union all select 'vsat_payments', (select count(*) from public.vsat_payments where payment_ref like 'SIMULATED-ZZDUMMY-%')
  union all select 'cp_predictions', (select count(*) from public.cp_predictions c join zid z on z.id = c.user_id)
  union all select 'product_active_daily', (select count(*) from public.product_active_daily x join zid z on z.id = x.user_id)
  union all select 'pyq_events', (select count(*) from public.pyq_events x join zid z on z.id = x.user_id)
  union all select 'vedam_one', (select count(*) from public.vedam_one x join zid z on z.id = x.user_id)
  union all select 'audit_log', (select count(*) from public.audit_log a where a.record_id in (select k from zkeys)
                                   or coalesce(a.new_data, a.old_data)->>'user_id' in (select k from zkeys)
                                   or coalesce(a.new_data, a.old_data)->>'session_id' like 'zzdummy-%')
) c;

commit;

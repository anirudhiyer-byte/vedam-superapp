-- STAGING ONLY · remove everything create-test-users.sql and the load/integration runs made.
-- Safe to run more than once. Touches only rows tied to pp-load-*@example.invalid accounts,
-- the PPLoad senior and their rate-limit keys.
-- Runs as ONE transaction (needed: the simulated-payment switch below is transaction-local,
-- so `psql -f` without a transaction would stop at the vsat_payments delete). It ends by
-- failing loudly if anything was left behind, so a CI job can't pass with leftovers.

begin;

do $$
begin
  if coalesce((select value from public.app_flags where key = 'environment'), '') <> 'staging' then
    raise exception 'Refusing to run: this is not the staging database (app_flags.environment <> staging).';
  end if;
end $$;

create temp table _load_users on commit drop as
  select id from auth.users where email like 'pp-load-%@example.invalid';
create temp table _load_senior on commit drop as
  select id from public.pp_seniors where contact_email = 'pp-load-senior@example.invalid';

-- simulated payments (only 'simulated' rows can ever be removed)
select set_config('vedam.allow_simulated_payments', 'on', true);
delete from public.vsat_payments where provider = 'simulated' and lead_id in (select id from _load_users);

delete from public.pp_bookings
 where applicant_user_id in (select id from _load_users) or senior_id in (select id from _load_senior);  -- feedback cascades
delete from public.pp_book_attempts where user_id in (select id from _load_users);
delete from public.pp_rate_limits
 where exists (select 1 from _load_users u where public.pp_rate_limits.key like '%' || u.id::text || '%');
delete from public.application_manager where application_id like 'PPLOAD-%';
delete from public.lead_manager where lead_id in (select id from _load_users);
delete from public.profiles where id in (select id from _load_users);
delete from auth.users where id in (select id from _load_users);
delete from public.pp_seniors where id in (select id from _load_senior);  -- availability / days off cascade

do $$
declare n_users int; n_apps int; n_sen int; n_pay int;
begin
  select count(*) into n_users from auth.users where email like 'pp-load-%@example.invalid';
  select count(*) into n_apps from public.application_manager where application_id like 'PPLOAD-%';
  select count(*) into n_sen from public.pp_seniors where contact_email = 'pp-load-senior@example.invalid';
  select count(*) into n_pay from public.vsat_payments p join _load_users u on u.id = p.lead_id;
  if n_users + n_apps + n_sen + n_pay > 0 then
    raise exception 'cleanup incomplete: users=% applications=% senior=% payments=%', n_users, n_apps, n_sen, n_pay;
  end if;
  raise notice 'cleanup complete: 0 load-test users, applications, seniors and payments left';
end $$;

commit;

select (select count(*) from auth.users where email like 'pp-load-%@example.invalid') as load_users_left,
       (select count(*) from public.application_manager where application_id like 'PPLOAD-%') as applications_left,
       (select count(*) from public.pp_seniors where contact_email = 'pp-load-senior@example.invalid') as load_senior_left;

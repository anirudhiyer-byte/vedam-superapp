-- STAGING ONLY · remove every row created by scripts/staging/seed-vsat-pipeline-dummy.sql.
--
-- How: run this whole file once in the STAGING SQL editor (project kyhakenhbgcissmaacws).
--      It ends with a check that returns one row per table; every "left_over" must be 0.
--
-- Finds the dummy data only by its tags — never by date or by guesswork:
--   users        : auth.users with raw_user_meta_data.dummy_seed = 'vsat-pipeline-v1'
--                  AND email like 'zzvsat-%@example.invalid' (both must match)
--   applications : application_id like 'DUMMY-VSAT-%'
--   batches      : vsat_exam_dates.label in ('DUMMY VSAT-A', 'DUMMY VSAT-B') and wheebox_test_id like 'zzdummy-%'
-- Deleting the users removes (ON DELETE CASCADE) profiles → lead_manager → application_manager →
-- vsat_pipeline, vsat_stage_history, vsat_overrides, interview / counselling assignments; and vsat_team.

begin;

do $$ begin
  if coalesce((select value from public.app_flags where key = 'environment'), '') <> 'staging' then
    raise exception 'Refusing to run: this is not the staging database (app_flags.environment <> staging).';
  end if;
end $$;

create temp table zvid on commit drop as
select u.id from auth.users u
where u.raw_user_meta_data->>'dummy_seed' = 'vsat-pipeline-v1' and u.email like 'zzvsat-%@example.invalid';

create temp table zvkeys on commit drop as
select id::text as k from zvid
union select application_id from public.application_manager where application_id like 'DUMMY-VSAT-%'
union select id::text from public.vsat_exam_dates where label in ('DUMMY VSAT-A', 'DUMMY VSAT-B') and wheebox_test_id like 'zzdummy-%';

-- tables with no cascade from auth.users
delete from public.profiles_archive x using zvid z where x.id = z.id;
delete from public.signup_failures x using zvid z where x.user_id = z.id;
delete from public.vedam_one_refresh_queue x using zvid z where x.user_id = z.id;

-- the users (cascades to everything above) and the dummy batches
delete from auth.users u using zvid z where u.id = z.id;
delete from public.application_manager where application_id like 'DUMMY-VSAT-%';
delete from public.vsat_exam_dates where label in ('DUMMY VSAT-A', 'DUMMY VSAT-B') and wheebox_test_id like 'zzdummy-%';

-- the audit rows the seed (and this cleanup) wrote
delete from public.audit_log a
where a.record_id in (select k from zvkeys)
   or coalesce(a.new_data, a.old_data)->>'user_id'        in (select k from zvkeys)
   or coalesce(a.new_data, a.old_data)->>'lead_id'        in (select k from zvkeys)
   or coalesce(a.new_data, a.old_data)->>'application_id' in (select k from zvkeys)
   or coalesce(a.new_data, a.old_data)->>'id'             in (select k from zvkeys);

-- check: every count must be 0
select t, left_over from (
  select 'auth.users' as t, (select count(*) from auth.users where email like 'zzvsat-%@example.invalid') as left_over
  union all select 'profiles', (select count(*) from public.profiles where email like 'zzvsat-%@example.invalid')
  union all select 'lead_manager', (select count(*) from public.lead_manager where registered_email like 'zzvsat-%@example.invalid')
  union all select 'application_manager', (select count(*) from public.application_manager where application_id like 'DUMMY-VSAT-%')
  union all select 'vsat_pipeline', (select count(*) from public.vsat_pipeline where application_id like 'DUMMY-VSAT-%')
  union all select 'vsat_stage_history', (select count(*) from public.vsat_stage_history where application_id like 'DUMMY-VSAT-%')
  union all select 'interview_assignments', (select count(*) from public.interview_assignments where application_id like 'DUMMY-VSAT-%')
  union all select 'counselling_assignments', (select count(*) from public.counselling_assignments where application_id like 'DUMMY-VSAT-%')
  union all select 'vsat_team', (select count(*) from public.vsat_team t join zvid z on z.id = t.user_id)
  union all select 'vsat_exam_dates', (select count(*) from public.vsat_exam_dates where wheebox_test_id like 'zzdummy-%')
  union all select 'audit_log', (select count(*) from public.audit_log a where a.record_id in (select k from zvkeys)
                                   or coalesce(a.new_data, a.old_data)->>'user_id' in (select k from zvkeys)
                                   or coalesce(a.new_data, a.old_data)->>'application_id' in (select k from zvkeys))
) c;

commit;

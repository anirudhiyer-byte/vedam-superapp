-- 0056: College Predictor — enforce the pre-launch gate in the database, not just the page.
--
-- Bug: /predict redirects everyone except admins / confirmed @vedam.org accounts, but the
-- functions behind it (predict_colleges, predict_rounds, save_cp_prediction, log_cp_event)
-- had no check and were executable by anon, so anyone with the public API key could run
-- predictions and write cp_predictions / cp_events rows without ever opening the page.
-- They were also never in a migration; this file captures them.
--
-- Fix: one helper, public.cp_access_allowed(), with exactly the page's rule. The four
-- functions return nothing / do nothing for anyone else (no error, like the pu_* RPCs).
-- Grants: authenticated only (the page requires a login).
--
-- TO GO PUBLIC: change cp_access_allowed() to `select true` (and remove the page guard
-- in src/app/(shell)/predict/page.tsx). If logged-out visitors should be logged too,
-- also grant log_cp_event to anon.

create or replace function public.cp_access_allowed()
 returns boolean
 language sql
 stable
 security definer
 set search_path to ''
as $function$
  select coalesce(public.is_admin(), false)
      or exists (
           select 1 from auth.users u
           where u.id = auth.uid()
             and lower(u.email) like '%@vedam.org'
             and u.email_confirmed_at is not null
         );
$function$;

create or replace function public.predict_colleges(p_rank integer, p_gender text, p_category text, p_state_id integer)
 returns table(institute_id bigint, institute_name text, program_name text, opening_rank bigint, closing_rank bigint, sub_category text, round bigint)
 language sql
 stable
 security definer
 set search_path to ''
as $function$
  select
    ic.institute_id,
    coalesce(i.display_name, i.full_name, 'Unknown') as institute_name,
    ic.program_name, ic.opening_rank, ic.closing_rank, ic.sub_category, ic.round
  from public.institute_cutoffs ic
  join public.institutes i on i.id = ic.institute_id
  where public.cp_access_allowed()
    and ic.closing_rank >= p_rank
    and ic.gender = p_gender
    and ic.category = p_category
    and ic.round = 5
    and (
      ic.sub_category = 'AI'                                        -- All India: everyone
      or (ic.sub_category = 'HS' and i.state_id = p_state_id)       -- Home State: only your state
      or (ic.sub_category = 'OS' and i.state_id <> p_state_id)      -- Other State: only if not your state
      or ic.sub_category in ('GO','JK','LA')                        -- special quotas: keep
    )
  order by ic.closing_rank asc;
$function$;

create or replace function public.predict_rounds(p_institute_id bigint, p_program text, p_category text, p_gender text)
 returns table(round bigint, opening_rank bigint, closing_rank bigint)
 language sql
 stable
 security definer
 set search_path to ''
as $function$
  select ic.round, ic.opening_rank, ic.closing_rank
  from public.institute_cutoffs ic
  where public.cp_access_allowed()
    and ic.institute_id = p_institute_id and ic.program_name = p_program
    and ic.category = p_category and ic.gender = p_gender
  order by ic.round;
$function$;

create or replace function public.save_cp_prediction(p_rank integer, p_marks numeric, p_category text, p_gender text, p_stream text, p_state_id integer, p_year text, p_count integer)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare v uuid := auth.uid();
begin
  if not public.cp_access_allowed() then return; end if;
  insert into public.cp_predictions(user_id, rank, marks, category, gender, stream, state_id, passout_year, result_count)
    values (v, p_rank, p_marks, p_category, p_gender, p_stream, p_state_id, p_year, p_count);
  if v is not null then insert into public.product_usage(user_id, product) values (v, 'college_predictor') on conflict do nothing; end if;
end $function$;

create or replace function public.log_cp_event(p_event text, p_session text default null::text, p_payload jsonb default '{}'::jsonb)
 returns void
 language sql
 security definer
 set search_path to ''
as $function$
  insert into public.cp_events(user_id, session_id, event, payload)
  select auth.uid(), p_session, p_event, coalesce(p_payload, '{}'::jsonb)
  where public.cp_access_allowed();
$function$;

revoke all on function public.cp_access_allowed() from public, anon, authenticated, service_role;
revoke all on function public.predict_colleges(integer, text, text, integer) from public, anon, authenticated, service_role;
revoke all on function public.predict_rounds(bigint, text, text, text) from public, anon, authenticated, service_role;
revoke all on function public.save_cp_prediction(integer, numeric, text, text, text, integer, text, integer) from public, anon, authenticated, service_role;
revoke all on function public.log_cp_event(text, text, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.cp_access_allowed() to authenticated;
grant execute on function public.predict_colleges(integer, text, text, integer) to authenticated;
grant execute on function public.predict_rounds(bigint, text, text, text) to authenticated;
grant execute on function public.save_cp_prediction(integer, numeric, text, text, text, integer, text, integer) to authenticated;
grant execute on function public.log_cp_event(text, text, jsonb) to authenticated;

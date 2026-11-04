-- Rollback for 0056: restore the four College Predictor functions exactly as they were
-- (definitions incl. original CRLF line endings, volatility, grants: executable by everyone,
-- no access check) and drop the cp_access_allowed() helper.

CREATE OR REPLACE FUNCTION public.log_cp_event(p_event text, p_session text DEFAULT NULL::text, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  insert into public.cp_events(user_id, session_id, event, payload) values (auth.uid(), p_session, p_event, coalesce(p_payload, '{}'::jsonb));
$function$;

CREATE OR REPLACE FUNCTION public.predict_colleges(p_rank integer, p_gender text, p_category text, p_state_id integer)
 RETURNS TABLE(institute_id bigint, institute_name text, program_name text, opening_rank bigint, closing_rank bigint, sub_category text, round bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select
    ic.institute_id,
    coalesce(i.display_name, i.full_name, 'Unknown') as institute_name,
    ic.program_name, ic.opening_rank, ic.closing_rank, ic.sub_category, ic.round
  from public.institute_cutoffs ic
  join public.institutes i on i.id = ic.institute_id
  where ic.closing_rank >= p_rank
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

CREATE OR REPLACE FUNCTION public.predict_rounds(p_institute_id bigint, p_program text, p_category text, p_gender text)
 RETURNS TABLE(round bigint, opening_rank bigint, closing_rank bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select ic.round, ic.opening_rank, ic.closing_rank
  from public.institute_cutoffs ic
  where ic.institute_id = p_institute_id and ic.program_name = p_program
    and ic.category = p_category and ic.gender = p_gender
  order by ic.round;
$function$;

CREATE OR REPLACE FUNCTION public.save_cp_prediction(p_rank integer, p_marks numeric, p_category text, p_gender text, p_stream text, p_state_id integer, p_year text, p_count integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v uuid := auth.uid();
begin
  insert into public.cp_predictions(user_id, rank, marks, category, gender, stream, state_id, passout_year, result_count)
    values (v, p_rank, p_marks, p_category, p_gender, p_stream, p_state_id, p_year, p_count);
  if v is not null then insert into public.product_usage(user_id, product) values (v, 'college_predictor') on conflict do nothing; end if;
end $function$;

grant execute on function public.log_cp_event(text, text, jsonb) to public, anon, authenticated, service_role;
grant execute on function public.predict_colleges(integer, text, text, integer) to public, anon, authenticated, service_role;
grant execute on function public.predict_rounds(bigint, text, text, text) to public, anon, authenticated, service_role;
grant execute on function public.save_cp_prediction(integer, numeric, text, text, text, integer, text, integer) to public, anon, authenticated, service_role;
drop function if exists public.cp_access_allowed();

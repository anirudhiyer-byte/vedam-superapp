-- Rollback for 0081_vsat_pipeline_panels.sql (STAGING first).
--
-- Drops the 0081 functions and the columns it added to interview_assignments and
-- counselling_assignments, and puts back the 0080 version of vsat_pipeline_list (copied
-- verbatim from 0080). Lost on the way down: interview form answers and counselling
-- calculation fields typed after 0081 (the rubric scores, weighted average, scholarship %
-- and category stay — those columns existed before). Run before rolling back 0080.

drop function if exists public.vsat_submit_counselling(jsonb);
drop function if exists public.vsat_scholarship_preview(text);
drop function if exists public.vsat_assign_counsellor(jsonb);
drop function if exists public.vsat_submit_interview(jsonb);
drop function if exists public.vsat_assign_interview(jsonb);
drop function if exists public.vsat_student(text);
drop function if exists public.vsat_batches();
drop function if exists public.vsat_team_list();
drop function if exists public.vsat__scholarship_inputs(text);
drop function if exists public.vsat__any_role();
drop function if exists public.vsat__bool(jsonb, text, boolean);
drop function if exists public.vsat__txt(jsonb, text, int, boolean);
drop function if exists public.vsat__num(jsonb, text, numeric, numeric, boolean);

-- 0080 version of the panel list
create or replace function public.vsat_pipeline_list(p jsonb)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare
  uid uuid := auth.uid(); f_admin boolean; f_adm boolean; f_adm_all boolean; adm_campuses text[]; f_int boolean; f_cou boolean;
  f_contact boolean; v_stage text; v_status text; v_date uuid; v_campus text; v_q text; v_limit int; v_offset int;
  total int; rows jsonb; counts jsonb; k text; v_like text;
begin
  if uid is null then raise exception 'NOT_SIGNED_IN' using errcode = '42501'; end if;
  perform public.vsat__check_keys(coalesce(p, '{}'::jsonb), array['stage', 'status', 'exam_date_id', 'campus', 'q', 'limit', 'offset']);
  foreach k in array array['stage', 'status', 'exam_date_id', 'campus', 'q'] loop
    if p ? k and jsonb_typeof(p->k) not in ('string', 'null') then raise exception 'BAD_VALUE: %', k using errcode = '22023'; end if;
  end loop;
  foreach k in array array['limit', 'offset'] loop
    if p ? k and jsonb_typeof(p->k) not in ('number', 'null') then raise exception 'BAD_VALUE: %', k using errcode = '22023'; end if;
  end loop;

  f_admin := coalesce(public.is_admin(), false);
  select bool_or(true), bool_or(t.campus is null), array_agg(t.campus) filter (where t.campus is not null)
    into f_adm, f_adm_all, adm_campuses
    from public.vsat_team t where t.user_id = uid and t.role = 'admissions' and t.active;
  f_adm := coalesce(f_adm, false); f_adm_all := coalesce(f_adm_all, false);
  f_int := exists (select 1 from public.vsat_team t where t.user_id = uid and t.role = 'interviewer' and t.active);
  f_cou := exists (select 1 from public.vsat_team t where t.user_id = uid and t.role = 'counsellor' and t.active);
  if not (f_admin or f_adm or f_int or f_cou) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  f_contact := f_admin or f_adm;

  v_stage := nullif(p->>'stage', '');  v_status := nullif(p->>'status', '');  v_campus := nullif(p->>'campus', '');
  if v_stage is not null and public.vsat__stage_order(v_stage) is null then raise exception 'BAD_STAGE' using errcode = '22023'; end if;
  if v_status is not null and v_status not in ('active', 'not_selected', 'absent', 'on_hold') then raise exception 'BAD_STATUS' using errcode = '22023'; end if;
  if v_campus is not null and v_campus not in ('pune', 'gurugram') then raise exception 'BAD_VALUE: campus' using errcode = '22023'; end if;
  begin v_date := nullif(p->>'exam_date_id', '')::uuid; exception when others then raise exception 'BAD_VALUE: exam_date_id' using errcode = '22023'; end;
  v_q := nullif(btrim(coalesce(p->>'q', '')), '');
  if v_q is not null and (char_length(v_q) < 2 or char_length(v_q) > 100) then raise exception 'BAD_VALUE: q' using errcode = '22023'; end if;
  v_like := replace(replace(replace(coalesce(v_q, ''), '\', '\\'), '%', '\%'), '_', '\_');
  v_limit  := least(greatest(coalesce((p->>'limit')::numeric, 50), 1), 200)::int;
  v_offset := greatest(coalesce((p->>'offset')::numeric, 0), 0)::int;

  with vis as (
    select vp.application_id, vp.attempt_no, vp.stage, vp.status, vp.stage_changed_at,
           public.vsat__campus_key(am.campus_applied) campus
      from public.vsat_pipeline vp join public.application_manager am on am.application_id = vp.application_id
     where (f_admin
            or (f_adm and (f_adm_all or public.vsat__campus_key(am.campus_applied) is null
                           or public.vsat__campus_key(am.campus_applied) = any(adm_campuses)))
            or (f_int and exists (select 1 from public.interview_assignments a where a.application_id = vp.application_id
                                     and a.attempt_no = vp.attempt_no and a.interviewer_id = uid))
            or (f_cou and exists (select 1 from public.counselling_assignments a where a.application_id = vp.application_id
                                     and a.attempt_no = vp.attempt_no and a.counsellor_id = uid)))
       and (v_status is null or vp.status = v_status)
       and (v_date is null or am.exam_date_id = v_date)
       and (v_campus is null or public.vsat__campus_key(am.campus_applied) = v_campus)
       and (v_q is null or am.registered_name ilike '%' || v_like || '%'
                        or (f_contact and (am.registered_email ilike '%' || v_like || '%' or am.registered_mobile like '%' || v_like || '%'))
                        or am.application_no = v_q or am.application_id = v_q)
  ), filt as (
    select * from vis where v_stage is null or vis.stage = v_stage
  ), page as (
    select * from filt order by filt.stage_changed_at desc, filt.application_id limit v_limit offset v_offset
  )
  select (select coalesce(jsonb_object_agg(s.stage, s.n), '{}'::jsonb) from (select vis.stage, count(*) n from vis group by vis.stage) s),
         (select count(*) from filt),
         (select coalesce(jsonb_agg(jsonb_build_object(
             'application_id', pg.application_id, 'application_no', am.application_no, 'name', am.registered_name,
             'email', case when f_contact then am.registered_email end,
             'mobile', case when f_contact then am.registered_mobile end,
             'campus', pg.campus, 'exam_date_id', am.exam_date_id, 'batch', d.label, 'attempt_no', pg.attempt_no,
             'stage', pg.stage, 'status', pg.status, 'stage_changed_at', pg.stage_changed_at,
             'exam_percentile', am.exam_percentile, 'effective', public.vsat__effective(pg.application_id))
             order by pg.stage_changed_at desc, pg.application_id), '[]'::jsonb)
            from page pg join public.application_manager am on am.application_id = pg.application_id
            left join public.vsat_exam_dates d on d.id = am.exam_date_id)
    into counts, total, rows;

  return jsonb_build_object('total', total, 'counts', counts, 'rows', rows, 'limit', v_limit, 'offset', v_offset);
end $$;

revoke all on function public.vsat_pipeline_list(jsonb) from public, anon;
grant execute on function public.vsat_pipeline_list(jsonb) to authenticated;

alter table public.counselling_assignments
  drop column if exists calc_score, drop column if exists calc_case, drop column if exists calc_category,
  drop column if exists award_steps, drop column if exists chosen_step, drop column if exists jee_floor,
  drop column if exists special_rating, drop column if exists bonus_applied, drop column if exists calculated_pct,
  drop column if exists actual_pct, drop column if exists actual_reason, drop column if exists counsellor_remarks,
  drop column if exists calc_inputs, drop column if exists submitted_at, drop column if exists submitted_by;

alter table public.interview_assignments
  drop column if exists remarks, drop column if exists cheating_seen, drop column if exists coding_talent,
  drop column if exists cert_asked, drop column if exists drop_year, drop column if exists previous_jee,
  drop column if exists jee_pct, drop column if exists jee_maths_pct, drop column if exists expected_jee_pct,
  drop column if exists other_exams, drop column if exists class10_pct, drop column if exists class11_pct,
  drop column if exists class12_pct, drop column if exists financial_capability, drop column if exists financial_reason,
  drop column if exists interviewer_verdict, drop column if exists calc_verdict, drop column if exists why_accept,
  drop column if exists weights_from, drop column if exists submitted_at, drop column if exists submitted_by;

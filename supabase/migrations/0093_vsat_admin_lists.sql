-- 0093 · VSAT admin lists — "VSAT Leads" and "VSAT Applications" panels.
--
-- Two read RPCs that back the admin panels:
--   • vsat_leads_list        — everyone who filled the first half (a lead_manager row)
--   • vsat_applications_list — everyone who reached the application stage (an application_manager
--                              row), REGARDLESS of payment / exam-date (paid + booked are badges).
--
-- These are intentionally NOT the exam pipeline (vsat_pipeline, which only lists from
-- exam-booking onward). Gating mirrors vsat_pipeline_list: admin or an active 'admissions'
-- team member (campus-scoped). Interviewers/counsellors use the pipeline panels.
--
-- Security: SECURITY DEFINER + search_path '' + revoke public/anon + grant authenticated;
-- the DB re-checks the caller on every call. Rollback: supabase/rollback/0093_vsat_admin_lists_down.sql

-- ── VSAT Leads ───────────────────────────────────────────────────────────────────────────
create or replace function public.vsat_leads_list(p jsonb)
returns jsonb language plpgsql stable security definer set search_path to '' as $fn$
declare
  uid uuid := auth.uid();
  f_admin boolean; f_adm boolean; f_adm_all boolean; adm_campuses text[];
  v_campus text; v_q text; v_stage text; v_limit int; v_offset int; v_like text;
  total int; rows jsonb;
begin
  if uid is null then raise exception 'NOT_SIGNED_IN' using errcode = '42501'; end if;
  perform public.vsat__check_keys(coalesce(p, '{}'::jsonb), array['campus', 'q', 'lead_stage', 'limit', 'offset']);

  f_admin := coalesce(public.is_admin(), false);
  select bool_or(true), bool_or(t.campus is null), array_agg(t.campus) filter (where t.campus is not null)
    into f_adm, f_adm_all, adm_campuses
    from public.vsat_team t where t.user_id = uid and t.role = 'admissions' and t.active;
  f_adm := coalesce(f_adm, false); f_adm_all := coalesce(f_adm_all, false);
  if not (f_admin or f_adm) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;

  v_campus := nullif(p->>'campus', '');
  if v_campus is not null and v_campus not in ('pune', 'gurugram') then raise exception 'BAD_VALUE: campus' using errcode = '22023'; end if;
  v_stage := nullif(p->>'lead_stage', '');
  v_q := nullif(btrim(coalesce(p->>'q', '')), '');
  if v_q is not null and (char_length(v_q) < 2 or char_length(v_q) > 100) then raise exception 'BAD_VALUE: q' using errcode = '22023'; end if;
  v_like := replace(replace(replace(coalesce(v_q, ''), '\', '\\'), '%', '\%'), '_', '\_');
  v_limit  := least(greatest(coalesce((p->>'limit')::numeric, 50), 1), 200)::int;
  v_offset := greatest(coalesce((p->>'offset')::numeric, 0), 0)::int;

  with vis as (
    select l.* from public.lead_manager l
     where (f_admin or f_adm_all
            or public.vsat__campus_key(l.campus_preference) is null
            or public.vsat__campus_key(l.campus_preference) = any(adm_campuses))
       and (v_campus is null or public.vsat__campus_key(l.campus_preference) = v_campus)
       and (v_stage is null or l.lead_stage::text = v_stage)
       and (v_q is null or l.registered_name ilike '%' || v_like || '%'
                        or l.registered_email ilike '%' || v_like || '%'
                        or l.registered_mobile like '%' || v_like || '%')
  ), page as (
    select * from vis order by vis.user_registration_date desc nulls last, vis.lead_id limit v_limit offset v_offset
  )
  select (select count(*) from vis),
         (select coalesce(jsonb_agg(jsonb_build_object(
             'lead_id', pg.lead_id, 'name', pg.registered_name, 'email', pg.registered_email, 'mobile', pg.registered_mobile,
             'campus', public.vsat__campus_key(pg.campus_preference), 'lead_stage', pg.lead_stage::text,
             'lead_source', pg.lead_source, 'source_hearabout', pg.source_hearabout,
             'application_submitted', pg.application_submitted,
             'primary_utm', pg.primary_utm, 'secondary_utm', pg.secondary_utm, 'tertiary_utm', pg.tertiary_utm, 'latest_utm', pg.latest_utm,
             'primary_utm_source', pg.primary_utm_source, 'primary_utm_medium', pg.primary_utm_medium, 'primary_utm_campaign', pg.primary_utm_campaign,
             'created_at', pg.user_registration_date)
             order by pg.user_registration_date desc nulls last, pg.lead_id), '[]'::jsonb)
            from page pg)
    into total, rows;

  return jsonb_build_object('total', total, 'rows', rows, 'limit', v_limit, 'offset', v_offset);
end $fn$;

revoke all on function public.vsat_leads_list(jsonb) from public, anon;
grant execute on function public.vsat_leads_list(jsonb) to authenticated;

-- ── VSAT Applications ────────────────────────────────────────────────────────────────────
create or replace function public.vsat_applications_list(p jsonb)
returns jsonb language plpgsql stable security definer set search_path to '' as $fn$
declare
  uid uuid := auth.uid();
  f_admin boolean; f_adm boolean; f_adm_all boolean; adm_campuses text[];
  v_campus text; v_q text; v_paid text; v_limit int; v_offset int; v_like text;
  total int; rows jsonb;
begin
  if uid is null then raise exception 'NOT_SIGNED_IN' using errcode = '42501'; end if;
  perform public.vsat__check_keys(coalesce(p, '{}'::jsonb), array['campus', 'q', 'paid', 'limit', 'offset']);

  f_admin := coalesce(public.is_admin(), false);
  select bool_or(true), bool_or(t.campus is null), array_agg(t.campus) filter (where t.campus is not null)
    into f_adm, f_adm_all, adm_campuses
    from public.vsat_team t where t.user_id = uid and t.role = 'admissions' and t.active;
  f_adm := coalesce(f_adm, false); f_adm_all := coalesce(f_adm_all, false);
  if not (f_admin or f_adm) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;

  v_campus := nullif(p->>'campus', '');
  if v_campus is not null and v_campus not in ('pune', 'gurugram') then raise exception 'BAD_VALUE: campus' using errcode = '22023'; end if;
  v_paid := nullif(p->>'paid', '');
  if v_paid is not null and v_paid not in ('paid', 'unpaid') then raise exception 'BAD_VALUE: paid' using errcode = '22023'; end if;
  v_q := nullif(btrim(coalesce(p->>'q', '')), '');
  if v_q is not null and (char_length(v_q) < 2 or char_length(v_q) > 100) then raise exception 'BAD_VALUE: q' using errcode = '22023'; end if;
  v_like := replace(replace(replace(coalesce(v_q, ''), '\', '\\'), '%', '\%'), '_', '\_');
  v_limit  := least(greatest(coalesce((p->>'limit')::numeric, 50), 1), 200)::int;
  v_offset := greatest(coalesce((p->>'offset')::numeric, 0), 0)::int;

  with vis as (
    select am.*, exists (select 1 from public.vsat_payments vp where vp.lead_id = am.lead_id) as is_paid
      from public.application_manager am
     where (f_admin or f_adm_all
            or public.vsat__campus_key(am.campus_applied) is null
            or public.vsat__campus_key(am.campus_applied) = any(adm_campuses))
       and (v_campus is null or public.vsat__campus_key(am.campus_applied) = v_campus)
       and (v_q is null or am.registered_name ilike '%' || v_like || '%'
                        or am.registered_email ilike '%' || v_like || '%'
                        or am.registered_mobile like '%' || v_like || '%'
                        or am.application_no = v_q or am.application_id = v_q)
  ), filt as (
    select * from vis where v_paid is null or (v_paid = 'paid' and vis.is_paid) or (v_paid = 'unpaid' and not vis.is_paid)
  ), page as (
    select * from filt order by filt.created_at desc nulls last, filt.application_id limit v_limit offset v_offset
  )
  select (select count(*) from filt),
         (select coalesce(jsonb_agg(jsonb_build_object(
             'application_id', pg.application_id, 'application_no', pg.application_no, 'name', pg.registered_name,
             'email', pg.registered_email, 'mobile', pg.registered_mobile, 'campus', public.vsat__campus_key(pg.campus_applied),
             'stream', pg.class_12_stream, 'year', pg.class12_year, 'state', pg.state, 'city', pg.city,
             'payment_stage', pg.payment_stage_1::text, 'application_stage', pg.application_stage_1::text,
             'paid', pg.is_paid, 'booked', (pg.exam_date_id is not null), 'exam_given', coalesce(pg.exam_given, false),
             'payment_amount', pg.payment_amount,
             'primary_utm', pg.primary_utm, 'secondary_utm', pg.secondary_utm, 'tertiary_utm', pg.tertiary_utm, 'latest_utm', pg.latest_utm,
             'primary_utm_source', pg.primary_utm_source, 'primary_utm_medium', pg.primary_utm_medium, 'primary_utm_campaign', pg.primary_utm_campaign,
             'created_at', pg.created_at)
             order by pg.created_at desc nulls last, pg.application_id), '[]'::jsonb)
            from page pg)
    into total, rows;

  return jsonb_build_object('total', total, 'rows', rows, 'limit', v_limit, 'offset', v_offset);
end $fn$;

revoke all on function public.vsat_applications_list(jsonb) from public, anon;
grant execute on function public.vsat_applications_list(jsonb) to authenticated;

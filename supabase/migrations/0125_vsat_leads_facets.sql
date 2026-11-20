-- 0125 · VSAT Leads — facet dropdowns (campus / lead stage / applied / source) with live counts.
--
-- Brings the "VSAT Leads" panel to light parity with the applicants grid: the same multi-select
-- dropdown UX, each option carrying a count that respects the other dropdowns (facets). Only
-- vsat_leads_list changes; vsat_applications_list (same file in 0093) is untouched.
--
-- New request keys (all optional; the old `campus` / `lead_stage` scalars still work):
--   campuses   text[]  — ['pune','gurugram']
--   lead_stages text[] — validated against the vm_lead_stage label set
--   applied    text    — 'yes' | 'no'  (application_submitted)
--   sources    text[]  — lead_source values (free text; length-capped, never used to build SQL)
-- Response gains `facets`: { campus, lead_stage, applied:{yes,no}, source }.
--
-- Security unchanged: admin or active 'admissions' only, campus-scoped; SECURITY DEFINER,
-- search_path '', revoke public/anon + grant authenticated. No dynamic SQL is added.
-- Rollback: supabase/rollback/0125_vsat_leads_facets_down.sql (restores the 0093 body).

create or replace function public.vsat_leads_list(p jsonb)
returns jsonb language plpgsql stable security definer set search_path to '' as $fn$
declare
  uid uuid := auth.uid();
  f_admin boolean; f_adm boolean; f_adm_all boolean; adm_campuses text[];
  v_campus text; v_q text; v_stage text; v_limit int; v_offset int; v_like text;
  v_campuses text[]; v_stages text[]; v_sources text[]; v_applied text; v_app_bool boolean; s text;
  total int; rows jsonb; facets jsonb;
begin
  if uid is null then raise exception 'NOT_SIGNED_IN' using errcode = '42501'; end if;
  perform public.vsat__check_keys(coalesce(p, '{}'::jsonb),
    array['campus', 'campuses', 'q', 'lead_stage', 'lead_stages', 'applied', 'sources', 'limit', 'offset']);

  f_admin := coalesce(public.is_admin(), false);
  select bool_or(true), bool_or(t.campus is null), array_agg(t.campus) filter (where t.campus is not null)
    into f_adm, f_adm_all, adm_campuses
    from public.vsat_team t where t.user_id = uid and t.role = 'admissions' and t.active;
  f_adm := coalesce(f_adm, false); f_adm_all := coalesce(f_adm_all, false);
  if not (f_admin or f_adm) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;

  -- campus: scalar (back-compat) folded into the array
  v_campus := nullif(p->>'campus', '');
  if v_campus is not null and v_campus not in ('pune', 'gurugram') then raise exception 'BAD_VALUE: campus' using errcode = '22023'; end if;
  select array_agg(x) into v_campuses from jsonb_array_elements_text(coalesce(p->'campuses', '[]'::jsonb)) x;
  if v_campuses is null and v_campus is not null then v_campuses := array[v_campus]; end if;
  if v_campuses is not null then foreach s in array v_campuses loop
    if s not in ('pune', 'gurugram') then raise exception 'BAD_VALUE: campuses' using errcode = '22023'; end if; end loop; end if;

  -- lead stage: scalar (back-compat) folded into the array; each checked against the enum label set
  v_stage := nullif(p->>'lead_stage', '');
  select array_agg(x) into v_stages from jsonb_array_elements_text(coalesce(p->'lead_stages', '[]'::jsonb)) x;
  if v_stages is null and v_stage is not null then v_stages := array[v_stage]; end if;
  if v_stages is not null then
    if coalesce(array_length(v_stages, 1), 0) > 20 then raise exception 'BAD_VALUE: lead_stages' using errcode = '22023'; end if;
    foreach s in array v_stages loop
      if not (s = any(enum_range(null::public.vm_lead_stage)::text[])) then raise exception 'BAD_VALUE: lead_stages' using errcode = '22023'; end if;
    end loop;
  end if;

  -- applied (application_submitted)
  v_applied := nullif(p->>'applied', '');
  if v_applied is not null and v_applied not in ('yes', 'no') then raise exception 'BAD_VALUE: applied' using errcode = '22023'; end if;
  v_app_bool := case v_applied when 'yes' then true when 'no' then false else null end;

  -- sources (free-text lead_source; length-capped, compared as values only)
  select array_agg(x) into v_sources from jsonb_array_elements_text(coalesce(p->'sources', '[]'::jsonb)) x where btrim(x) <> '';
  if v_sources is not null then
    if coalesce(array_length(v_sources, 1), 0) > 50 then raise exception 'BAD_VALUE: sources' using errcode = '22023'; end if;
    foreach s in array v_sources loop if char_length(s) > 100 then raise exception 'BAD_VALUE: sources' using errcode = '22023'; end if; end loop;
  end if;

  v_q := nullif(btrim(coalesce(p->>'q', '')), '');
  if v_q is not null and (char_length(v_q) < 2 or char_length(v_q) > 100) then raise exception 'BAD_VALUE: q' using errcode = '22023'; end if;
  v_like := replace(replace(replace(coalesce(v_q, ''), '\', '\\'), '%', '\%'), '_', '\_');
  v_limit  := least(greatest(coalesce((p->>'limit')::numeric, 50), 1), 200)::int;
  v_offset := greatest(coalesce((p->>'offset')::numeric, 0), 0)::int;

  with vis as materialized (
    select l.lead_id, l.registered_name, l.registered_email, l.registered_mobile, l.lead_source, l.source_hearabout,
           l.application_submitted, l.primary_utm, l.secondary_utm, l.tertiary_utm, l.latest_utm,
           l.primary_utm_source, l.primary_utm_medium, l.primary_utm_campaign, l.user_registration_date,
           public.vsat__campus_key(l.campus_preference) k_campus, l.lead_stage::text k_stage,
           coalesce(l.application_submitted, false) k_applied, l.lead_source k_source
      from public.lead_manager l
     where (f_admin or f_adm_all
            or public.vsat__campus_key(l.campus_preference) is null
            or public.vsat__campus_key(l.campus_preference) = any(adm_campuses))
       and (v_q is null or l.registered_name ilike '%' || v_like || '%'
                        or l.registered_email ilike '%' || v_like || '%'
                        or l.registered_mobile like '%' || v_like || '%')
  ), base as materialized (
    select * from vis
     where (v_campuses is null or vis.k_campus = any(v_campuses))
       and (v_stages is null or vis.k_stage = any(v_stages))
       and (v_app_bool is null or vis.k_applied = v_app_bool)
       and (v_sources is null or vis.k_source = any(v_sources))
  ), page as (
    select * from base order by base.user_registration_date desc nulls last, base.lead_id limit v_limit offset v_offset
  )
  select (select count(*) from base),
         jsonb_build_object(
           'campus', (select coalesce(jsonb_object_agg(coalesce(x.k_campus, 'none'), x.n), '{}'::jsonb) from (
                        select vis.k_campus, count(*) n from vis
                         where (v_stages is null or vis.k_stage = any(v_stages)) and (v_app_bool is null or vis.k_applied = v_app_bool)
                           and (v_sources is null or vis.k_source = any(v_sources)) group by vis.k_campus) x),
           'lead_stage', (select coalesce(jsonb_object_agg(coalesce(x.k_stage, 'none'), x.n), '{}'::jsonb) from (
                        select vis.k_stage, count(*) n from vis
                         where (v_campuses is null or vis.k_campus = any(v_campuses)) and (v_app_bool is null or vis.k_applied = v_app_bool)
                           and (v_sources is null or vis.k_source = any(v_sources)) group by vis.k_stage) x),
           'applied', (select jsonb_build_object('yes', count(*) filter (where x.k_applied), 'no', count(*) filter (where not x.k_applied)) from (
                        select vis.k_applied from vis
                         where (v_campuses is null or vis.k_campus = any(v_campuses)) and (v_stages is null or vis.k_stage = any(v_stages))
                           and (v_sources is null or vis.k_source = any(v_sources))) x),
           'source', (select coalesce(jsonb_object_agg(coalesce(x.k_source, 'none'), x.n), '{}'::jsonb) from (
                        select vis.k_source, count(*) n from vis
                         where (v_campuses is null or vis.k_campus = any(v_campuses)) and (v_stages is null or vis.k_stage = any(v_stages))
                           and (v_app_bool is null or vis.k_applied = v_app_bool) group by vis.k_source) x)),
         (select coalesce(jsonb_agg(jsonb_build_object(
             'lead_id', pg.lead_id, 'name', pg.registered_name, 'email', pg.registered_email, 'mobile', pg.registered_mobile,
             'campus', pg.k_campus, 'lead_stage', pg.k_stage,
             'lead_source', pg.lead_source, 'source_hearabout', pg.source_hearabout,
             'application_submitted', pg.application_submitted,
             'primary_utm', pg.primary_utm, 'secondary_utm', pg.secondary_utm, 'tertiary_utm', pg.tertiary_utm, 'latest_utm', pg.latest_utm,
             'primary_utm_source', pg.primary_utm_source, 'primary_utm_medium', pg.primary_utm_medium, 'primary_utm_campaign', pg.primary_utm_campaign,
             'created_at', pg.user_registration_date)
             order by pg.user_registration_date desc nulls last, pg.lead_id), '[]'::jsonb)
            from page pg)
    into total, facets, rows;

  return jsonb_build_object('total', total, 'facets', facets, 'rows', rows, 'limit', v_limit, 'offset', v_offset);
end $fn$;

revoke all on function public.vsat_leads_list(jsonb) from public, anon;
grant execute on function public.vsat_leads_list(jsonb) to authenticated;

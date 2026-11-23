-- 0154 · vsat_leads_export — the whole filtered VSAT Leads set, for CSV export + Communicate.
--
-- Mirrors vsat_leads_list's admin/admissions gate, campus scope and filters exactly, but returns
-- ALL matching leads (no pagination, no facets) up to a 5000 cap — the same shape the Leads panel
-- already renders. Powers the Export CSV + Send Communication actions, matching the VSAT
-- Applications grid (vsat_grid_export). Read-only; the DB re-checks role + campus on every call.
-- Rollback: supabase/rollback/0154_vsat_leads_export_down.sql

create or replace function public.vsat_leads_export(p jsonb)
returns jsonb language plpgsql stable security definer set search_path to '' as $function$
declare
  uid uuid := auth.uid();
  f_admin boolean; f_adm boolean; f_adm_all boolean; adm_campuses text[];
  v_campus text; v_q text; v_stage text; v_like text;
  v_campuses text[]; v_stages text[]; v_sources text[]; v_applied text; v_app_bool boolean; s text;
  total int; rows jsonb;
begin
  if uid is null then raise exception 'NOT_SIGNED_IN' using errcode = '42501'; end if;
  perform public.vsat__check_keys(coalesce(p, '{}'::jsonb),
    array['campus', 'campuses', 'q', 'lead_stage', 'lead_stages', 'applied', 'sources']);

  f_admin := coalesce(public.is_admin(), false);
  select bool_or(true), bool_or(t.campus is null), array_agg(t.campus) filter (where t.campus is not null)
    into f_adm, f_adm_all, adm_campuses
    from public.vsat_team t where t.user_id = uid and t.role = 'admissions' and t.active;
  f_adm := coalesce(f_adm, false); f_adm_all := coalesce(f_adm_all, false);
  if not (f_admin or f_adm) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;

  v_campus := nullif(p->>'campus', '');
  if v_campus is not null and v_campus not in ('pune', 'gurugram') then raise exception 'BAD_VALUE: campus' using errcode = '22023'; end if;
  select array_agg(x) into v_campuses from jsonb_array_elements_text(coalesce(p->'campuses', '[]'::jsonb)) x;
  if v_campuses is null and v_campus is not null then v_campuses := array[v_campus]; end if;
  if v_campuses is not null then foreach s in array v_campuses loop
    if s not in ('pune', 'gurugram') then raise exception 'BAD_VALUE: campuses' using errcode = '22023'; end if; end loop; end if;

  v_stage := nullif(p->>'lead_stage', '');
  select array_agg(x) into v_stages from jsonb_array_elements_text(coalesce(p->'lead_stages', '[]'::jsonb)) x;
  if v_stages is null and v_stage is not null then v_stages := array[v_stage]; end if;
  if v_stages is not null then
    if coalesce(array_length(v_stages, 1), 0) > 20 then raise exception 'BAD_VALUE: lead_stages' using errcode = '22023'; end if;
    foreach s in array v_stages loop
      if not (s = any(enum_range(null::public.vm_lead_stage)::text[])) then raise exception 'BAD_VALUE: lead_stages' using errcode = '22023'; end if;
    end loop;
  end if;

  v_applied := nullif(p->>'applied', '');
  if v_applied is not null and v_applied not in ('yes', 'no') then raise exception 'BAD_VALUE: applied' using errcode = '22023'; end if;
  v_app_bool := case v_applied when 'yes' then true when 'no' then false else null end;

  select array_agg(x) into v_sources from jsonb_array_elements_text(coalesce(p->'sources', '[]'::jsonb)) x where btrim(x) <> '';
  if v_sources is not null then
    if coalesce(array_length(v_sources, 1), 0) > 50 then raise exception 'BAD_VALUE: sources' using errcode = '22023'; end if;
    foreach s in array v_sources loop if char_length(s) > 100 then raise exception 'BAD_VALUE: sources' using errcode = '22023'; end if; end loop;
  end if;

  v_q := nullif(btrim(coalesce(p->>'q', '')), '');
  if v_q is not null and (char_length(v_q) < 2 or char_length(v_q) > 100) then raise exception 'BAD_VALUE: q' using errcode = '22023'; end if;
  v_like := replace(replace(replace(coalesce(v_q, ''), '\', '\\'), '%', '\%'), '_', '\_');

  with base as materialized (
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
  ), filtered as materialized (
    select * from base
     where (v_campuses is null or base.k_campus = any(v_campuses))
       and (v_stages is null or base.k_stage = any(v_stages))
       and (v_app_bool is null or base.k_applied = v_app_bool)
       and (v_sources is null or base.k_source = any(v_sources))
  )
  select count(*) into total from filtered;
  if total > 5000 then raise exception 'TOO_MANY_ROWS' using errcode = '54000'; end if;

  with base as materialized (
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
  ), filtered as materialized (
    select * from base
     where (v_campuses is null or base.k_campus = any(v_campuses))
       and (v_stages is null or base.k_stage = any(v_stages))
       and (v_app_bool is null or base.k_applied = v_app_bool)
       and (v_sources is null or base.k_source = any(v_sources))
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'lead_id', f.lead_id, 'name', f.registered_name, 'email', f.registered_email, 'mobile', f.registered_mobile,
      'campus', f.k_campus, 'lead_stage', f.k_stage, 'lead_source', f.lead_source, 'source_hearabout', f.source_hearabout,
      'application_submitted', f.application_submitted,
      'primary_utm', f.primary_utm, 'secondary_utm', f.secondary_utm, 'tertiary_utm', f.tertiary_utm, 'latest_utm', f.latest_utm,
      'primary_utm_source', f.primary_utm_source, 'primary_utm_medium', f.primary_utm_medium, 'primary_utm_campaign', f.primary_utm_campaign,
      'created_at', f.user_registration_date)
      order by f.user_registration_date desc nulls last, f.lead_id), '[]'::jsonb)
    into rows from filtered f;

  return jsonb_build_object('total', total, 'rows', rows);
end $function$;
revoke all on function public.vsat_leads_export(jsonb) from public, anon;
grant execute on function public.vsat_leads_export(jsonb) to authenticated;
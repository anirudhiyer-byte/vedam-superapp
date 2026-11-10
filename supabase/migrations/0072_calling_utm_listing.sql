-- 0072 · Calling CRM — UTM Listing aggregate for the Calling channel's "UTM Listing"
-- panel. Admin-only, SECURITY DEFINER, search_path='', revoked from public/anon.
-- Tracks a caller-shared UTM down the funnel: leads → link shared → registered on
-- Vedam One (linked_profile_id) → VSAT paid → application created → enrolled.

create or replace function public.calling_utm_listing(p jsonb default '{}')
returns jsonb language plpgsql stable security definer set search_path to '' as $fn$
declare v_search text := nullif(btrim(p->>'search'),'');
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode='42501'; end if;
  return (
    with base as (
      select cl.id, cl.utm_source, cl.utm_medium, cl.utm_campaign,
             (cl.remarks ilike '%link%') as shared,
             (cl.linked_profile_id is not null) as registered,
             cl.vsat_paid,
             (am.lead_id is not null) as has_app,
             (am.application_stage_1 = 'enrolled' or am.application_stage_2 = 'enrolled') as enrolled
      from public.calling_leads cl
      left join public.application_manager am on am.lead_id = cl.linked_profile_id
      where not cl.is_trashed
        and (v_search is null
             or coalesce(cl.utm_campaign,'') ilike '%'||v_search||'%'
             or coalesce(cl.utm_source,'') ilike '%'||v_search||'%'
             or coalesce(cl.utm_medium,'') ilike '%'||v_search||'%')
    ), grp as (
      select coalesce(utm_source,'(none)') as utm_source,
             coalesce(utm_medium,'(none)') as utm_medium,
             coalesce(utm_campaign,'(none)') as utm_campaign,
             count(distinct id) as leads,
             count(distinct id) filter (where shared) as shared,
             count(distinct id) filter (where registered) as registered,
             count(distinct id) filter (where vsat_paid) as vsat_paid,
             count(distinct id) filter (where has_app) as applications,
             count(distinct id) filter (where enrolled) as enrolled
      from base
      group by 1,2,3
    )
    select jsonb_build_object(
      'rows', coalesce((select jsonb_agg(to_jsonb(g) order by g.leads desc) from grp g), '[]'::jsonb),
      'totals', jsonb_build_object(
        'leads', coalesce((select sum(leads) from grp),0),
        'shared', coalesce((select sum(shared) from grp),0),
        'registered', coalesce((select sum(registered) from grp),0),
        'vsat_paid', coalesce((select sum(vsat_paid) from grp),0),
        'applications', coalesce((select sum(applications) from grp),0),
        'enrolled', coalesce((select sum(enrolled) from grp),0))
    )
  );
end; $fn$;
revoke execute on function public.calling_utm_listing(jsonb) from public, anon;
grant execute on function public.calling_utm_listing(jsonb) to authenticated;

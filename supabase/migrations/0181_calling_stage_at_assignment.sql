-- 0181 · Calling pool: the student's VSAT stage when the lead was assigned, and their stage now (staging first).
--
-- Owner's model (25 Nov 2026): leads stay manually added to the calling pool (no auto-fill from inbound).
-- Admins want to see, per lead, which stage the student was at when it was handed to a caller and where
-- they are now, so callers' effect is visible.
--
--   calling_leads.stage_at_assignment   snapshot written by calling_assign every time a lead is given to a caller
--                                       (a re-assignment takes a fresh snapshot); cleared when unassigned.
--                                       Leads assigned before 0181 stay empty (unknown), never guessed.
--   calling__vsat_stage(profile)        server-only helper: the VSAT pipeline stage of the student's newest
--                                       application; 'no_application' when registered without one;
--                                       'not_registered' when the lead is not linked to a Vedam One profile.
--   calling_assign                      + the snapshot. Everything else as 0071.
--   calling_admin_list                  + vsat_stage (live) on each row. Everything else as 0071.
--
-- Rollback: supabase/rollback/0181_calling_stage_at_assignment_down.sql
-- Tests:    supabase/tests/calling_stage_at_assignment.test.sql

alter table public.calling_leads add column if not exists stage_at_assignment text;

create or replace function public.calling__vsat_stage(p_profile uuid)
 returns text
 language sql
 stable security definer
 set search_path to ''
as $function$
  select case
    when p_profile is null then 'not_registered'
    else coalesce((select vp.stage
                     from public.application_manager am
                     join public.vsat_pipeline vp on vp.application_id = am.application_id
                    where am.lead_id = p_profile
                    order by vp.created_at desc, vp.application_id desc
                    limit 1), 'no_application')
  end
$function$;
revoke all on function public.calling__vsat_stage(uuid) from public, anon, authenticated;
grant execute on function public.calling__vsat_stage(uuid) to service_role;

create or replace function public.calling_assign(p jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare v_ids uuid[]; v_assignee uuid := nullif(p->>'assignee','')::uuid; v_n int;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode='42501'; end if;
  select array_agg(e::uuid) into v_ids from jsonb_array_elements_text(coalesce(p->'ids','[]')) e;
  if v_ids is null then return jsonb_build_object('ok',false,'error','no_ids'); end if;
  if v_assignee is not null and not exists (select 1 from public.user_roles where user_id=v_assignee and role::text in ('caller','admin')) then
    return jsonb_build_object('ok',false,'error','assignee_not_caller');
  end if;
  update public.calling_leads set assigned_to=v_assignee,
    assigned_at = case when v_assignee is not null then now() else null end, assigned_by=auth.uid(),
    -- 0181: where the student was when the lead was handed over (fresh on every assignment)
    stage_at_assignment = case when v_assignee is not null then public.calling__vsat_stage(linked_profile_id) else null end
  where id = any(v_ids);
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok',true,'updated',v_n);
end; $function$;

create or replace function public.calling_admin_list(p jsonb default '{}'::jsonb)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
declare
  v_status text := nullif(p->>'status',''); v_interested text := nullif(p->>'interested','');
  v_source text := nullif(p->>'source',''); v_stream text := nullif(p->>'stream','');
  v_assigned text := nullif(p->>'assigned_to',''); v_registered text := nullif(p->>'registered','');
  v_paid text := nullif(p->>'vsat_paid',''); v_search text := nullif(btrim(p->>'search'),'');
  v_trashed boolean := coalesce((p->>'trashed')::boolean,false);
  v_limit int := least(greatest(coalesce((p->>'limit')::int,50),1),500);
  v_offset int := greatest(coalesce((p->>'offset')::int,0),0);
  v_rows jsonb; v_total bigint;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode='42501'; end if;
  -- 0181: vsat_stage is worked out for this page's rows only (after the limit)
  select coalesce(jsonb_agg(((to_jsonb(x) - 'tot') || jsonb_build_object('vsat_stage', public.calling__vsat_stage(x.linked_profile_id)))
                            order by x.updated_at desc),'[]'::jsonb), coalesce(max(x.tot),0)
    into v_rows, v_total
  from (
    select cl.*, au.email as assignee_email, count(*) over() as tot
    from public.calling_leads cl left join auth.users au on au.id = cl.assigned_to
    where cl.is_trashed = v_trashed
      and (v_status is null or cl.call_status=v_status)
      and (v_interested is null or cl.interested=v_interested)
      and (v_source is null or cl.source=v_source)
      and (v_stream is null or cl.stream=v_stream)
      and (v_assigned is null or (v_assigned='unassigned' and cl.assigned_to is null) or (v_assigned<>'unassigned' and cl.assigned_to = v_assigned::uuid))
      and (v_registered is null or (v_registered='yes' and cl.linked_profile_id is not null) or (v_registered='no' and cl.linked_profile_id is null))
      and (v_paid is null or (v_paid='yes' and cl.vsat_paid) or (v_paid='no' and not cl.vsat_paid))
      and (v_search is null or cl.name ilike '%'||v_search||'%' or cl.phone10 like '%'||public.phone10(v_search)||'%' or cl.email ilike '%'||v_search||'%')
    order by cl.updated_at desc limit v_limit offset v_offset
  ) x;
  return jsonb_build_object('rows', v_rows, 'total', v_total);
end; $function$;

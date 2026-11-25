-- Rollback 0181 · calling pool without the stage columns (the 0071 definitions, verbatim from staging).
-- Functions first (they reference the helper and the column), then the helper, then the column.

CREATE OR REPLACE FUNCTION public.calling_assign(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_ids uuid[]; v_assignee uuid := nullif(p->>'assignee','')::uuid; v_n int;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode='42501'; end if;
  select array_agg(e::uuid) into v_ids from jsonb_array_elements_text(coalesce(p->'ids','[]')) e;
  if v_ids is null then return jsonb_build_object('ok',false,'error','no_ids'); end if;
  if v_assignee is not null and not exists (select 1 from public.user_roles where user_id=v_assignee and role::text in ('caller','admin')) then
    return jsonb_build_object('ok',false,'error','assignee_not_caller');
  end if;
  update public.calling_leads set assigned_to=v_assignee,
    assigned_at = case when v_assignee is not null then now() else null end, assigned_by=auth.uid()
  where id = any(v_ids);
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok',true,'updated',v_n);
end; $function$;

CREATE OR REPLACE FUNCTION public.calling_admin_list(p jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  select coalesce(jsonb_agg((to_jsonb(x) - 'tot') order by x.updated_at desc),'[]'::jsonb), coalesce(max(x.tot),0)
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

drop function if exists public.calling__vsat_stage(uuid);
alter table public.calling_leads drop column if exists stage_at_assignment;

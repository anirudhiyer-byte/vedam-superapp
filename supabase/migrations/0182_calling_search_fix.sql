-- 0182 · Calling search: a name no longer matches every lead (staging first).
--
-- Bug (found 25 Nov 2026 while testing 0181): the search also matched by phone with
-- cl.phone10 like '%' || phone10(search) || '%'. A search with no digits ("Ravi") gives phone10 = '', so the
-- pattern was '%%' and every lead matched: the name search in Calling Data and in the caller's queue showed
-- everyone. Now the phone part only applies when the search text has at least one digit. Names, emails
-- (admin list) and phone searches work as before; nothing else changes. Same role checks, grants and output.
--
--   calling_admin_list   as 0181 + the fix
--   calling_my_queue     as 0071 + the fix
--
-- Rollback: supabase/rollback/0182_calling_search_fix_down.sql
-- Tests:    supabase/tests/calling_search_fix.test.sql

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
  -- 0182: the phone part of the search only applies when the text has digits (a name used to match every lead)
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
      and (v_search is null or cl.name ilike '%'||v_search||'%' or (public.phone10(v_search) <> '' and cl.phone10 like '%'||public.phone10(v_search)||'%') or cl.email ilike '%'||v_search||'%')
    order by cl.updated_at desc limit v_limit offset v_offset
  ) x;
  return jsonb_build_object('rows', v_rows, 'total', v_total);
end; $function$;

create or replace function public.calling_my_queue(p jsonb default '{}'::jsonb)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
declare
  v_status text := nullif(p->>'status',''); v_interested text := nullif(p->>'interested','');
  v_search text := nullif(btrim(p->>'search'),''); v_due boolean := coalesce((p->>'due')::boolean,false);
  v_limit int := least(greatest(coalesce((p->>'limit')::int,50),1),500);
  v_offset int := greatest(coalesce((p->>'offset')::int,0),0);
  v_rows jsonb; v_total bigint;
begin
  if not (public.is_admin() or public.is_caller()) then raise exception 'forbidden' using errcode='42501'; end if;
  -- 0182: the phone part of the search only applies when the text has digits
  select coalesce(jsonb_agg(x.cj order by x.updated_at desc),'[]'::jsonb), coalesce(max(x.tot),0)
    into v_rows, v_total
  from (
    select public.calling_caller_json(cl) as cj, cl.updated_at, count(*) over() as tot
    from public.calling_leads cl
    where cl.assigned_to = auth.uid() and not cl.is_trashed
      and (v_status is null or cl.call_status=v_status)
      and (v_interested is null or cl.interested=v_interested)
      and (not v_due or (cl.next_followup_at is not null and cl.next_followup_at <= now()))
      and (v_search is null or cl.name ilike '%'||v_search||'%' or (public.phone10(v_search) <> '' and cl.phone10 like '%'||public.phone10(v_search)||'%'))
    order by cl.updated_at desc limit v_limit offset v_offset
  ) x;
  return jsonb_build_object('rows', v_rows, 'total', v_total);
end; $function$;

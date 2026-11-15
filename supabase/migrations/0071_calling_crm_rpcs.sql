-- 0071 · Calling CRM — Stage 2: the SECURITY DEFINER RPCs that are the ONLY way to
-- read/write calling_leads (the table has no client grants). Every function has
-- search_path='', is revoked from public/anon, granted to authenticated, and checks
-- the caller's role INSIDE. Callers (is_caller) can see only their own assigned leads
-- and update only a whitelist of fields — never assignment, payment, phone or links.
-- Admin-only functions cover the full list, bulk assign/update, CSV import and marking
-- VSAT paid. Nothing here lets a client read others' data or bypass these checks.

-- caller-safe projection (internal helper)
create or replace function public.calling_caller_json(v public.calling_leads)
returns jsonb language sql immutable set search_path to '' as $fn$
  select jsonb_build_object(
    'id', v.id, 'name', v.name, 'stream', v.stream, 'phone', v.phone, 'email', v.email,
    'call_status', v.call_status, 'interested', v.interested, 'remarks', v.remarks,
    'follow_up_remarks', v.follow_up_remarks, 'next_followup_at', v.next_followup_at,
    'last_called_at', v.last_called_at, 'call_count', v.call_count, 'source', v.source,
    'registered', v.linked_profile_id is not null, 'vsat_paid', v.vsat_paid, 'updated_at', v.updated_at);
$fn$;
revoke execute on function public.calling_caller_json(public.calling_leads) from public, anon, authenticated;

-- caller's own queue
create or replace function public.calling_my_queue(p jsonb default '{}')
returns jsonb language plpgsql stable security definer set search_path to '' as $fn$
declare
  v_status text := nullif(p->>'status',''); v_interested text := nullif(p->>'interested','');
  v_search text := nullif(btrim(p->>'search'),''); v_due boolean := coalesce((p->>'due')::boolean,false);
  v_limit int := least(greatest(coalesce((p->>'limit')::int,50),1),500);
  v_offset int := greatest(coalesce((p->>'offset')::int,0),0);
  v_rows jsonb; v_total bigint;
begin
  if not (public.is_admin() or public.is_caller()) then raise exception 'forbidden' using errcode='42501'; end if;
  select coalesce(jsonb_agg(x.cj order by x.updated_at desc),'[]'::jsonb), coalesce(max(x.tot),0)
    into v_rows, v_total
  from (
    select public.calling_caller_json(cl) as cj, cl.updated_at, count(*) over() as tot
    from public.calling_leads cl
    where cl.assigned_to = auth.uid() and not cl.is_trashed
      and (v_status is null or cl.call_status=v_status)
      and (v_interested is null or cl.interested=v_interested)
      and (not v_due or (cl.next_followup_at is not null and cl.next_followup_at <= now()))
      and (v_search is null or cl.name ilike '%'||v_search||'%' or cl.phone10 like '%'||public.phone10(v_search)||'%')
    order by cl.updated_at desc limit v_limit offset v_offset
  ) x;
  return jsonb_build_object('rows', v_rows, 'total', v_total);
end; $fn$;
revoke execute on function public.calling_my_queue(jsonb) from public, anon;
grant execute on function public.calling_my_queue(jsonb) to authenticated;

-- caller/admin update — whitelisted fields only; caller may touch only their own lead
create or replace function public.calling_log_update(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $fn$
declare v_id uuid := (p->>'id')::uuid; v_owned boolean; k text;
begin
  if not (public.is_admin() or public.is_caller()) then raise exception 'forbidden' using errcode='42501'; end if;
  if v_id is null then return jsonb_build_object('ok',false,'error','missing_id'); end if;
  for k in select jsonb_object_keys(p) loop
    if k not in ('id','call_status','interested','remarks','follow_up_remarks','next_followup_at','logged_call') then
      return jsonb_build_object('ok',false,'error','unknown_key','key',k);
    end if;
  end loop;
  select (assigned_to = auth.uid()) into v_owned from public.calling_leads where id=v_id and not is_trashed;
  if not found then return jsonb_build_object('ok',false,'error','not_found'); end if;
  if not public.is_admin() and not coalesce(v_owned,false) then return jsonb_build_object('ok',false,'error','not_your_lead'); end if;
  update public.calling_leads set
    call_status = coalesce(nullif(p->>'call_status',''), call_status),
    interested = case when p ? 'interested' then nullif(p->>'interested','') else interested end,
    remarks = case when p ? 'remarks' then nullif(p->>'remarks','') else remarks end,
    follow_up_remarks = case when p ? 'follow_up_remarks' then nullif(p->>'follow_up_remarks','') else follow_up_remarks end,
    next_followup_at = case when p ? 'next_followup_at' then (nullif(p->>'next_followup_at',''))::timestamptz else next_followup_at end,
    last_called_at = case when coalesce((p->>'logged_call')::boolean,false) then now() else last_called_at end,
    call_count = case when coalesce((p->>'logged_call')::boolean,false) then call_count+1 else call_count end
  where id=v_id;
  return jsonb_build_object('ok',true);
exception when check_violation then return jsonb_build_object('ok',false,'error','invalid_value');
end; $fn$;
revoke execute on function public.calling_log_update(jsonb) from public, anon;
grant execute on function public.calling_log_update(jsonb) to authenticated;

-- dashboard aggregates (callers see only their own slice; admin sees all / by assignee)
create or replace function public.calling_dashboard(p jsonb default '{}')
returns jsonb language plpgsql stable security definer set search_path to '' as $fn$
declare v_admin boolean := public.is_admin(); v_assignee text := nullif(p->>'assigned_to','');
begin
  if not (v_admin or public.is_caller()) then raise exception 'forbidden' using errcode='42501'; end if;
  return (
    with base as (
      select * from public.calling_leads cl
      where not cl.is_trashed
        and (v_admin or cl.assigned_to = auth.uid())
        and (not v_admin or v_assignee is null or cl.assigned_to = v_assignee::uuid)
    )
    select jsonb_build_object(
      'total', count(*),
      'not_called', count(*) filter (where call_status='not_called'),
      'connected', count(*) filter (where call_status='connected'),
      'not_connected', count(*) filter (where call_status='not_connected'),
      'disconnected', count(*) filter (where call_status='disconnected'),
      'connect_rate', case when count(*) filter (where call_status<>'not_called')>0
        then round(100.0*count(*) filter (where call_status='connected')/count(*) filter (where call_status<>'not_called')) else 0 end,
      'interested', count(*) filter (where interested='yes'),
      'not_interested', count(*) filter (where interested='no'),
      'undecided', count(*) filter (where interested is null or interested='undecided'),
      'links_shared', count(*) filter (where remarks ilike '%link%'),
      'bad_numbers', count(*) filter (where remarks ilike '%wrong%' or remarks ilike '%invalid%' or remarks ilike '%not valid%' or remarks ilike '%out of service%' or remarks ilike '%switched off%' or remarks ilike '%not reachable%'),
      'registered_on_vedam', count(*) filter (where linked_profile_id is not null),
      'registered_of_link_shared', count(*) filter (where remarks ilike '%link%' and linked_profile_id is not null),
      'vsat_paid', count(*) filter (where vsat_paid),
      'by_stream', (select coalesce(jsonb_object_agg(coalesce(stream,'—'), c),'{}') from (select stream, count(*) c from base group by stream) s),
      'by_status', (select coalesce(jsonb_object_agg(call_status, c),'{}') from (select call_status, count(*) c from base group by call_status) s),
      'by_assignee', case when v_admin then (select coalesce(jsonb_object_agg(coalesce(au.email,'unassigned'), c),'{}') from (select assigned_to, count(*) c from base group by assigned_to) s left join auth.users au on au.id=s.assigned_to) else '{}'::jsonb end
    ) from base
  );
end; $fn$;
revoke execute on function public.calling_dashboard(jsonb) from public, anon;
grant execute on function public.calling_dashboard(jsonb) to authenticated;

-- admin: full list with filters + pagination
create or replace function public.calling_admin_list(p jsonb default '{}')
returns jsonb language plpgsql stable security definer set search_path to '' as $fn$
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
end; $fn$;
revoke execute on function public.calling_admin_list(jsonb) from public, anon;
grant execute on function public.calling_admin_list(jsonb) to authenticated;

-- admin: assign / reassign / unassign
create or replace function public.calling_assign(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $fn$
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
end; $fn$;
revoke execute on function public.calling_assign(jsonb) from public, anon;
grant execute on function public.calling_assign(jsonb) to authenticated;

-- admin: bulk field update (whitelisted)
create or replace function public.calling_bulk_update(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $fn$
declare v_ids uuid[]; patch jsonb := coalesce(p->'patch','{}'); k text; v_n int;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode='42501'; end if;
  select array_agg(e::uuid) into v_ids from jsonb_array_elements_text(coalesce(p->'ids','[]')) e;
  if v_ids is null then return jsonb_build_object('ok',false,'error','no_ids'); end if;
  for k in select jsonb_object_keys(patch) loop
    if k not in ('call_status','interested','disposition','stream','is_trashed') then
      return jsonb_build_object('ok',false,'error','unknown_patch_key','key',k);
    end if;
  end loop;
  update public.calling_leads set
    call_status = coalesce(nullif(patch->>'call_status',''), call_status),
    interested = case when patch ? 'interested' then nullif(patch->>'interested','') else interested end,
    disposition = case when patch ? 'disposition' then nullif(patch->>'disposition','') else disposition end,
    stream = case when patch ? 'stream' then nullif(patch->>'stream','') else stream end,
    is_trashed = coalesce((patch->>'is_trashed')::boolean, is_trashed)
  where id = any(v_ids);
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok',true,'updated',v_n);
exception when check_violation then return jsonb_build_object('ok',false,'error','invalid_value');
end; $fn$;
revoke execute on function public.calling_bulk_update(jsonb) from public, anon;
grant execute on function public.calling_bulk_update(jsonb) to authenticated;

-- admin: CSV / bulk import (dedupe by phone)
create or replace function public.calling_import(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $fn$
declare r jsonb; v_ins int := 0; v_skip int := 0;
  v_dedupe boolean := coalesce((p->>'dedupe')::boolean,true);
  v_src text := coalesce(nullif(p->>'source',''),'csv'); v_p10 text;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode='42501'; end if;
  if v_src not in ('school_connect','csv','inbound','manual') then v_src := 'csv'; end if;
  for r in select value from jsonb_array_elements(coalesce(p->'rows','[]')) loop
    v_p10 := public.phone10(r->>'phone');
    if v_p10 is null or length(v_p10) < 10 then v_skip := v_skip+1; continue; end if;
    if v_dedupe and exists (select 1 from public.calling_leads where phone10=v_p10) then v_skip := v_skip+1; continue; end if;
    insert into public.calling_leads(name,stream,phone,email,source,utm_source,utm_medium,utm_campaign,remarks)
    values (nullif(r->>'name',''), nullif(r->>'stream',''), r->>'phone', nullif(r->>'email',''), v_src,
            nullif(r->>'utm_source',''), nullif(r->>'utm_medium',''), nullif(r->>'utm_campaign',''), nullif(r->>'remarks',''));
    v_ins := v_ins+1;
  end loop;
  return jsonb_build_object('ok',true,'inserted',v_ins,'skipped',v_skip);
end; $fn$;
revoke execute on function public.calling_import(jsonb) from public, anon;
grant execute on function public.calling_import(jsonb) to authenticated;

-- admin: mark VSAT paid + fire the (service-side) back-fill
create or replace function public.calling_set_vsat_paid(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $fn$
declare v_id uuid := (p->>'id')::uuid;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode='42501'; end if;
  if v_id is null then return jsonb_build_object('ok',false,'error','missing_id'); end if;
  update public.calling_leads set vsat_paid=true,
    vsat_paid_amount=coalesce((p->>'amount')::numeric, vsat_paid_amount),
    vsat_paid_at=coalesce((p->>'at')::timestamptz, vsat_paid_at, now())
  where id=v_id;
  if not found then return jsonb_build_object('ok',false,'error','not_found'); end if;
  perform public.calling_apply_vsat_payment(v_id);
  return jsonb_build_object('ok',true,'applied',(select vsat_payment_applied from public.calling_leads where id=v_id));
end; $fn$;
revoke execute on function public.calling_set_vsat_paid(jsonb) from public, anon;
grant execute on function public.calling_set_vsat_paid(jsonb) to authenticated;

-- admin: caller roster for the assignment dropdown
create or replace function public.calling_callers()
returns jsonb language plpgsql stable security definer set search_path to '' as $fn$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode='42501'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id',ur.user_id,'email',au.email) order by au.email),'[]'::jsonb)
          from public.user_roles ur join auth.users au on au.id=ur.user_id where ur.role::text='caller');
end; $fn$;
revoke execute on function public.calling_callers() from public, anon;
grant execute on function public.calling_callers() to authenticated;

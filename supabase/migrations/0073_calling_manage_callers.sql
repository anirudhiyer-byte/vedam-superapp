-- 0073 · Calling CRM — admin RPCs to manage who is a caller. Grant/revoke the
-- 'caller' role by email, and a roster with per-caller lead counts for the admin
-- "Callers" page. Admin-only, SECURITY DEFINER, search_path='', revoked from
-- public/anon. A person must already have a Vedam One account (auth user) before
-- they can be made a caller.

create or replace function public.calling_add_caller(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $fn$
declare v_email text := lower(nullif(btrim(p->>'email'),'')); v_uid uuid;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode='42501'; end if;
  if v_email is null then return jsonb_build_object('ok',false,'error','missing_email'); end if;
  select id into v_uid from auth.users where lower(email) = v_email limit 1;
  if v_uid is null then return jsonb_build_object('ok',false,'error','user_not_found'); end if;
  insert into public.user_roles(user_id, role, created_by)
    values (v_uid, 'caller', auth.uid())
    on conflict (user_id, role) do nothing;
  return jsonb_build_object('ok',true,'user_id',v_uid);
end; $fn$;
revoke execute on function public.calling_add_caller(jsonb) from public, anon;
grant execute on function public.calling_add_caller(jsonb) to authenticated;

create or replace function public.calling_remove_caller(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $fn$
declare v_uid uuid := nullif(p->>'user_id','')::uuid;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode='42501'; end if;
  if v_uid is null then return jsonb_build_object('ok',false,'error','missing_user_id'); end if;
  delete from public.user_roles where user_id = v_uid and role::text = 'caller';
  return jsonb_build_object('ok',true);
end; $fn$;
revoke execute on function public.calling_remove_caller(jsonb) from public, anon;
grant execute on function public.calling_remove_caller(jsonb) to authenticated;

create or replace function public.calling_caller_roster()
returns jsonb language plpgsql stable security definer set search_path to '' as $fn$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode='42501'; end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', ur.user_id, 'email', au.email,
      'assigned', coalesce(c.assigned,0),
      'connected', coalesce(c.connected,0),
      'interested', coalesce(c.interested,0)
    ) order by au.email), '[]'::jsonb)
    from public.user_roles ur
    join auth.users au on au.id = ur.user_id
    left join lateral (
      select count(*) filter (where not is_trashed) as assigned,
             count(*) filter (where not is_trashed and call_status='connected') as connected,
             count(*) filter (where not is_trashed and interested='yes') as interested
      from public.calling_leads where assigned_to = ur.user_id
    ) c on true
    where ur.role::text = 'caller'
  );
end; $fn$;
revoke execute on function public.calling_caller_roster() from public, anon;
grant execute on function public.calling_caller_roster() to authenticated;

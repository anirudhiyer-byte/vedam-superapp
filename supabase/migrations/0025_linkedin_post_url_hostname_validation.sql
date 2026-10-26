-- 0025: SEC-08 / CS-02 — hostname-based LinkedIn post URL validation (A04 Insecure Design fix).
-- Applied to STAGING on 2026-10-26. Rollback SQL kept in QA notes (rollback_linkedin_fix_STAGING.sql).

-- 1) Single source of truth: a server-side validator (A04 — hostname, not text match).
create or replace function public.is_valid_linkedin_post_url(p_url text)
returns boolean
language sql
immutable
set search_path to ''
as $$
  -- https:// , host exactly linkedin.com / www.linkedin.com (no userinfo, port,
  -- sub-domain, look-alike or trailing dot), and a real post path.
  select p_url is not null
     and length(p_url) <= 500
     and p_url ~ '^https://(www\.)?linkedin\.com/(posts/[A-Za-z0-9%._-]+|feed/update/urn:li:(activity|share|ugcPost):[0-9]+)/?(\?[^ ]*)?$';
$$;

-- 2) Helper: is this exact post URL already used by anyone? (anti-reuse of someone else's link)
create or replace function public.linkedin_url_in_use(p_url text)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select exists(select 1 from public.certificates        where linkedin_post_url = p_url)
      or exists(select 1 from public.event_registrations  where linkedin_post_url = p_url or linkedin_podium_url = p_url);
$$;
revoke execute on function public.linkedin_url_in_use(text) from public, anon, authenticated;

-- 3) cs_award_share: only ever called from inside cs_submit_linkedin now (no direct client call).
revoke execute on function public.cs_award_share(uuid) from public, anon, authenticated;

-- 4) CodeSprint submit: hostname validation + reuse check.
create or replace function public.cs_submit_linkedin(p_cert_id uuid, p_url text)
 returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare v_uid uuid := auth.uid(); v_owner uuid; v_module uuid; v_existing text; v_pts int; v_url text := trim(p_url);
begin
  if v_uid is null then return jsonb_build_object('error','not authenticated'); end if;
  select user_id, module_id, linkedin_post_url into v_owner, v_module, v_existing
    from public.certificates where id = p_cert_id and source = 'codesprint';
  if v_owner is null or v_owner <> v_uid then return jsonb_build_object('error','not your certificate'); end if;
  if v_existing is not null then return jsonb_build_object('already', true); end if;
  if not public.is_valid_linkedin_post_url(v_url) then
    return jsonb_build_object('error','Paste the full LinkedIn post link (https://www.linkedin.com/posts/…). Short links are not accepted.');
  end if;
  if public.linkedin_url_in_use(v_url) then return jsonb_build_object('error','This LinkedIn post has already been submitted.'); end if;
  update public.certificates set linkedin_post_url = v_url where id = p_cert_id;
  v_pts := public.cs_award_share(v_module);
  return jsonb_build_object('ok', true, 'points', coalesce(v_pts,0));
end $function$;

-- 5) Events submit (legacy single): same rule.
create or replace function public.submit_linkedin_post(p_registration_id uuid, p_url text)
 returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare v_uid uuid := auth.uid(); v_event uuid; v_owner uuid; v_existing text; v_winner boolean; v_pts int; v_url text := trim(p_url);
begin
  if v_uid is null then return jsonb_build_object('error','not authenticated'); end if;
  select event_id, user_id, linkedin_post_url into v_event, v_owner, v_existing
    from public.event_registrations where id = p_registration_id;
  if v_owner is null or v_owner <> v_uid then return jsonb_build_object('error','not your registration'); end if;
  if v_existing is not null then return jsonb_build_object('already', true); end if;
  if not public.is_valid_linkedin_post_url(v_url) then
    return jsonb_build_object('error','Paste the full LinkedIn post link (https://www.linkedin.com/posts/…). Short links are not accepted.');
  end if;
  if public.linkedin_url_in_use(v_url) then return jsonb_build_object('error','This LinkedIn post has already been submitted.'); end if;
  update public.event_registrations set linkedin_post_url = v_url where id = p_registration_id;
  select exists(select 1 from public.certificates c where c.registration_id = p_registration_id and c.kind = 'winner') into v_winner;
  select case when v_winner then coalesce(share_points_podium,0) else coalesce(share_points_participation,0) end
    into v_pts from public.events where id = v_event;
  if coalesce(v_pts,0) > 0 then
    insert into public.points_ledger(user_id, points, action, app, event_id, ref)
      values (v_uid, v_pts, 'linkedin_share', 'events', v_event, p_registration_id::text)
      on conflict on constraint points_once do nothing;
  end if;
  return jsonb_build_object('ok', true, 'points', coalesce(v_pts,0), 'podium', v_winner);
end $function$;

-- 6) Events submit (participation/podium): same rule, per-field reuse check.
create or replace function public.submit_linkedin_kind(p_registration_id uuid, p_url text, p_kind text)
 returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare v_uid uuid := auth.uid(); v_event uuid; v_owner uuid; v_winner boolean; v_pts int; v_existing text; v_url text := trim(p_url);
begin
  if v_uid is null then return jsonb_build_object('error','not authenticated'); end if;
  select event_id, user_id into v_event, v_owner from public.event_registrations where id = p_registration_id;
  if v_owner is null or v_owner <> v_uid then return jsonb_build_object('error','not your registration'); end if;
  if not public.is_valid_linkedin_post_url(v_url) then
    return jsonb_build_object('error','Paste the full LinkedIn post link (https://www.linkedin.com/posts/…). Short links are not accepted.');
  end if;
  if public.linkedin_url_in_use(v_url) then return jsonb_build_object('error','This LinkedIn post has already been submitted.'); end if;
  select exists(select 1 from public.certificates c where c.registration_id = p_registration_id and c.kind='winner') into v_winner;
  if p_kind = 'podium' then
    if not v_winner then return jsonb_build_object('error','no podium finish on this event'); end if;
    select linkedin_podium_url into v_existing from public.event_registrations where id = p_registration_id;
    if v_existing is not null then return jsonb_build_object('already', true); end if;
    update public.event_registrations set linkedin_podium_url = v_url where id = p_registration_id;
    select coalesce(share_points_podium,0) into v_pts from public.events where id = v_event;
  else
    select linkedin_post_url into v_existing from public.event_registrations where id = p_registration_id;
    if v_existing is not null then return jsonb_build_object('already', true); end if;
    update public.event_registrations set linkedin_post_url = v_url where id = p_registration_id;
    select coalesce(share_points_participation,0) into v_pts from public.events where id = v_event;
  end if;
  if coalesce(v_pts,0) > 0 then
    insert into public.points_ledger(user_id, points, action, app, event_id, ref)
      values (v_uid, v_pts, 'linkedin_'||p_kind, 'events', v_event, p_registration_id::text||':'||p_kind)
      on conflict on constraint points_once do nothing;
  end if;
  return jsonb_build_object('ok', true, 'points', coalesce(v_pts,0), 'kind', p_kind);
end $function$;

-- 7) award_event_points: block the share_linkedin action here so share points can
--    only come through submit_linkedin_* (which now validate the URL). Other
--    actions (register/attend) are unaffected.
create or replace function public.award_event_points(p_event_id uuid, p_action text)
 returns integer language plpgsql security definer set search_path to ''
as $function$
declare v_pts integer; v_uid uuid := auth.uid();
begin
  if v_uid is null then return 0; end if;
  if p_action = 'share_linkedin' then return 0; end if;  -- must go through submit_linkedin_post
  select coalesce((points_config->>p_action)::int, 0) into v_pts from public.events where id = p_event_id;
  if coalesce(v_pts, 0) = 0 then return 0; end if;
  insert into public.points_ledger(user_id, points, action, app, event_id)
  values (v_uid, v_pts, p_action, 'events', p_event_id)
  on conflict on constraint points_once do nothing;
  if not found then return 0; end if;
  return v_pts;
end $function$;

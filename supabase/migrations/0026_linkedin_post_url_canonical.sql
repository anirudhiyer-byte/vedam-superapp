-- 0026 — LinkedIn post URL: canonical form + same-post check (phone / lnkd.in support).
-- STAGING first (kyhakenhbgcissmaacws). Rollback: re-apply 0025 bodies (see scratch rollback file).
--
-- Why: the same post can arrive as many strings — with ?utm_source=..., a trailing
-- slash, without www, or as /feed/update/urn:li:activity:<id> instead of
-- /posts/<slug>-activity-<id>-xx. Exact text compare let the same post be
-- submitted twice. Now every URL is stored in one canonical form and the reuse
-- check compares a per-post key (the activity/share/ugcPost id when present).
-- lnkd.in links are resolved by the app (/api/linkedin/resolve) before they reach
-- the DB; the DB itself still accepts only real linkedin.com post URLs.

-- 1) Canonical form: https://www.linkedin.com/<path>, no query/hash/trailing slash. NULL if invalid.
create or replace function public.canonical_linkedin_post_url(p_url text)
returns text language sql immutable set search_path to ''
as $$
  select case when public.is_valid_linkedin_post_url(trim(p_url)) then
    'https://www.linkedin.com/' ||
    rtrim((regexp_match(trim(p_url), '^https://(?:www\.)?linkedin\.com/([^?#]*)'))[1], '/')
  end;
$$;

-- 2) Per-post key: "<type>:<id>" when the URL carries the post id, else the canonical URL.
create or replace function public.linkedin_post_key(p_url text)
returns text language sql immutable set search_path to ''
as $$
  with c as (select public.canonical_linkedin_post_url(p_url) u)
  select coalesce(
    (select m[1] || ':' || m[2] from c, regexp_match(c.u, 'urn:li:(activity|share|ugcPost):([0-9]+)$') m),
    (select m[1] || ':' || m[2] from c, regexp_match(c.u, '/posts/[^/]*-(activity|share|ugcPost)-([0-9]+)(?:-[A-Za-z0-9_]+)?$') m),
    (select u from c)
  );
$$;

-- 3) Reuse check by post key (works for rows stored before this migration too).
create or replace function public.linkedin_url_in_use(p_url text)
returns boolean language sql stable security definer set search_path to ''
as $$
  with k as (select public.linkedin_post_key(p_url) key)
  select (select key from k) is not null and (
       exists(select 1 from public.certificates c, k where c.linkedin_post_url is not null and public.linkedin_post_key(c.linkedin_post_url) = k.key)
    or exists(select 1 from public.event_registrations r, k where r.linkedin_post_url is not null and public.linkedin_post_key(r.linkedin_post_url) = k.key)
    or exists(select 1 from public.event_registrations r, k where r.linkedin_podium_url is not null and public.linkedin_post_key(r.linkedin_podium_url) = k.key)
  );
$$;
revoke execute on function public.linkedin_url_in_use(text) from public, anon, authenticated;

-- 4) CodeSprint submit: store canonical URL.
create or replace function public.cs_submit_linkedin(p_cert_id uuid, p_url text)
 returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare v_uid uuid := auth.uid(); v_owner uuid; v_module uuid; v_existing text; v_pts int; v_url text := public.canonical_linkedin_post_url(p_url);
begin
  if v_uid is null then return jsonb_build_object('error','not authenticated'); end if;
  select user_id, module_id, linkedin_post_url into v_owner, v_module, v_existing
    from public.certificates where id = p_cert_id and source = 'codesprint';
  if v_owner is null or v_owner <> v_uid then return jsonb_build_object('error','not your certificate'); end if;
  if v_existing is not null then return jsonb_build_object('already', true); end if;
  if v_url is null then
    return jsonb_build_object('error','Paste your LinkedIn post link (https://www.linkedin.com/posts/… or the lnkd.in link from the app).');
  end if;
  if public.linkedin_url_in_use(v_url) then return jsonb_build_object('error','This LinkedIn post has already been submitted.'); end if;
  update public.certificates set linkedin_post_url = v_url where id = p_cert_id;
  v_pts := public.cs_award_share(v_module);
  return jsonb_build_object('ok', true, 'points', coalesce(v_pts,0));
end $function$;

-- 5) Events submit (legacy single).
create or replace function public.submit_linkedin_post(p_registration_id uuid, p_url text)
 returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare v_uid uuid := auth.uid(); v_event uuid; v_owner uuid; v_existing text; v_winner boolean; v_pts int; v_url text := public.canonical_linkedin_post_url(p_url);
begin
  if v_uid is null then return jsonb_build_object('error','not authenticated'); end if;
  select event_id, user_id, linkedin_post_url into v_event, v_owner, v_existing
    from public.event_registrations where id = p_registration_id;
  if v_owner is null or v_owner <> v_uid then return jsonb_build_object('error','not your registration'); end if;
  if v_existing is not null then return jsonb_build_object('already', true); end if;
  if v_url is null then
    return jsonb_build_object('error','Paste your LinkedIn post link (https://www.linkedin.com/posts/… or the lnkd.in link from the app).');
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

-- 6) Events submit (participation/podium).
create or replace function public.submit_linkedin_kind(p_registration_id uuid, p_url text, p_kind text)
 returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare v_uid uuid := auth.uid(); v_event uuid; v_owner uuid; v_winner boolean; v_pts int; v_existing text; v_url text := public.canonical_linkedin_post_url(p_url);
begin
  if v_uid is null then return jsonb_build_object('error','not authenticated'); end if;
  select event_id, user_id into v_event, v_owner from public.event_registrations where id = p_registration_id;
  if v_owner is null or v_owner <> v_uid then return jsonb_build_object('error','not your registration'); end if;
  if v_url is null then
    return jsonb_build_object('error','Paste your LinkedIn post link (https://www.linkedin.com/posts/… or the lnkd.in link from the app).');
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

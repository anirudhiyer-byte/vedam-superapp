-- 0077 · Calling CRM — UTM link registry (correlate caller-shared UTMs to profiles).
--
-- Admin registers the UTM links given to callers to share. The listing then
-- correlates Vedam One profiles created with that UTM down the funnel
-- (profiles -> VSAT registered -> VSAT paid -> application -> enrolled), matching by
-- the PROFILE's own utm_source/medium/campaign — so a student who registers via the
-- shared link is counted even without a calling_leads row. Replaces the earlier
-- calling_leads-based calling_utm_listing (0072).
--
-- Admin-only, SECURITY DEFINER, search_path='', revoked from public/anon; the table
-- has no client grants (all access via the RPCs below).

create table if not exists public.calling_utm_links (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  label text not null,
  caller_id uuid references auth.users(id) on delete set null,
  utm_source text not null,
  utm_medium text not null,
  utm_campaign text,
  target_url text not null default 'https://one.vedam.org',
  is_active boolean not null default true,
  notes text,
  created_by uuid references auth.users(id) on delete set null
);
create unique index if not exists calling_utm_links_uniq
  on public.calling_utm_links(lower(utm_source), lower(utm_medium), lower(coalesce(utm_campaign,'')));
alter table public.calling_utm_links enable row level security;
revoke all on public.calling_utm_links from public, anon, authenticated;

create or replace function public.calling_utm_touch()
returns trigger language plpgsql set search_path to '' as $fn$
begin new.updated_at := now(); return new; end; $fn$;
drop trigger if exists trg_calling_utm_touch on public.calling_utm_links;
create trigger trg_calling_utm_touch before update on public.calling_utm_links
  for each row execute function public.calling_utm_touch();

-- register a UTM link for a caller
create or replace function public.calling_utm_create(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $fn$
declare k text; v_id uuid; v_caller uuid := nullif(p->>'caller_id','')::uuid;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode='42501'; end if;
  for k in select jsonb_object_keys(p) loop
    if k not in ('label','caller_id','utm_source','utm_medium','utm_campaign','target_url','notes') then
      return jsonb_build_object('ok',false,'error','unknown_key','key',k); end if;
  end loop;
  if nullif(btrim(p->>'label'),'') is null or nullif(btrim(p->>'utm_source'),'') is null or nullif(btrim(p->>'utm_medium'),'') is null then
    return jsonb_build_object('ok',false,'error','missing_required'); end if;
  if v_caller is not null and not exists (select 1 from public.user_roles where user_id=v_caller and role::text in ('caller','admin')) then
    return jsonb_build_object('ok',false,'error','caller_not_found'); end if;
  insert into public.calling_utm_links(label, caller_id, utm_source, utm_medium, utm_campaign, target_url, notes, created_by)
  values (btrim(p->>'label'), v_caller, btrim(p->>'utm_source'), btrim(p->>'utm_medium'),
          nullif(btrim(p->>'utm_campaign'),''), coalesce(nullif(btrim(p->>'target_url'),''),'https://one.vedam.org'),
          nullif(btrim(p->>'notes'),''), auth.uid())
  on conflict (lower(utm_source), lower(utm_medium), lower(coalesce(utm_campaign,''))) do nothing
  returning id into v_id;
  if v_id is null then return jsonb_build_object('ok',false,'error','duplicate_utm'); end if;
  return jsonb_build_object('ok',true,'id',v_id);
end; $fn$;
revoke execute on function public.calling_utm_create(jsonb) from public, anon;
grant execute on function public.calling_utm_create(jsonb) to authenticated;

create or replace function public.calling_utm_delete(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $fn$
declare v_id uuid := (p->>'id')::uuid;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode='42501'; end if;
  if v_id is null then return jsonb_build_object('ok',false,'error','missing_id'); end if;
  delete from public.calling_utm_links where id=v_id;
  return jsonb_build_object('ok',true);
end; $fn$;
revoke execute on function public.calling_utm_delete(jsonb) from public, anon;
grant execute on function public.calling_utm_delete(jsonb) to authenticated;

-- correlate each registered link to profiles + funnel
create or replace function public.calling_utm_listing(p jsonb default '{}')
returns jsonb language plpgsql stable security definer set search_path to '' as $fn$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode='42501'; end if;
  return (
    with corr as (
      select l.id as link_id,
             count(pr.user_id) as profiles,
             count(pr.user_id) filter (where exists (select 1 from public.vsat_registrations vr where vr.user_id=pr.user_id and vr.registered)) as registered,
             count(pr.user_id) filter (where exists (select 1 from public.vsat_payments vp where vp.lead_id=pr.user_id)) as vsat_paid,
             count(pr.user_id) filter (where exists (select 1 from public.application_manager am where am.lead_id=pr.user_id)) as applications,
             count(pr.user_id) filter (where exists (select 1 from public.application_manager am where am.lead_id=pr.user_id
                   and (am.application_stage_1::text='enrolled' or am.application_stage_2::text='enrolled'))) as enrolled
      from public.calling_utm_links l
      left join public.vedam_one_profiles pr
        on lower(pr.utm_source)=lower(l.utm_source) and lower(pr.utm_medium)=lower(l.utm_medium)
           and (l.utm_campaign is null or lower(pr.utm_campaign)=lower(l.utm_campaign))
      group by l.id
    )
    select jsonb_build_object(
      'rows', coalesce((select jsonb_agg(jsonb_build_object(
          'id', l.id, 'label', l.label, 'caller', au.email, 'active', l.is_active,
          'utm_source', l.utm_source, 'utm_medium', l.utm_medium, 'utm_campaign', l.utm_campaign,
          'target_url', l.target_url,
          'share_url', l.target_url || '?utm_source=' || l.utm_source || '&utm_medium=' || l.utm_medium || coalesce('&utm_campaign='||l.utm_campaign,''),
          'profiles', c.profiles, 'registered', c.registered, 'vsat_paid', c.vsat_paid,
          'applications', c.applications, 'enrolled', c.enrolled)
          order by c.profiles desc, l.created_at desc)
        from public.calling_utm_links l join corr c on c.link_id=l.id
        left join auth.users au on au.id=l.caller_id), '[]'::jsonb),
      'totals', (select jsonb_build_object(
          'links', count(*), 'profiles', coalesce(sum(profiles),0), 'registered', coalesce(sum(registered),0),
          'vsat_paid', coalesce(sum(vsat_paid),0), 'applications', coalesce(sum(applications),0),
          'enrolled', coalesce(sum(enrolled),0)) from corr)
    )
  );
end; $fn$;
revoke execute on function public.calling_utm_listing(jsonb) from public, anon;
grant execute on function public.calling_utm_listing(jsonb) to authenticated;

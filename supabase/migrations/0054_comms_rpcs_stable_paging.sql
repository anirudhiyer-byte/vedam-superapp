-- 0054: Communications hub RPCs — stable order so the admin UI can read them page by page.
--
-- The Supabase API returns at most ~1000 rows per call, so the Campaigns audience
-- (comms_audience: 1,204 people on production), the Advanced audience builder
-- (campaign_audience) and the Report drill-down (campaign_recipients) silently stopped
-- at 1000. The UI now reads them in pages; pages only line up if the order is fully
-- deterministic, so each ORDER BY ends with a unique id. Rows returned are unchanged.
--
-- comms_audience and campaign_audience were created by hand and were never in a
-- migration; this file captures them. All three keep their admin gate and are aligned
-- with the project rule: search_path '', authenticated-only grant. Only the admin pages
-- call them (the journeys cron uses comms_audience_all, which is untouched).

-- ── Campaigns audience ──────────────────────────────────────────────────────────
create or replace function public.comms_audience()
 returns table(id uuid, name text, phone text, email text, state text, city text,
               signup timestamp with time zone, events_reg integer, events_attended integer,
               cs_enrolled boolean, cs_modules integer, cs_total integer, cp_used boolean, points bigint)
 language sql
 stable
 security definer
 set search_path to ''
as $function$
  with total_mods as (select count(*)::int as c from public.cs_modules where published)
  select
    p.id,
    coalesce(nullif(trim(p.full_name), ''), 'Vedam user') as name,
    p.phone, p.email, p.state, p.city, u.created_at as signup,
    (select count(*)::int from public.event_registrations er where er.user_id = p.id),
    (select count(*)::int from public.event_registrations er where er.user_id = p.id and er.joined),
    exists(select 1 from public.cs_enrollments e where e.user_id = p.id),
    (select count(*)::int from public.certificates c where c.user_id = p.id and c.source = 'codesprint'),
    (select c from total_mods),
    exists(select 1 from public.product_usage pu where pu.user_id = p.id and pu.product = 'college_predictor'),
    coalesce((select sum(pl.points) from public.points_ledger pl where pl.user_id = p.id), 0)
  from public.profiles p
  join auth.users u on u.id = p.id
  where public.is_admin()
  order by u.created_at desc nulls last, p.id;
$function$;

-- ── Advanced audience builder ───────────────────────────────────────────────────
create or replace function public.campaign_audience(p_source text, p_conditions jsonb, p_limit integer default 5000)
 returns table(user_id uuid, email text, phone text, full_name text)
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare whereclause text; q text;
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  if p_source not in ('vedam_one','vedam_one_profiles','bootcamp_participation','bootcamp_dropoffs','codesprint_participation','vsat_registrations','bootcamp_audience') then
    raise exception 'invalid source'; end if;
  whereclause := public.automation_where(p_source, coalesce(p_conditions,'[]'::jsonb));
  q := format($f$
    select p.id, p.email, p.phone, p.full_name
    from public.profiles p
    where p.id in (select distinct user_id from public.%I where %s)
      and not public.is_opted_out(p.email, p.phone, 'email')
    order by p.id
    limit %s
  $f$, p_source, whereclause, p_limit);
  return query execute q;
end $function$;

-- ── Report drill-down (per-recipient rows of one campaign) ──────────────────────
create or replace function public.campaign_recipients(p_campaign uuid)
 returns table(channel text, contact text, status text, sent_at timestamp with time zone,
               delivered_at timestamp with time zone, opened_at timestamp with time zone,
               clicked_at timestamp with time zone, failed boolean, detail text)
 language plpgsql
 stable
 security definer
 set search_path to ''
as $function$
begin
  if not public.is_admin() then
    return;
  end if;
  return query
    select x.channel, x.contact, x.status, x.sent_at, x.delivered_at,
           x.opened_at, x.clicked_at, x.failed, x.detail
    from (
      select 'email'::text as channel,
             e.to_email as contact,
             coalesce(e.status, 'sent') as status,
             e.sent_at,
             e.delivered_at,
             e.opened_at,
             e.clicked_at,
             (e.status = 'failed' or e.bounced_at is not null) as failed,
             (case when e.bounced_at is not null then 'bounced' else null end) as detail,
             e.id as rid
        from public.email_events e
       where e.campaign_id = p_campaign
      union all
      select 'whatsapp'::text,
             w.to_number,
             coalesce(w.status, 'sent'),
             w.created_at,
             w.delivered_at,
             w.read_at,
             null::timestamptz,
             (w.status in ('failed', 'undelivered')),
             w.failed_reason,
             w.id
        from public.whatsapp_sends w
       where w.campaign_id = p_campaign
    ) x
    order by x.sent_at desc nulls last, x.channel, x.rid;
end;
$function$;

-- ── Access: authenticated only (each also refuses non-admins inside) ────────────
revoke all on function public.comms_audience()                       from public, anon, authenticated, service_role;
revoke all on function public.campaign_audience(text, jsonb, integer) from public, anon, authenticated, service_role;
revoke all on function public.campaign_recipients(uuid)              from public, anon, authenticated, service_role;
grant execute on function public.comms_audience()                       to authenticated;
grant execute on function public.campaign_audience(text, jsonb, integer) to authenticated;
grant execute on function public.campaign_recipients(uuid)              to authenticated;

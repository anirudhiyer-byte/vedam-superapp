-- Rollback for 0054: restore comms_audience, campaign_audience and campaign_recipients
-- exactly as they were before (definitions incl. original CRLF line endings, volatility,
-- search_path and grants). comms_audience / campaign_audience go back to the hand-made
-- versions (executable by everyone, still admin-gated); campaign_recipients goes back
-- to its 0053 form.

CREATE OR REPLACE FUNCTION public.comms_audience()
 RETURNS TABLE(id uuid, name text, phone text, email text, state text, city text, signup timestamp with time zone, events_reg integer, events_attended integer, cs_enrolled boolean, cs_modules integer, cs_total integer, cp_used boolean, points bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  order by u.created_at desc nulls last;
$function$;

CREATE OR REPLACE FUNCTION public.campaign_audience(p_source text, p_conditions jsonb, p_limit integer DEFAULT 5000)
 RETURNS TABLE(user_id uuid, email text, phone text, full_name text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    limit %s
  $f$, p_source, whereclause, p_limit);
  return query execute q;
end $function$;

CREATE OR REPLACE FUNCTION public.campaign_recipients(p_campaign uuid)
 RETURNS TABLE(channel text, contact text, status text, sent_at timestamp with time zone, delivered_at timestamp with time zone, opened_at timestamp with time zone, clicked_at timestamp with time zone, failed boolean, detail text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not public.is_admin() then
    return;
  end if;
  return query
    select 'email'::text as channel,
           e.to_email as contact,
           coalesce(e.status, 'sent') as status,
           e.sent_at,
           e.delivered_at,
           e.opened_at,
           e.clicked_at,
           (e.status = 'failed' or e.bounced_at is not null) as failed,
           (case when e.bounced_at is not null then 'bounced' else null end) as detail
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
           w.failed_reason
      from public.whatsapp_sends w
     where w.campaign_id = p_campaign
    order by sent_at desc nulls last;
end;
$function$;

grant execute on function public.comms_audience()                       to public, anon, authenticated, service_role;
grant execute on function public.campaign_audience(text, jsonb, integer) to public, anon, authenticated, service_role;
revoke all on function public.campaign_recipients(uuid) from public, anon, service_role;
grant execute on function public.campaign_recipients(uuid) to authenticated;

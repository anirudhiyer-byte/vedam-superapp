-- 0053: campaign_recipients — per-recipient delivery rows for one campaign (Reports tab
-- drill-down in the Communications hub). It was created directly on staging and was never
-- in a migration file, so production did not have it. Same output as the staging version;
-- aligned with the project rule for browser-callable functions: search_path '', fully
-- qualified names, authenticated-only grant (it also returns nothing unless is_admin()).

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

revoke all on function public.campaign_recipients(uuid) from public, anon, authenticated, service_role;
grant execute on function public.campaign_recipients(uuid) to authenticated;

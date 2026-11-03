-- Rollback for 0053: restore campaign_recipients exactly as it was before (the hand-made
-- staging version: search_path public, volatile, executable by everyone; still admin-gated).
-- On a database where 0053 created it for the first time (production), drop it instead:
--   drop function if exists public.campaign_recipients(uuid);

CREATE OR REPLACE FUNCTION public.campaign_recipients(p_campaign uuid)
 RETURNS TABLE(channel text, contact text, status text, sent_at timestamp with time zone, delivered_at timestamp with time zone, opened_at timestamp with time zone, clicked_at timestamp with time zone, failed boolean, detail text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
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

grant execute on function public.campaign_recipients(uuid) to public, anon, authenticated, service_role;

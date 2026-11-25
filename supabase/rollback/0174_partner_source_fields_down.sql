-- Rollback 0174 · restore partner_materialize to its 0172 body and drop the School Connect columns.

create or replace function public.partner_materialize(p_lead_id uuid, p_phone text, p_email text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_phone_norm text := nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), '');
  v_email      text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  pl           public.partner_leads;
  v_amount     numeric;
  v_already    boolean;
begin
  if p_lead_id is null then return jsonb_build_object('materialized', false); end if;

  if v_phone_norm is not null and char_length(v_phone_norm) >= 6 then
    select * into pl from public.partner_leads
     where status = 'pending' and phone_norm = v_phone_norm order by created_at desc limit 1;
  end if;
  if pl.id is null and v_email is not null then
    select * into pl from public.partner_leads
     where status = 'pending' and lower(email) = v_email order by created_at desc limit 1;
  end if;
  if pl.id is null then return jsonb_build_object('materialized', false); end if;

  update public.partner_leads
     set status = 'claimed', claimed_by = p_lead_id, claimed_at = now()
   where id = pl.id and status = 'pending';

  update public.profiles set
    full_name    = coalesce(full_name, pl.name),
    stream       = coalesce(stream, nullif(pl.extra->>'stream', '')),
    grad_year    = coalesce(grad_year, case when (pl.extra->>'graduation_year') ~ '^\d+$' then (pl.extra->>'graduation_year')::int else null end),
    utm_source   = coalesce(nullif(utm_source, ''), nullif(pl.utm_source, ''), 'schoolconnect'),
    utm_medium   = coalesce(nullif(utm_medium, ''), nullif(pl.utm_medium, ''), 'offline'),
    utm_campaign = coalesce(utm_campaign, pl.utm_campaign)
  where id = p_lead_id;

  insert into public.lead_manager (lead_id, registered_name, registered_email, registered_mobile,
                                   campus_preference, lead_source, utm_source, utm_medium, utm_campaign,
                                   lead_stage, user_registration_date)
  values (p_lead_id, pl.name, pl.email, pl.phone, pl.campus, 'schoolconnect',
          coalesce(nullif(pl.utm_source, ''), 'schoolconnect'), coalesce(nullif(pl.utm_medium, ''), 'offline'),
          pl.utm_campaign, 'lead', now())
  on conflict (lead_id) do update set
    registered_name   = coalesce(lead_manager.registered_name, excluded.registered_name),
    campus_preference = coalesce(lead_manager.campus_preference, excluded.campus_preference),
    lead_source       = 'schoolconnect',
    utm_source        = excluded.utm_source,
    utm_medium        = excluded.utm_medium,
    utm_campaign      = excluded.utm_campaign;

  if not (coalesce(pl.prepaid, false) and coalesce(pl.prepaid_amount, 0) > 0) then
    return jsonb_build_object('materialized', true, 'prepaid', false, 'partner_lead_id', pl.id);
  end if;

  select exists (select 1 from public.vsat_payments vp where vp.lead_id = p_lead_id) into v_already;
  if v_already then
    return jsonb_build_object('materialized', true, 'prepaid', true, 'already_paid', true, 'partner_lead_id', pl.id);
  end if;

  v_amount := pl.prepaid_amount;
  insert into public.vsat_payments (lead_id, paid_at, payment_ref, provider, provider_event_id, amount, currency)
  values (p_lead_id, now(), 'partner:' || pl.id::text, 'partner', 'partner:' || pl.id::text, v_amount, 'INR')
  on conflict (lead_id) do nothing;

  update public.lead_manager set lead_stage = 'applicant_paid'
   where lead_id = p_lead_id and lead_stage in ('lead', 'applicant_unpaid');

  begin
    insert into public.crm_activity_log (entity_type, application_id, lead_id, action, stage_type, to_value, metadata, actor, path)
    values ('lead', null, p_lead_id, 'stage_change', 'payment', 'payment_approved',
            jsonb_build_object('source', 'partner', 'partner_lead_id', pl.id, 'amount', v_amount), 'system', '/api/partner/lead');
  exception when others then null;
  end;

  return jsonb_build_object('materialized', true, 'prepaid', true, 'amount', v_amount, 'partner_lead_id', pl.id);
end $function$;

revoke all on function public.partner_materialize(uuid, text, text) from public, anon, authenticated;
grant execute on function public.partner_materialize(uuid, text, text) to service_role;

alter table public.lead_manager
  drop column if exists source_school,
  drop column if exists source_bdm,
  drop column if exists session_date;

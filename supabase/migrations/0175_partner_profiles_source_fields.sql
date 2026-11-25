-- 0175 · School Connect source fields on profiles too (source_school, source_bdm, session_date)
--
-- Follows 0174 (same three columns on lead_manager). Owner's call: mirror them onto the Vedam One
-- profile as well, so the student's own record carries the School Connect session school, the BDM,
-- and the session date. Still distinct from the applicant's own school captured in the VSAT form
-- (that stays on application/lead data). partner_materialize now fills profiles too, coalesce-style
-- (a re-push fills gaps, never wipes). Additive + idempotent. No RLS/grant change.

alter table public.profiles
  add column if not exists source_school text,
  add column if not exists source_bdm    text,
  add column if not exists session_date  date;

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
  v_school     text;
  v_bdm        text;
  v_session    date;
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

  -- School Connect acquisition fields: school only from the explicit extra key (never the
  -- "offline" utm_medium sentinel); BDM from extra, falling back to utm_campaign for older pushes;
  -- session_date only when a clean YYYY-MM-DD was sent.
  v_school  := nullif(pl.extra->>'school_name', '');
  v_bdm     := coalesce(nullif(pl.extra->>'bdm', ''), nullif(pl.utm_campaign, ''));
  v_session := case when (pl.extra->>'session_date') ~ '^\d{4}-\d{2}-\d{2}$' then (pl.extra->>'session_date')::date else null end;

  update public.profiles set
    full_name     = coalesce(full_name, pl.name),
    stream        = coalesce(stream, nullif(pl.extra->>'stream', '')),
    grad_year     = coalesce(grad_year, case when (pl.extra->>'graduation_year') ~ '^\d+$' then (pl.extra->>'graduation_year')::int else null end),
    utm_source    = coalesce(nullif(utm_source, ''), nullif(pl.utm_source, ''), 'schoolconnect'),
    utm_medium    = coalesce(nullif(utm_medium, ''), nullif(pl.utm_medium, ''), 'offline'),
    utm_campaign  = coalesce(utm_campaign, pl.utm_campaign),
    source_school = coalesce(source_school, v_school),
    source_bdm    = coalesce(source_bdm, v_bdm),
    session_date  = coalesce(session_date, v_session)
  where id = p_lead_id;

  insert into public.lead_manager (lead_id, registered_name, registered_email, registered_mobile,
                                   campus_preference, lead_source, utm_source, utm_medium, utm_campaign,
                                   source_school, source_bdm, session_date,
                                   lead_stage, user_registration_date)
  values (p_lead_id, pl.name, pl.email, pl.phone, pl.campus, 'schoolconnect',
          coalesce(nullif(pl.utm_source, ''), 'schoolconnect'), coalesce(nullif(pl.utm_medium, ''), 'offline'),
          pl.utm_campaign, v_school, v_bdm, v_session, 'lead', now())
  on conflict (lead_id) do update set
    registered_name   = coalesce(lead_manager.registered_name, excluded.registered_name),
    campus_preference = coalesce(lead_manager.campus_preference, excluded.campus_preference),
    lead_source       = 'schoolconnect',
    utm_source        = excluded.utm_source,
    utm_medium        = excluded.utm_medium,
    utm_campaign      = excluded.utm_campaign,
    source_school     = coalesce(excluded.source_school, lead_manager.source_school),
    source_bdm        = coalesce(excluded.source_bdm, lead_manager.source_bdm),
    session_date      = coalesce(excluded.session_date, lead_manager.session_date);

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

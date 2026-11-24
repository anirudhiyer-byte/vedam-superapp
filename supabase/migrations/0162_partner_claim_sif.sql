-- 0162 · Partner claim — SIF enrichment, verified flags, canonical school-connect source.
--
-- Extends partner_claim (0160) now that Elevate's SIF push carries the full first-half data as
-- explicit fields (stored by the inbound route in partner_leads.extra): stream, graduation_year,
-- state, city, school_name — plus the BDM (utm_campaign) and school (utm_medium). On claim we now:
--   • pre-fill those first-half fields onto lead_manager (and the application, for pre-paid leads),
--   • mark the lead phone + email verified (school-connect leads come pre-verified by Elevate),
--   • normalise the source to a canonical 'schoolconnect' (accepts "school connect"/"school_connect").
-- Everything else (phone-first/email-fallback match, pre-paid paid-mirror via vsat_payments +
-- the 0094/0115 pipeline triggers, idempotency, already-paid guard) is unchanged from 0160.
--
-- CREATE OR REPLACE only (same signature) — preserves grants. Rollback restores the 0160 body.
-- Rollback: supabase/rollback/0162_partner_claim_sif_down.sql  Tests: supabase/tests/partner_claim.test.sql

create or replace function public.partner_claim(p_lead_id uuid, p_phone text, p_email text)
returns jsonb language plpgsql security definer set search_path to '' as $fn$
declare
  v_phone_norm text := nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), '');
  v_email      text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  pl           public.partner_leads;
  v_app        text;
  v_public_id  text;
  v_amount     numeric;
  v_already    boolean;
  v_src        text;   -- canonical utm_source
  v_med        text;   -- utm_medium (school name)
  v_stream     text;
  v_gradyear   int;
  v_state      text;
  v_city       text;
  v_school     text;
begin
  if p_lead_id is null then return jsonb_build_object('claimed', false); end if;

  if v_phone_norm is not null and char_length(v_phone_norm) >= 6 then
    select * into pl from public.partner_leads
     where status = 'pending' and phone_norm = v_phone_norm
     order by created_at desc limit 1;
  end if;
  if pl.id is null and v_email is not null then
    select * into pl from public.partner_leads
     where status = 'pending' and lower(email) = v_email
     order by created_at desc limit 1;
  end if;
  if pl.id is null then return jsonb_build_object('claimed', false); end if;

  update public.partner_leads
     set status = 'claimed', claimed_by = p_lead_id, claimed_at = now()
   where id = pl.id and status = 'pending';

  -- canonical source + extra SIF fields (the inbound route stores these in extra)
  v_src := case when coalesce(pl.utm_source, '') ~* 'school[ _-]?connect' then 'schoolconnect'
                else coalesce(nullif(pl.utm_source, ''), 'schoolconnect') end;
  v_med := coalesce(nullif(pl.utm_medium, ''), nullif(pl.extra->>'school_name', ''), 'offline');
  v_stream := nullif(pl.extra->>'stream', '');
  v_state  := nullif(pl.extra->>'state', '');
  v_city   := nullif(pl.extra->>'city', '');
  v_school := coalesce(nullif(pl.extra->>'school_name', ''), nullif(pl.utm_medium, ''));
  v_gradyear := case when coalesce(pl.extra->>'graduation_year', pl.extra->>'grad_year', '') ~ '^[0-9]{4}$'
                     then (coalesce(pl.extra->>'graduation_year', pl.extra->>'grad_year'))::int else null end;

  -- attribution + first-half pre-fill + verified flags on the lead (0092 trigger builds the chain).
  -- Existing non-null values win for the data fields; attribution + verified are set to the partner's.
  insert into public.lead_manager (lead_id, registered_name, registered_email, registered_mobile,
                                   campus_preference, class_12_stream, passing_year, state, city, school_name,
                                   lead_source, utm_source, utm_medium, utm_campaign,
                                   mobile_verification_status, email_verification_status,
                                   lead_stage, user_registration_date)
  values (p_lead_id, pl.name, pl.email, pl.phone, pl.campus, v_stream, v_gradyear, v_state, v_city, v_school,
          'schoolconnect', v_src, v_med, pl.utm_campaign, 'verified', 'verified', 'lead', now())
  on conflict (lead_id) do update set
    registered_name   = coalesce(lead_manager.registered_name, excluded.registered_name),
    campus_preference = coalesce(lead_manager.campus_preference, excluded.campus_preference),
    class_12_stream   = coalesce(lead_manager.class_12_stream, excluded.class_12_stream),
    passing_year      = coalesce(lead_manager.passing_year, excluded.passing_year),
    state             = coalesce(lead_manager.state, excluded.state),
    city              = coalesce(lead_manager.city, excluded.city),
    school_name       = coalesce(lead_manager.school_name, excluded.school_name),
    lead_source       = 'schoolconnect',
    utm_source        = excluded.utm_source,
    utm_medium        = excluded.utm_medium,
    utm_campaign      = excluded.utm_campaign,
    mobile_verification_status = 'verified',
    email_verification_status  = 'verified';

  -- school-connect leads arrive pre-verified by Elevate
  update public.profiles set mobile_verified = true, email_verified = true where id = p_lead_id;

  if not (coalesce(pl.prepaid, false) and coalesce(pl.prepaid_amount, 0) > 0) then
    return jsonb_build_object('claimed', true, 'prepaid', false, 'partner_lead_id', pl.id);
  end if;

  select exists (select 1 from public.vsat_payments vp where vp.lead_id = p_lead_id) into v_already;
  if v_already then
    return jsonb_build_object('claimed', true, 'prepaid', true, 'already_paid', true, 'partner_lead_id', pl.id);
  end if;

  v_amount := pl.prepaid_amount;
  select public_id into v_public_id from public.profiles where id = p_lead_id;

  select application_id into v_app from public.application_manager where lead_id = p_lead_id;
  if v_app is null then
    v_app := 'VDM-' || upper(substr(md5(gen_random_uuid()::text), 1, 5)) || upper(substr(md5(clock_timestamp()::text), 1, 3));
    insert into public.application_manager (
      application_id, lead_id, application_no, registered_name, registered_email, registered_mobile,
      campus_applied, class_12_stream, class12_year, state, city, class12_school, form_name, current_attempt,
      payment_stage_1, application_stage_1, payment_status, payment_approved_date,
      payment_amount, application_fee_amount, currency, created_at, last_updated_date
    ) values (
      v_app, p_lead_id, v_public_id, pl.name, pl.email, pl.phone,
      pl.campus, v_stream, v_gradyear, v_state, v_city, v_school, 'VSAT Application', 1,
      'payment_approved', 'mock_enabled', 'approved', now(),
      v_amount, v_amount, 'INR', now(), now()
    );
  else
    update public.application_manager set
      payment_stage_1 = 'payment_approved', application_stage_1 = 'mock_enabled',
      payment_status = 'approved', payment_approved_date = coalesce(payment_approved_date, now()),
      payment_amount = coalesce(payment_amount, v_amount), application_fee_amount = v_amount,
      class_12_stream = coalesce(class_12_stream, v_stream), class12_year = coalesce(class12_year, v_gradyear),
      state = coalesce(state, v_state), city = coalesce(city, v_city), class12_school = coalesce(class12_school, v_school),
      currency = coalesce(currency, 'INR'), last_updated_date = now()
     where application_id = v_app;
  end if;

  insert into public.vsat_payments (lead_id, paid_at, payment_ref, provider, provider_event_id, amount, currency)
  values (p_lead_id, now(), 'partner:' || pl.id::text, 'partner', 'partner:' || pl.id::text, v_amount, 'INR')
  on conflict (lead_id) do nothing;

  update public.lead_manager set lead_stage = 'applicant_paid'
   where lead_id = p_lead_id and lead_stage in ('lead', 'applicant_unpaid');

  insert into public.crm_activity_log (entity_type, application_id, lead_id, action, stage_type, to_value, metadata, actor, path)
  values ('application', v_app, p_lead_id, 'stage_change', 'payment', 'payment_approved',
          jsonb_build_object('source', 'partner', 'partner_lead_id', pl.id, 'amount', v_amount), 'system', '/api/vsat/lead');

  return jsonb_build_object('claimed', true, 'prepaid', true, 'amount', v_amount, 'application_id', v_app, 'partner_lead_id', pl.id);
end $fn$;
revoke all on function public.partner_claim(uuid, text, text) from public, anon, authenticated;
grant execute on function public.partner_claim(uuid, text, text) to service_role;

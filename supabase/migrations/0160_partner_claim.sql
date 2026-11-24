-- 0160 · Partner lead claim-on-login (Elevate / School Connect BDM leads).
--
-- A partner pushes leads before the student has a Vedam login (parked in partner_leads, 0155).
-- When the student later logs in — phone OTP or email — /api/vsat/lead creates their lead_manager
-- row and then calls partner_claim(), which matches a PENDING partner_leads row (phone first,
-- email fallback), marks it claimed, stamps the partner attribution (utm_source=schoolconnect,
-- utm_medium=offline, utm_campaign=<BDM>) onto the lead, and — when the push carried a pre-paid
-- discounted VSAT fee — mirrors a real paid state so the student's dashboard shows the fee already
-- paid and the admin fee column reflects the pushed amount.
--
-- How the pre-paid mirror stays consistent with the rest of the system (no new pipeline code):
--   • Inserting the application_manager row fires vsat__on_application (0094) → a vsat_pipeline
--     row at 'applied'.
--   • Inserting the vsat_payments row fires vsat__on_payment (0115) → advances 'applied' →
--     'application_fee_paid'. vsat_payments stays THE source of truth for "paid".
--   • The "Start application" route (/api/vsat/application) never downgrades payment stages on a
--     revisit, so a pre-created paid row is safe.
--
-- vsat_payments is write-once and normally webhook-only; this adds a new provider 'partner' for
-- pre-payments taken by the partner, written server-side (service role), never from a browser —
-- approved by the owner for this feature. Rollback: supabase/rollback/0160_partner_claim_down.sql
-- Tests: supabase/tests/partner_claim.test.sql

-- 1) allow the 'partner' provider on the write-once payments table
alter table public.vsat_payments drop constraint if exists vsat_payments_provider_check;
alter table public.vsat_payments add constraint vsat_payments_provider_check
  check (provider in ('cashfree', 'backfill', 'simulated', 'partner'));

-- 2) the claim. SECURITY DEFINER; service-role only (called by /api/vsat/lead with the service key).
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
begin
  if p_lead_id is null then return jsonb_build_object('claimed', false); end if;

  -- match a PENDING partner lead: phone first (the required key on the push), then email
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

  -- partner attribution on the lead (the 0092 trigger rebuilds primary/latest from these parts).
  -- The lead_manager row already exists (the /api/vsat/lead upsert ran first); upsert defensively.
  -- Name/campus only fill a gap; the UTM is set to the partner's values (that is the point of the push).
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

  -- not pre-paid → attribution-only claim
  if not (coalesce(pl.prepaid, false) and coalesce(pl.prepaid_amount, 0) > 0) then
    return jsonb_build_object('claimed', true, 'prepaid', false, 'partner_lead_id', pl.id);
  end if;

  -- already has a real payment → leave payment state untouched, just report claimed
  select exists (select 1 from public.vsat_payments vp where vp.lead_id = p_lead_id) into v_already;
  if v_already then
    return jsonb_build_object('claimed', true, 'prepaid', true, 'already_paid', true, 'partner_lead_id', pl.id);
  end if;

  v_amount := pl.prepaid_amount;
  select public_id into v_public_id from public.profiles where id = p_lead_id;

  -- ensure a paid application_manager row (INSERT → vsat__on_application seeds the pipeline at 'applied')
  select application_id into v_app from public.application_manager where lead_id = p_lead_id;
  if v_app is null then
    v_app := 'VDM-' || upper(substr(md5(gen_random_uuid()::text), 1, 5)) || upper(substr(md5(clock_timestamp()::text), 1, 3));
    insert into public.application_manager (
      application_id, lead_id, application_no, registered_name, registered_email, registered_mobile,
      campus_applied, form_name, current_attempt,
      payment_stage_1, application_stage_1, payment_status, payment_approved_date,
      payment_amount, application_fee_amount, currency, created_at, last_updated_date
    ) values (
      v_app, p_lead_id, v_public_id, pl.name, pl.email, pl.phone,
      pl.campus, 'VSAT Application', 1,
      'payment_approved', 'mock_enabled', 'approved', now(),
      v_amount, v_amount, 'INR', now(), now()
    );
  else
    update public.application_manager set
      payment_stage_1 = 'payment_approved', application_stage_1 = 'mock_enabled',
      payment_status = 'approved', payment_approved_date = coalesce(payment_approved_date, now()),
      payment_amount = coalesce(payment_amount, v_amount), application_fee_amount = v_amount,
      currency = coalesce(currency, 'INR'), last_updated_date = now()
     where application_id = v_app;
  end if;

  -- vsat_payments = the source of truth (write-once). INSERT → vsat__on_payment advances the pipeline.
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

comment on function public.partner_claim(uuid, text, text) is
  'Claim a pending partner_leads row for a just-logged-in user (phone-first, email fallback): stamp partner attribution on the lead and, when pre-paid, mirror a real paid VSAT state (vsat_payments provider=partner). Service role only.';

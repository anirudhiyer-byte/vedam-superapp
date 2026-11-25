-- 0172_partner_materialize.sql
-- Eager inbound materialization for partner (Elevate / School Connect) leads.
--
-- Change from the lazy claim (0160): a pushed lead becomes a real Vedam One profile + a
-- lead_manager row AT PUSH TIME (the /api/partner/lead route creates a placeholder auth user
-- first — handle_new_user seeds the profile — then calls this). No "claim on login" is needed
-- for the row to exist or for comms to reach them.
--
-- Difference from partner_claim: this NEVER creates an application_manager row. A pushed lead
-- (even a prepaid one) has NO application until the student reaches the dashboard and starts one.
-- When prepaid, we still write the write-once vsat_payments row (provider 'partner'); its
-- vsat__on_payment trigger no-ops while there is no application, and vsat__on_application
-- (patched below) later starts that student's pipeline at 'application_fee_paid'.
--
-- Service-role only. Rollback: supabase/rollback/0172_partner_materialize_down.sql
-- Tests: supabase/tests/partner_materialize.test.sql

-- 1) Eager materialize a pending partner_leads row onto an (already-created) auth user.
create or replace function public.partner_materialize(p_lead_id uuid, p_phone text, p_email text)
returns jsonb language plpgsql security definer set search_path to '' as $fn$
declare
  v_phone_norm text := nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), '');
  v_email      text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  pl           public.partner_leads;
  v_amount     numeric;
  v_already    boolean;
begin
  if p_lead_id is null then return jsonb_build_object('materialized', false); end if;

  -- match a PENDING partner lead: phone first (the required key on the push), then email
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

  -- fill profile gaps (handle_new_user already seeded from the auth metadata; defensive for re-push)
  update public.profiles set
    full_name    = coalesce(full_name, pl.name),
    stream       = coalesce(stream, nullif(pl.extra->>'stream', '')),
    grad_year    = coalesce(grad_year, case when (pl.extra->>'graduation_year') ~ '^\d+$' then (pl.extra->>'graduation_year')::int else null end),
    utm_source   = coalesce(nullif(utm_source, ''), nullif(pl.utm_source, ''), 'schoolconnect'),
    utm_medium   = coalesce(nullif(utm_medium, ''), nullif(pl.utm_medium, ''), 'offline'),
    utm_campaign = coalesce(utm_campaign, pl.utm_campaign)
  where id = p_lead_id;

  -- lead_manager attribution (same shape as partner_claim; the 0092 trigger rebuilds primary/latest)
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

  -- not pre-paid → attribution-only materialization
  if not (coalesce(pl.prepaid, false) and coalesce(pl.prepaid_amount, 0) > 0) then
    return jsonb_build_object('materialized', true, 'prepaid', false, 'partner_lead_id', pl.id);
  end if;

  -- already has a real payment → leave it
  select exists (select 1 from public.vsat_payments vp where vp.lead_id = p_lead_id) into v_already;
  if v_already then
    return jsonb_build_object('materialized', true, 'prepaid', true, 'already_paid', true, 'partner_lead_id', pl.id);
  end if;

  v_amount := pl.prepaid_amount;
  -- write-once paid state. NO application_manager here (created only when the student starts one).
  insert into public.vsat_payments (lead_id, paid_at, payment_ref, provider, provider_event_id, amount, currency)
  values (p_lead_id, now(), 'partner:' || pl.id::text, 'partner', 'partner:' || pl.id::text, v_amount, 'INR')
  on conflict (lead_id) do nothing;

  update public.lead_manager set lead_stage = 'applicant_paid'
   where lead_id = p_lead_id and lead_stage in ('lead', 'applicant_unpaid');

  -- best-effort activity log (never block materialization on a logging schema mismatch)
  begin
    insert into public.crm_activity_log (entity_type, application_id, lead_id, action, stage_type, to_value, metadata, actor, path)
    values ('lead', null, p_lead_id, 'stage_change', 'payment', 'payment_approved',
            jsonb_build_object('source', 'partner', 'partner_lead_id', pl.id, 'amount', v_amount), 'system', '/api/partner/lead');
  exception when others then null;
  end;

  return jsonb_build_object('materialized', true, 'prepaid', true, 'amount', v_amount, 'partner_lead_id', pl.id);
end $fn$;
revoke all on function public.partner_materialize(uuid, text, text) from public, anon, authenticated;
grant execute on function public.partner_materialize(uuid, text, text) to service_role;

comment on function public.partner_materialize(uuid, text, text) is
  'Eager inbound: materialize a pending partner_leads row onto an already-created auth user — lead_manager + profile gaps + (if prepaid) write-once vsat_payments. Never creates an application_manager row. Service role only.';

-- 1b) Find an existing auth user by phone (last-10 match, robust to +91/0 prefixes) or email.
--     Lets the inbound route reuse an account instead of creating a duplicate (and is the
--     "you already have a profile" dedupe). Service-role only.
create or replace function public.partner_find_user(p_phone text, p_email text)
returns uuid language sql stable security definer set search_path to '' as $fn$
  select u.id from auth.users u
   where (nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), '') is not null
          and right(regexp_replace(coalesce(u.phone, ''), '[^0-9]', '', 'g'), 10)
            = right(regexp_replace(p_phone, '[^0-9]', '', 'g'), 10))
      or (nullif(lower(btrim(coalesce(p_email, ''))), '') is not null
          and lower(u.email) = lower(btrim(p_email)))
   order by u.created_at asc
   limit 1
$fn$;
revoke all on function public.partner_find_user(text, text) from public, anon, authenticated;
grant execute on function public.partner_find_user(text, text) to service_role;

-- 1c) When an application_manager row is inserted for a lead that ALREADY has a payment
--     (a prepaid partner lead reaching the dashboard), reflect the paid state on the row so the
--     admin grid's Payment Status shows approved. BEFORE INSERT → edits NEW, no recursion.
--     Normal flow is untouched: students pay AFTER applying, so no payment exists at insert time.
create or replace function public.vsat__app_prepaid_reflect()
returns trigger language plpgsql security definer set search_path to '' as $fn$
declare amt numeric;
begin
  if new.payment_stage_1 is distinct from 'payment_approved'::public.vm_payment_stage then
    select vp.amount into amt from public.vsat_payments vp where vp.lead_id = new.lead_id limit 1;
    if found then
      new.payment_stage_1        := 'payment_approved';
      new.payment_status         := coalesce(new.payment_status, 'approved');
      new.payment_approved_date  := coalesce(new.payment_approved_date, now());
      new.payment_amount         := coalesce(new.payment_amount, amt);
      new.application_fee_amount := coalesce(new.application_fee_amount, amt);
    end if;
  end if;
  return new;
end $fn$;
drop trigger if exists trg_vsat_app_prepaid_reflect on public.application_manager;
create trigger trg_vsat_app_prepaid_reflect before insert on public.application_manager
  for each row execute function public.vsat__app_prepaid_reflect();

-- 2) When a student later starts an application and a payment already exists (prepaid partner
--    lead), start their pipeline at application_fee_paid instead of applied. SELECT-only check —
--    no write to application_manager, so no trigger recursion. Normal flow (pay after applying)
--    is unchanged: at application-insert time no payment exists yet, so v_paid is false.
create or replace function public.vsat__on_application()
returns trigger language plpgsql security definer set search_path to '' as $fn$
declare
  st text; stt text;
  v_attempt int := least(greatest(coalesce(new.current_attempt, 1), 1), 2);
  v_paid boolean;
  v_base text;
begin
  if not exists (select 1 from public.vsat_pipeline vp where vp.application_id = new.application_id) then
    v_paid := exists (select 1 from public.vsat_payments vp where vp.lead_id = new.lead_id);
    v_base := case when new.exam_date_id is not null then 'booked'
                   when v_paid then 'application_fee_paid'
                   else 'applied' end;
    insert into public.vsat_pipeline (application_id, attempt_no, stage, status)
    values (new.application_id, v_attempt, v_base, 'active')
    on conflict (application_id) do nothing;
    if found then
      insert into public.vsat_stage_history (application_id, attempt_no, to_stage, to_status, source)
      values (new.application_id, v_attempt, v_base, 'active', 'system');
    end if;
  elsif new.exam_date_id is not null then
    select vp.stage, vp.status into st, stt from public.vsat_pipeline vp where vp.application_id = new.application_id;
    if st in ('applied', 'application_fee_paid') and stt = 'active' then
      perform public.vsat__move(new.application_id, 'booked', 'active', null, 'system', null, null);
    end if;
  end if;
  if coalesce(new.exam_given, false) and (tg_op = 'INSERT' or not coalesce(old.exam_given, false)) then
    select vp.stage, vp.status into st, stt from public.vsat_pipeline vp where vp.application_id = new.application_id;
    if st in ('booked', 'eligible') and stt = 'active' then
      perform public.vsat__move(new.application_id, 'exam_taken', 'active', null, 'system', null, null);
    end if;
  end if;
  return null;
end $fn$;

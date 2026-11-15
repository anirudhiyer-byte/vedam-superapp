-- 0090 · Student dashboard: "My payments" + "My communications" (read-only, owner-scoped).
--
-- Three SECURITY DEFINER RPCs the applicant dashboard calls as the logged-in user.
-- Every one resolves the caller purely from auth.uid(); the caller's email/phone are
-- looked up server-side from their OWN rows (application_manager / profiles / auth),
-- never taken from client input, so a student can only ever see their own records.
--
--   vsat_my_payments()            -> the caller's PAID vsat_payment_orders (vsat_fee per
--                                    attempt + enrollment), for the receipts list.
--   vsat_my_communications(limit) -> the caller's emails (email_events, by user_id or own
--                                    email) + WhatsApp (whatsapp_sends, by own phone's last
--                                    10 digits), newest first. No bodies here.
--   vsat_my_email_body(id)        -> the saved HTML of ONE of the caller's own emails.
--
-- Tables stay locked (RLS on, no browser grants) — these definer functions are the only
-- read path, and they filter to the caller. Rollback: supabase/rollback/0090_*_down.sql
-- Never touches production without approval.

-- Functional indexes so the per-user lookups stay cheap as the comms tables grow.
create index if not exists email_events_user_id_idx
  on public.email_events (user_id);
create index if not exists email_events_to_email_lower_idx
  on public.email_events (lower(to_email));
create index if not exists whatsapp_sends_last10_idx
  on public.whatsapp_sends ((right(regexp_replace(coalesce(to_number, ''), '\D', '', 'g'), 10)));

-- ── My payments ─────────────────────────────────────────────────────────────
create or replace function public.vsat_my_payments()
returns jsonb
language plpgsql
security definer
set search_path to ''
as $fn$
declare
  v_uid uuid := auth.uid();
  v_rows jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'AUTH_REQUIRED');
  end if;

  select coalesce(jsonb_agg(to_jsonb(t) order by t.paid_at desc nulls last), '[]'::jsonb)
    into v_rows
  from (
    select
      o.cf_order_id       as order_id,
      o.kind              as kind,
      o.attempt           as attempt,
      o.base_amount       as base_amount,
      o.discount          as discount,
      o.discount_coupon   as coupon,
      o.amount            as amount,
      o.currency          as currency,
      o.cf_payment_id     as payment_id,
      o.cf_payment_method as method,
      coalesce(p.paid_at, am.enrollment_paid_at, o.updated_at) as paid_at
    from public.vsat_payment_orders o
    left join public.vsat_payments p
      on o.kind = 'vsat_fee' and p.payment_ref = o.cf_order_id and p.lead_id = o.lead_id
    left join public.application_manager am
      on am.lead_id = o.lead_id
    where o.lead_id = v_uid
      and o.status = 'paid'
  ) t;

  return jsonb_build_object('ok', true, 'payments', v_rows);
end;
$fn$;

revoke all on function public.vsat_my_payments() from public, anon;
grant execute on function public.vsat_my_payments() to authenticated;

-- ── My communications (list) ────────────────────────────────────────────────
create or replace function public.vsat_my_communications(p_limit integer default 50)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $fn$
declare
  v_uid    uuid := auth.uid();
  v_email  text;
  v_phone10 text;
  v_lim    integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_rows   jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'AUTH_REQUIRED');
  end if;

  -- the caller's own email + phone, from their own rows only (never client input)
  select
    lower(nullif(coalesce(am.registered_email, pr.email, u.email), '')),
    nullif(right(regexp_replace(coalesce(am.registered_mobile, pr.phone, lm.registered_mobile, u.phone, ''), '\D', '', 'g'), 10), '')
  into v_email, v_phone10
  from auth.users u
  left join public.application_manager am on am.lead_id = v_uid
  left join public.profiles pr           on pr.id      = v_uid
  left join public.lead_manager lm       on lm.lead_id = v_uid
  where u.id = v_uid;

  if v_phone10 is not null and char_length(v_phone10) < 10 then
    v_phone10 := null;
  end if;

  with em as (
    select
      e.id                                                 as id,
      'email'::text                                        as channel,
      coalesce(nullif(e.subject, ''), nullif(e.ref_name, ''), 'Email') as title,
      e.kind                                               as kind,
      e.status                                             as status,
      e.sent_at                                            as at,
      true                                                 as has_body
    from public.email_events e
    where e.sent_at is not null
      and (e.user_id = v_uid or (v_email is not null and lower(e.to_email) = v_email))
  ),
  wa as (
    select
      w.id                                                 as id,
      'whatsapp'::text                                     as channel,
      coalesce(nullif(w.campaign_name, ''), nullif(w.template_id, ''), 'WhatsApp message') as title,
      w.message_type                                       as kind,
      w.status                                             as status,
      w.created_at                                         as at,
      false                                                as has_body
    from public.whatsapp_sends w
    where v_phone10 is not null
      and right(regexp_replace(coalesce(w.to_number, ''), '\D', '', 'g'), 10) = v_phone10
  )
  select coalesce(jsonb_agg(to_jsonb(m) order by m.at desc), '[]'::jsonb)
    into v_rows
  from (
    select * from em
    union all
    select * from wa
    order by at desc
    limit v_lim
  ) m;

  return jsonb_build_object('ok', true, 'items', v_rows);
end;
$fn$;

revoke all on function public.vsat_my_communications(integer) from public, anon;
grant execute on function public.vsat_my_communications(integer) to authenticated;

-- ── One email's saved body (owner-only) ─────────────────────────────────────
create or replace function public.vsat_my_email_body(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $fn$
declare
  v_uid     uuid := auth.uid();
  v_email   text;
  v_html    text;
  v_subject text;
  v_at      timestamptz;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'AUTH_REQUIRED');
  end if;

  select lower(nullif(coalesce(am.registered_email, pr.email, u.email), ''))
    into v_email
  from auth.users u
  left join public.application_manager am on am.lead_id = v_uid
  left join public.profiles pr           on pr.id      = v_uid
  where u.id = v_uid;

  select e.html_snapshot, e.subject, e.sent_at
    into v_html, v_subject, v_at
  from public.email_events e
  where e.id = p_id
    and (e.user_id = v_uid or (v_email is not null and lower(e.to_email) = v_email))
  limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;

  return jsonb_build_object('ok', true, 'subject', coalesce(v_subject, 'Email'),
                            'sent_at', v_at, 'html', coalesce(v_html, ''));
end;
$fn$;

revoke all on function public.vsat_my_email_body(uuid) from public, anon;
grant execute on function public.vsat_my_email_body(uuid) to authenticated;

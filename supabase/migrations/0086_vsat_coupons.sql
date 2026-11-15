-- 0086 · VSAT manual coupons.
--
-- The dormant base-schema table public.vsat_coupons (RLS on, no policies, no grants —
-- see 0001) is extended into the coupon catalog for the VSAT ₹1000 fee. Admin creates
-- codes with a flat (or percent) value, a note (who it's for), on/off toggle, optional
-- expiry window and optional max-uses; a usage counter tracks redemptions.
--
-- MERGE RULE (not stacking): a coupon never stacks on top of the automatic 24-hour
-- ₹200 early-bird discount. The student always gets the BETTER of the two, never the
-- sum. So a ₹750 coupon used inside the 24h window still totals ₹750 off (shown as
-- ₹200 auto + ₹550 coupon); after the window it is the full ₹750. The merge arithmetic
-- lives server-side in src/lib/payments/vsat-fee.ts; this migration is the catalog +
-- admin RPCs only. Pricing is always server-authoritative (service role) — browsers get
-- no table access and cannot call pricing directly.
--
-- Security: RLS stays ON with no policies; all admin management is through these
-- SECURITY DEFINER, is_admin()-gated functions with search_path '' , revoked from
-- public/anon and granted only to authenticated.

-- ---------------------------------------------------------------------------
-- 1. Extend the catalog table
-- ---------------------------------------------------------------------------
alter table public.vsat_coupons
  add column if not exists note                text,
  add column if not exists max_uses            integer,                       -- null = unlimited
  add column if not exists used_count          integer not null default 0,
  add column if not exists visible_at_checkout  boolean not null default false,
  add column if not exists created_by          uuid;

-- coupon_type is NOT NULL with no default in the base schema; give our inserts a safe
-- default so the catalog is usable (every row we create is a VSAT-fee coupon).
alter table public.vsat_coupons alter column coupon_type set default 'vsat';

-- guard rails
alter table public.vsat_coupons
  add constraint vsat_coupons_amount_pos        check (amount > 0)                                   not valid;
alter table public.vsat_coupons
  add constraint vsat_coupons_discount_type_ck  check (discount_type in ('flat','percent'))         not valid;
alter table public.vsat_coupons
  add constraint vsat_coupons_max_uses_pos      check (max_uses is null or max_uses > 0)            not valid;
alter table public.vsat_coupons
  add constraint vsat_coupons_used_count_nonneg check (used_count >= 0)                              not valid;

-- codes are the redemption key: unique, case-insensitive
create unique index if not exists vsat_coupons_code_lower_uidx
  on public.vsat_coupons (lower(code)) where code is not null;

-- ---------------------------------------------------------------------------
-- 2. Admin RPCs (SECURITY DEFINER, admin-only)
-- ---------------------------------------------------------------------------

-- List every coupon with its usage, for the admin coupon maker.
create or replace function public.vsat_coupon_list()
returns jsonb language plpgsql stable security definer set search_path to '' as $fn$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode='42501'; end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id,
      'code', c.code,
      'amount', c.amount,
      'discount_type', c.discount_type,
      'note', c.note,
      'active', c.active,
      'valid_from', c.valid_from,
      'valid_to', c.valid_to,
      'max_uses', c.max_uses,
      'used_count', c.used_count,
      'uses_left', case when c.max_uses is null then null else greatest(c.max_uses - c.used_count, 0) end,
      'visible_at_checkout', c.visible_at_checkout,
      'created_at', c.created_at
    ) order by c.created_at desc), '[]'::jsonb)
    from public.vsat_coupons c
    where c.coupon_type = 'vsat'
  );
end; $fn$;
revoke execute on function public.vsat_coupon_list() from public, anon;
grant execute on function public.vsat_coupon_list() to authenticated;

-- Create a coupon. Rejects unknown keys implicitly (reads only the whitelisted ones).
create or replace function public.vsat_coupon_create(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $fn$
declare
  v_code  text := upper(nullif(btrim(p->>'code'),''));
  v_amt   numeric := nullif(p->>'amount','')::numeric;
  v_dtype text := coalesce(nullif(btrim(p->>'discount_type'),''),'flat');
  v_max   integer := nullif(p->>'max_uses','')::integer;
  v_from  timestamptz := nullif(p->>'valid_from','')::timestamptz;
  v_to    timestamptz := nullif(p->>'valid_to','')::timestamptz;
  v_vis   boolean := coalesce((p->>'visible_at_checkout')::boolean, false);
  v_active boolean := coalesce((p->>'active')::boolean, true);
  v_id uuid;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode='42501'; end if;
  if v_code is null then return jsonb_build_object('ok',false,'error','missing_code'); end if;
  if v_amt is null or v_amt <= 0 then return jsonb_build_object('ok',false,'error','bad_amount'); end if;
  if v_dtype not in ('flat','percent') then return jsonb_build_object('ok',false,'error','bad_discount_type'); end if;
  if v_dtype = 'percent' and v_amt > 100 then return jsonb_build_object('ok',false,'error','percent_over_100'); end if;
  if v_max is not null and v_max <= 0 then return jsonb_build_object('ok',false,'error','bad_max_uses'); end if;
  if exists (select 1 from public.vsat_coupons where lower(code) = lower(v_code)) then
    return jsonb_build_object('ok',false,'error','code_exists');
  end if;
  insert into public.vsat_coupons(code, coupon_type, discount_type, amount, note,
                                  valid_from, valid_to, max_uses, visible_at_checkout, active, created_by)
  values (v_code, 'vsat', v_dtype, v_amt, nullif(btrim(p->>'note'),''),
          v_from, v_to, v_max, v_vis, v_active, auth.uid())
  returning id into v_id;
  return jsonb_build_object('ok',true,'id',v_id);
end; $fn$;
revoke execute on function public.vsat_coupon_create(jsonb) from public, anon;
grant execute on function public.vsat_coupon_create(jsonb) to authenticated;

-- Update a coupon: toggle active, edit note/amount/type/window/max_uses/visibility.
create or replace function public.vsat_coupon_update(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $fn$
declare v_id uuid := nullif(p->>'id','')::uuid;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode='42501'; end if;
  if v_id is null then return jsonb_build_object('ok',false,'error','missing_id'); end if;
  update public.vsat_coupons c set
    active              = coalesce((p->>'active')::boolean, c.active),
    note                = case when p ? 'note' then nullif(btrim(p->>'note'),'') else c.note end,
    amount              = coalesce(nullif(p->>'amount','')::numeric, c.amount),
    discount_type       = coalesce(nullif(btrim(p->>'discount_type'),''), c.discount_type),
    valid_from          = case when p ? 'valid_from' then nullif(p->>'valid_from','')::timestamptz else c.valid_from end,
    valid_to            = case when p ? 'valid_to'   then nullif(p->>'valid_to','')::timestamptz   else c.valid_to end,
    max_uses            = case when p ? 'max_uses'   then nullif(p->>'max_uses','')::integer       else c.max_uses end,
    visible_at_checkout = coalesce((p->>'visible_at_checkout')::boolean, c.visible_at_checkout)
  where c.id = v_id;
  if not found then return jsonb_build_object('ok',false,'error','not_found'); end if;
  return jsonb_build_object('ok',true);
end; $fn$;
revoke execute on function public.vsat_coupon_update(jsonb) from public, anon;
grant execute on function public.vsat_coupon_update(jsonb) to authenticated;

-- Delete a coupon (only if never redeemed; otherwise deactivate to preserve attribution).
create or replace function public.vsat_coupon_delete(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $fn$
declare v_id uuid := nullif(p->>'id','')::uuid; v_used integer;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode='42501'; end if;
  if v_id is null then return jsonb_build_object('ok',false,'error','missing_id'); end if;
  select used_count into v_used from public.vsat_coupons where id = v_id;
  if v_used is null then return jsonb_build_object('ok',false,'error','not_found'); end if;
  if v_used > 0 then return jsonb_build_object('ok',false,'error','already_used'); end if;
  delete from public.vsat_coupons where id = v_id;
  return jsonb_build_object('ok',true);
end; $fn$;
revoke execute on function public.vsat_coupon_delete(jsonb) from public, anon;
grant execute on function public.vsat_coupon_delete(jsonb) to authenticated;

-- Atomic redemption counter, called server-side (service role) from the payment
-- confirmation once a coupon-bearing order first settles PAID. NOT callable by
-- browsers (revoked from authenticated) — only the service role increments usage.
create or replace function public.vsat_coupon_increment_use(p_code text)
returns void language sql security definer set search_path to '' as $fn$
  update public.vsat_coupons set used_count = used_count + 1
  where lower(code) = lower(p_code) and coupon_type = 'vsat';
$fn$;
revoke execute on function public.vsat_coupon_increment_use(text) from public, anon, authenticated;
grant execute on function public.vsat_coupon_increment_use(text) to service_role;

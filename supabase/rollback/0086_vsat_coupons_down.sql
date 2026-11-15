-- Rollback 0086 · remove VSAT coupon RPCs + the columns/constraints added to
-- public.vsat_coupons. The base table itself (pre-migration) is left in place.

drop function if exists public.vsat_coupon_list();
drop function if exists public.vsat_coupon_create(jsonb);
drop function if exists public.vsat_coupon_update(jsonb);
drop function if exists public.vsat_coupon_delete(jsonb);
drop function if exists public.vsat_coupon_increment_use(text);

drop index if exists public.vsat_coupons_code_lower_uidx;

alter table public.vsat_coupons drop constraint if exists vsat_coupons_amount_pos;
alter table public.vsat_coupons drop constraint if exists vsat_coupons_discount_type_ck;
alter table public.vsat_coupons drop constraint if exists vsat_coupons_max_uses_pos;
alter table public.vsat_coupons drop constraint if exists vsat_coupons_used_count_nonneg;

alter table public.vsat_coupons alter column coupon_type drop default;

alter table public.vsat_coupons
  drop column if exists note,
  drop column if exists max_uses,
  drop column if exists used_count,
  drop column if exists visible_at_checkout,
  drop column if exists created_by;

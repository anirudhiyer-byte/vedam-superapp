-- Rollback for 0037_vsat_payment_orders.sql
-- Refuses to drop the ledger if it holds any real (paid) order, so a rollback
-- can never destroy payment bookkeeping. 'created'/'failed' rows are disposable.

do $$
begin
  if to_regclass('public.vsat_payment_orders') is not null
     and exists (select 1 from public.vsat_payment_orders where status = 'paid') then
    raise exception 'vsat_payment_orders has paid orders — export them before rolling back 0037';
  end if;
end $$;

drop table if exists public.vsat_payment_orders;   -- drops its trigger too
drop function if exists public.vsat_payment_orders_touch();

delete from public.app_flags where key in ('vsat_fee', 'vsat_discount_24h') and updated_by = '0037_migration';

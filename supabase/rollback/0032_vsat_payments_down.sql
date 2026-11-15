-- Rollback for 0032_vsat_payments.sql
-- Run 0033's rollback first. Refuses to drop the table if it holds any real
-- (non-simulated) payment, so a rollback can never destroy payment records.
do $$
begin
  if to_regclass('public.vsat_payments') is not null
     and exists (select 1 from public.vsat_payments where provider <> 'simulated') then
    raise exception 'vsat_payments has real payment rows — export them before rolling back 0032';
  end if;
end $$;

drop table if exists public.vsat_payments;   -- drops its triggers too
drop function if exists public.vsat_payments_guard();

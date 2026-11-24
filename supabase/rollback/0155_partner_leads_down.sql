-- Rollback 0155 · drop the partner lead intake staging table.
drop trigger if exists trg_partner_leads_touch on public.partner_leads;
drop function if exists public.partner_leads_touch();
drop table if exists public.partner_leads;
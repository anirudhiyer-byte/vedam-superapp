-- Rollback for 0092_vsat_attribution.sql
-- Drops ONLY what 0092 added. lead_manager's pre-existing primary_utm/secondary_utm/
-- tertiary_utm/latest_utm are left untouched (they existed before 0092).

drop trigger if exists trg_vsat_application_inherit_attr on public.application_manager;
drop trigger if exists trg_vsat_lead_attribution on public.lead_manager;

drop function if exists public.vsat__application_inherit_attr();
drop function if exists public.vsat__lead_attribution();

drop index if exists public.application_manager_latest_utm_idx;
drop index if exists public.application_manager_primary_utm_idx;
drop index if exists public.lead_manager_latest_utm_idx;
drop index if exists public.lead_manager_primary_utm_idx;

alter table public.application_manager
  drop column if exists primary_utm,
  drop column if exists secondary_utm,
  drop column if exists tertiary_utm,
  drop column if exists latest_utm,
  drop column if exists primary_utm_source,
  drop column if exists primary_utm_medium,
  drop column if exists primary_utm_campaign;

alter table public.lead_manager
  drop column if exists primary_utm_source,
  drop column if exists primary_utm_medium,
  drop column if exists primary_utm_campaign;

-- helper last (the indexes above depended on it)
drop function if exists public.vsat__norm_utm(text);

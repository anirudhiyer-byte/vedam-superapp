-- ===========================================================================
-- 0021_growth_cpl_base_total_cost
-- Fix a regression from 0020: non-telegram CPL must derive from the actual
-- spend, which lives in total_cost (cpl_spend is often 0 in prod). 0020 was
-- rebuilt from the stale 0009 file which divided by cpl_spend -> CPL showed 0
-- for rows like "Ads - Meta / Codesprint" (total_cost 5712, cpl_spend 0).
-- Non-telegram CPL = round(coalesce(nullif(total_cost,0), cpl_spend) / leads).
-- Telegram branch (CPL set -> cost = CPL x leads) unchanged. View-only.
-- ===========================================================================

create or replace view public.growth_cs_cost_view as
with link as (
  select r.id,
    public.utm_triple(
      public.utm_param(r.utm_link, 'utm_source'),
      public.utm_param(r.utm_link, 'utm_medium'),
      public.utm_param(r.utm_link, 'utm_campaign')
    ) as triple
  from public.growth_cs_cost_rows r
),
parts as (
  select
    coalesce(
      public.utm_triple(c.utm_source, c.utm_medium, c.utm_campaign),
      p.utm_primary,
      public.utm_triple(l.utm_source, l.utm_medium, l.utm_campaign),
      l.primary_attribution
    ) as triple,
    ((coalesce(l.class_12_stream, p.stream) = any(array['PCM'::text,'PCMB'::text]))
      and (coalesce(nullif(l.passing_year,''::text)::integer, p.grad_year) = any(array[2026,2027]))) as is_mql
  from public.codesprint_participation c
    left join public.leads l on l.public_id = c.public_id
    left join public.profiles p on p.id = c.user_id
),
agg as (
  select triple, count(*) as leads, count(*) filter (where is_mql) as mql
  from parts where coalesce(triple,'') <> '' group by triple
)
select r.id, r.platform, r.name, r.utm_link,
  coalesce(r.leads_override::bigint, a.leads, 0::bigint) as leads,
  coalesce(r.mql_override::bigint, a.mql, 0::bigint) as mql,
  case when r.platform ilike 'telegram%'
       then round(coalesce(r.cpl_override, 0) * coalesce(r.leads_override::bigint, a.leads, 0::bigint)::numeric, 2)::numeric(12,2)
       else r.cpl_spend end as cpl_spend,
  case when r.platform ilike 'telegram%'
       then round(coalesce(r.cpl_override, 0) * coalesce(r.leads_override::bigint, a.leads, 0::bigint)::numeric, 2)::numeric(12,2)
       else r.total_cost end as total_cost,
  case when r.platform ilike 'telegram%'
       then r.cpl_override
       else coalesce(r.cpl_override,
              case when coalesce(r.leads_override::bigint, a.leads, 0::bigint) > 0
                   then round(coalesce(nullif(r.total_cost,0), r.cpl_spend) / coalesce(r.leads_override::bigint, a.leads, 0::bigint)::numeric, 2)
                   else null::numeric end) end as cpl,
  r.notes, r.sort_order, r.is_trashed, r.created_by, r.created_at, r.updated_at,
  r.leads_override, r.mql_override, r.cpl_override,
  a.leads as leads_auto, a.mql as mql_auto
from public.growth_cs_cost_rows r
  left join link lk on lk.id = r.id
  left join agg a on a.triple = lk.triple;

grant select on public.growth_cs_cost_view to service_role;

create or replace view public.growth_cp_cost_view as
with link as (
  select r.id,
         utm_triple(
           utm_param(r.utm_link, 'utm_source'),
           utm_param(r.utm_link, 'utm_medium'),
           utm_param(r.utm_link, 'utm_campaign')
         ) as triple
  from public.growth_cp_cost_rows r
),
parts as (
  select
    coalesce(
      utm_triple(p.utm_source, p.utm_medium, p.utm_campaign),
      p.utm_primary,
      utm_triple(l.utm_source, l.utm_medium, l.utm_campaign),
      l.primary_attribution
    ) as triple,
    (coalesce(l.class_12_stream, p.stream) = any (array['PCM','PCMB']))
      and (coalesce(nullif(l.passing_year, '')::int, p.grad_year) = any (array[2026, 2027])) as is_mql
  from public.profiles p
    left join public.leads l on l.public_id = p.public_id
  where p.utm_medium = 'College Predictor'
),
agg as (
  select triple,
         count(*)                         as leads,
         count(*) filter (where is_mql)   as mql
  from parts
  where coalesce(triple, '') <> ''
  group by triple
)
select
  r.id, r.platform, r.name, r.utm_link,
  coalesce(r.leads_override::bigint, a.leads, 0::bigint) as leads,
  coalesce(r.mql_override::bigint,   a.mql,   0::bigint) as mql,
  case when r.platform ilike 'telegram%'
       then round(coalesce(r.cpl_override, 0) * coalesce(r.leads_override::bigint, a.leads, 0::bigint)::numeric, 2)::numeric(12,2)
       else r.cpl_spend end as cpl_spend,
  case when r.platform ilike 'telegram%'
       then round(coalesce(r.cpl_override, 0) * coalesce(r.leads_override::bigint, a.leads, 0::bigint)::numeric, 2)::numeric(12,2)
       else r.total_cost end as total_cost,
  case when r.platform ilike 'telegram%'
       then r.cpl_override
       else coalesce(
         r.cpl_override,
         case when coalesce(r.leads_override::bigint, a.leads, 0::bigint) > 0
              then round(coalesce(nullif(r.total_cost,0), r.cpl_spend) / coalesce(r.leads_override::bigint, a.leads, 0::bigint)::numeric, 2)
              else null::numeric end
       ) end as cpl,
  r.notes, r.sort_order, r.is_trashed, r.created_by, r.created_at, r.updated_at,
  r.leads_override, r.mql_override, r.cpl_override,
  a.leads as leads_auto, a.mql   as mql_auto
from public.growth_cp_cost_rows r
  left join link lk on lk.id = r.id
  left join agg  a  on a.triple = lk.triple;

grant select on public.growth_cp_cost_view to service_role;

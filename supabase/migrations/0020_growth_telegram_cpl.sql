-- ===========================================================================
-- 0020_growth_telegram_cpl
-- Telegram influencer rows invert the CPL/cost relationship in the Growth
-- Cost & CPL listings (CodeSprint + College Predictor):
--   * normal rows : you enter cost  -> CPL  = cost / leads        (derived)
--   * telegram rows: you set   CPL   -> cost = CPL  x leads        (derived)
-- "telegram" = platform ILIKE 'telegram%' (covers "Telegram" and
-- "Telegram - Manoranjan"). CPL is stored in cpl_override. leads stays
-- auto-matched by UTM, so cost auto-reflects as leads change.
-- Pure view change; no table/column/RLS change.
-- ===========================================================================

-- ---- CodeSprint -----------------------------------------------------------
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
                   then round(r.cpl_spend / coalesce(r.leads_override::bigint, a.leads, 0::bigint)::numeric, 2)
                   else null::numeric end) end as cpl,
  r.notes, r.sort_order, r.is_trashed, r.created_by, r.created_at, r.updated_at,
  r.leads_override, r.mql_override, r.cpl_override,
  a.leads as leads_auto, a.mql as mql_auto
from public.growth_cs_cost_rows r
  left join link lk on lk.id = r.id
  left join agg a on a.triple = lk.triple;

grant select on public.growth_cs_cost_view to service_role;

-- ---- College Predictor ----------------------------------------------------
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
              then round(r.total_cost / coalesce(r.leads_override::bigint, a.leads, 0::bigint)::numeric, 2)
              else null::numeric end
       ) end as cpl,
  r.notes, r.sort_order, r.is_trashed, r.created_by, r.created_at, r.updated_at,
  r.leads_override, r.mql_override, r.cpl_override,
  a.leads as leads_auto, a.mql   as mql_auto
from public.growth_cp_cost_rows r
  left join link lk on lk.id = r.id
  left join agg  a  on a.triple = lk.triple;

grant select on public.growth_cp_cost_view to service_role;

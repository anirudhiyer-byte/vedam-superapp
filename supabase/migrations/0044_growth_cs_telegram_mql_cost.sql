-- ===========================================================================
-- 0044_growth_cs_telegram_mql_cost
-- CodeSprint Growth panel: for Telegram rows, Total Cost = CPL x MQL (was CPL x
-- leads). The admin sets CPL on a telegram row; the cost column now multiplies
-- it by the MQL count matched to that UTM, not the raw lead count.
-- Only the `total_cost` telegram branch changes. `cpl_spend` (the "CPL Spend"
-- column) stays CPL x leads, and `cpl` stays the entered override. CodeSprint
-- only — College Predictor (growth_cp_cost_view) is unchanged.
-- View-only; no table/column/RLS/grant change beyond re-granting select.
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
       then round(coalesce(r.cpl_override, 0) * coalesce(r.mql_override::bigint, a.mql, 0::bigint)::numeric, 2)::numeric(12,2)
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

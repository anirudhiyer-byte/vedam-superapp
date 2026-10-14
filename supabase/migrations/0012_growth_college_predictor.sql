-- Growth · College Predictor channel — Cost & CPL
--
-- Mirrors the CodeSprint channel (growth_cs_cost_rows + growth_cs_cost_view).
-- Difference: the College Predictor channel has no UTM-carrying participation
-- table. A "College Predictor lead" is defined (per Vedam) as a PROFILE whose
-- utm_medium = 'College Predictor'. Leads/MQL are therefore counted from
-- public.profiles (joined to public.leads for the MQL fallback), attributed to
-- each cost row by the usual UTM triple match against the row's utm_link.
--
-- MQL rule (locked, same as every other channel):
--   stream in (PCM, PCMB) AND 12th passing year in (2026, 2027).

-- 1) Editable cost rows (identical shape to growth_cs_cost_rows) -----------------
create table if not exists public.growth_cp_cost_rows (
  id             uuid primary key default gen_random_uuid(),
  platform       text not null,
  name           text,
  utm_link       text,
  cpl_spend      numeric not null default 0,
  total_cost     numeric not null default 0,
  notes          text,
  sort_order     integer not null default 0,
  is_trashed     boolean not null default false,
  created_by     uuid,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  leads_override integer,
  mql_override   integer,
  cpl_override   numeric
);

-- Lock to service role only (the Growth API uses the service-role client, which
-- bypasses RLS). No anon/authenticated access — same posture as growth_cs_cost_rows.
alter table public.growth_cp_cost_rows enable row level security;
revoke all on public.growth_cp_cost_rows from anon, authenticated;
grant  all on public.growth_cp_cost_rows to service_role;

-- 2) Enriched view: auto leads + MQL + CPL --------------------------------------
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
  -- Lead pool = profiles tagged to the College Predictor channel (utm_medium).
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
  r.id,
  r.platform,
  r.name,
  r.utm_link,
  coalesce(r.leads_override::bigint, a.leads, 0::bigint) as leads,
  coalesce(r.mql_override::bigint,   a.mql,   0::bigint) as mql,
  r.cpl_spend,
  r.total_cost,
  coalesce(
    r.cpl_override,
    case
      when coalesce(r.leads_override::bigint, a.leads, 0::bigint) > 0
        then round(r.total_cost / coalesce(r.leads_override::bigint, a.leads, 0::bigint)::numeric, 2)
      else null::numeric
    end
  ) as cpl,
  r.notes,
  r.sort_order,
  r.is_trashed,
  r.created_by,
  r.created_at,
  r.updated_at,
  r.leads_override,
  r.mql_override,
  r.cpl_override,
  a.leads as leads_auto,
  a.mql   as mql_auto
from public.growth_cp_cost_rows r
  left join link lk on lk.id = r.id
  left join agg  a  on a.triple = lk.triple;

grant select on public.growth_cp_cost_view to service_role;

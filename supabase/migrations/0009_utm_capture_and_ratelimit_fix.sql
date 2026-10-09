-- 0009_utm_capture_and_ratelimit_fix.sql
-- Fixes UTM attribution capture (profiles utm_primary/secondary/tertiary/latest were
-- never populated) + the broken rate limiter that silently blocked it, and rewires the
-- CodeSprint Cost&CPL auto-match to the full source/medium/campaign triple from utm_link.
--
-- Root cause found 2026-10-09:
--   rate_limit_hit() does `on conflict (key, window_start)` but rate_limits PK is (key) only
--   → the insert throws every call → capture_utm() throws → utm_touches=0, 4 slots=0.
--   Same broken limiter also no-op'd M1 (reclaim/check-exists) rate limiting.

-- ---------------------------------------------------------------------------
-- 1. Fix rate_limit_hit: match the existing PK (key); reset count when the window rolls over.
-- ---------------------------------------------------------------------------
create or replace function public.rate_limit_hit(p_key text, p_max integer, p_window integer)
returns boolean
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_start timestamptz := date_trunc('second', now()) - make_interval(secs => (extract(epoch from now())::int % p_window));
  v_count int;
begin
  insert into public.rate_limits(key, window_start, count)
  values (p_key, v_start, 1)
  on conflict (key) do update
    set count = case when public.rate_limits.window_start = excluded.window_start
                     then public.rate_limits.count + 1
                     else 1 end,
        window_start = excluded.window_start
  returning count into v_count;
  return v_count <= p_max;   -- TRUE = allowed, FALSE = over limit
end
$function$;

-- ---------------------------------------------------------------------------
-- 2. Shared, consistent UTM helpers (immutable, search_path pinned).
-- ---------------------------------------------------------------------------
create or replace function public.utm_triple(p_src text, p_med text, p_camp text)
returns text language sql immutable set search_path to '' as $$
  select nullif(concat_ws('/',
    nullif(btrim(coalesce(p_src,'')),''),
    nullif(btrim(coalesce(p_med,'')),''),
    nullif(btrim(coalesce(p_camp,'')),'')
  ),'')
$$;

-- pull a single utm_* param out of a saved link (plain values; '+' -> space)
create or replace function public.utm_param(p_url text, p_key text)
returns text language sql immutable set search_path to '' as $$
  select nullif(replace((regexp_match(coalesce(p_url,''), '[?&]'||p_key||'=([^&#]+)'))[1], '+', ' '), '')
$$;

-- ---------------------------------------------------------------------------
-- 3. Server-side trigger: compose profiles.utm_source/medium/campaign into the
--    primary/latest/secondary/tertiary slots on every write (no frontend dependency).
--    primary = first-touch (write-once); latest = most recent; secondary/tertiary =
--    next distinct touches. Fires only when the raw utm columns change, so it never
--    clobbers slot-only updates (e.g. from capture_utm's returning-visit path).
-- ---------------------------------------------------------------------------
create or replace function public.trg_profile_utm_compose()
returns trigger language plpgsql set search_path to '' as $function$
declare v_triple text := public.utm_triple(new.utm_source, new.utm_medium, new.utm_campaign);
begin
  if v_triple is null then return new; end if;
  new.utm_latest := v_triple;
  if new.utm_primary is null then
    new.utm_primary := v_triple;
  elsif new.utm_secondary is null and new.utm_primary is distinct from v_triple then
    new.utm_secondary := v_triple;
  elsif new.utm_tertiary is null and new.utm_primary is distinct from v_triple and new.utm_secondary is distinct from v_triple then
    new.utm_tertiary := v_triple;
  end if;
  return new;
end
$function$;

create or replace trigger trg_profile_utm_compose
  before insert or update of utm_source, utm_medium, utm_campaign
  on public.profiles for each row execute function public.trg_profile_utm_compose();

-- ---------------------------------------------------------------------------
-- 4. One-time backfill: existing profiles with raw utm but empty slots.
-- ---------------------------------------------------------------------------
update public.profiles p
set utm_primary = t.triple,
    utm_latest  = coalesce(p.utm_latest, t.triple)
from (
  select id, public.utm_triple(utm_source, utm_medium, utm_campaign) as triple
  from public.profiles
) t
where p.id = t.id and t.triple is not null and p.utm_primary is null;

-- ---------------------------------------------------------------------------
-- 5. CodeSprint Cost&CPL: auto-match leads by the FULL source/medium/campaign triple
--    parsed from the cost row's utm_link, against each participant's attribution
--    (their own CodeSprint utm first, then profiles.utm_primary, then NPF leads).
-- ---------------------------------------------------------------------------
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
      public.utm_triple(c.utm_source, c.utm_medium, c.utm_campaign),  -- the participant's own CodeSprint UTM
      p.utm_primary,                                                   -- else their first-touch primary
      public.utm_triple(l.utm_source, l.utm_medium, l.utm_campaign),   -- else NPF lead triple
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
  r.cpl_spend, r.total_cost,
  coalesce(r.cpl_override,
    case when coalesce(r.leads_override::bigint, a.leads, 0::bigint) > 0
         then round(r.total_cost / coalesce(r.leads_override::bigint, a.leads, 0::bigint)::numeric, 2)
         else null::numeric end) as cpl,
  r.notes, r.sort_order, r.is_trashed, r.created_by, r.created_at, r.updated_at,
  r.leads_override, r.mql_override, r.cpl_override,
  a.leads as leads_auto, a.mql as mql_auto
from public.growth_cs_cost_rows r
  left join link lk on lk.id = r.id
  left join agg a on a.triple = lk.triple;

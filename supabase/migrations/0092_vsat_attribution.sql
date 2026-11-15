-- 0092 · VSAT UTM attribution — primary / secondary / tertiary / latest on leads + applications.
--
-- Model (matches the NPF/Meritto attribution model the team already uses):
--   • a "touch" = the source/medium/campaign triplet present at a form submit
--   • primary  = FIRST-touch   (write-once)
--   • secondary = 2nd DISTINCT touch, tertiary = 3rd DISTINCT touch  (deduped via vsat__norm_utm)
--   • latest   = most-recent touch
--   • primary is additionally broken out into primary_utm_source / _medium / _campaign
--
-- lead_manager already had primary_utm / secondary_utm / tertiary_utm / latest_utm (most unused);
-- this migration (a) adds the primary breakout, (b) makes a trigger MAINTAIN the whole chain on
-- every write, and (c) adds the same attribution set to application_manager, inherited from the
-- lead at application creation.
--
-- Ground rule honoured: we ADD columns and never overwrite existing ones in place; the raw
-- utm_source/medium/campaign on lead_manager keep their current meaning (latest raw), and a
-- touch that carries no UTM never wipes captured attribution.
--
-- Security: trigger/helper functions are SECURITY DEFINER + search_path '' and revoked from
-- public/anon/authenticated (they run as part of writes, never called directly by a browser).
-- Rollback: supabase/rollback/0092_vsat_attribution_down.sql

-- ── helper: normalize a UTM string for DISTINCT comparison ───────────────────────────────
-- NULL/'' -> NULL; else lowercase + trim each '/'-separated segment, re-joined by '/'.
create or replace function public.vsat__norm_utm(v text)
returns text language sql immutable set search_path to '' as $fn$
  select case
    when v is null or btrim(v) = '' then null
    else (
      select string_agg(lower(btrim(seg)), '/')
      from regexp_split_to_table(v, '/') with ordinality as t(seg, ord)
    )
  end;
$fn$;
revoke all on function public.vsat__norm_utm(text) from public, anon, authenticated;

-- ── new columns: primary breakout on lead_manager ────────────────────────────────────────
alter table public.lead_manager
  add column if not exists primary_utm_source   text,
  add column if not exists primary_utm_medium   text,
  add column if not exists primary_utm_campaign text;

-- ── new columns: full attribution set on application_manager (had none) ───────────────────
alter table public.application_manager
  add column if not exists primary_utm          text,
  add column if not exists secondary_utm        text,
  add column if not exists tertiary_utm         text,
  add column if not exists latest_utm           text,
  add column if not exists primary_utm_source   text,
  add column if not exists primary_utm_medium   text,
  add column if not exists primary_utm_campaign text;

-- indexes for the admin panels' campaign filters (primary + latest are the ones bucketed on)
create index if not exists lead_manager_primary_utm_idx on public.lead_manager (public.vsat__norm_utm(primary_utm));
create index if not exists lead_manager_latest_utm_idx  on public.lead_manager (public.vsat__norm_utm(latest_utm));
create index if not exists application_manager_primary_utm_idx on public.application_manager (public.vsat__norm_utm(primary_utm));
create index if not exists application_manager_latest_utm_idx  on public.application_manager (public.vsat__norm_utm(latest_utm));

-- ── lead_manager: maintain the touch chain on every insert/update ────────────────────────
create or replace function public.vsat__lead_attribution()
returns trigger language plpgsql security definer set search_path to '' as $fn$
declare
  v_s text := nullif(btrim(coalesce(new.utm_source, '')), '');
  v_m text := nullif(btrim(coalesce(new.utm_medium, '')), '');
  v_c text := nullif(btrim(coalesce(new.utm_campaign, '')), '');
  v_triple text;
  v_norm text;
begin
  -- the incoming touch, raw "source/medium/campaign" (empty segments preserved), or null
  if v_s is not null or v_m is not null or v_c is not null then
    v_triple := coalesce(new.utm_source, '') || '/' || coalesce(new.utm_medium, '') || '/' || coalesce(new.utm_campaign, '');
  else
    v_triple := null;
  end if;

  -- A write that carries NO utm must not wipe anything we already captured.
  if v_triple is null then
    if tg_op = 'UPDATE' then
      new.utm_source := old.utm_source; new.utm_medium := old.utm_medium; new.utm_campaign := old.utm_campaign;
      new.primary_utm := old.primary_utm; new.secondary_utm := old.secondary_utm;
      new.tertiary_utm := old.tertiary_utm; new.latest_utm := old.latest_utm;
      new.primary_utm_source := old.primary_utm_source; new.primary_utm_medium := old.primary_utm_medium; new.primary_utm_campaign := old.primary_utm_campaign;
    end if;
    return new;
  end if;

  v_norm := public.vsat__norm_utm(v_triple);
  new.latest_utm := v_triple;  -- always the newest touch

  if new.primary_utm is null then
    -- first-touch: set primary + its breakout (write-once from here on)
    new.primary_utm := v_triple;
    new.primary_utm_source := v_s; new.primary_utm_medium := v_m; new.primary_utm_campaign := v_c;
  elsif v_norm is distinct from public.vsat__norm_utm(new.primary_utm)
    and v_norm is distinct from public.vsat__norm_utm(new.secondary_utm)
    and v_norm is distinct from public.vsat__norm_utm(new.tertiary_utm) then
    -- a new DISTINCT touch → fill secondary, then tertiary (4th+ distinct only lives in latest)
    if new.secondary_utm is null then new.secondary_utm := v_triple;
    elsif new.tertiary_utm is null then new.tertiary_utm := v_triple;
    end if;
  end if;

  return new;
end $fn$;
revoke all on function public.vsat__lead_attribution() from public, anon, authenticated;

drop trigger if exists trg_vsat_lead_attribution on public.lead_manager;
create trigger trg_vsat_lead_attribution
  before insert or update of utm_source, utm_medium, utm_campaign on public.lead_manager
  for each row execute function public.vsat__lead_attribution();

-- ── application_manager: inherit the lead's attribution snapshot at creation ─────────────
create or replace function public.vsat__application_inherit_attr()
returns trigger language plpgsql security definer set search_path to '' as $fn$
declare r record;
begin
  select l.primary_utm, l.secondary_utm, l.tertiary_utm, l.latest_utm,
         l.primary_utm_source, l.primary_utm_medium, l.primary_utm_campaign
    into r from public.lead_manager l where l.lead_id = new.lead_id;
  if found then
    new.primary_utm          := coalesce(new.primary_utm, r.primary_utm);
    new.secondary_utm        := coalesce(new.secondary_utm, r.secondary_utm);
    new.tertiary_utm         := coalesce(new.tertiary_utm, r.tertiary_utm);
    new.latest_utm           := coalesce(new.latest_utm, r.latest_utm);
    new.primary_utm_source   := coalesce(new.primary_utm_source, r.primary_utm_source);
    new.primary_utm_medium   := coalesce(new.primary_utm_medium, r.primary_utm_medium);
    new.primary_utm_campaign := coalesce(new.primary_utm_campaign, r.primary_utm_campaign);
  end if;
  return new;
end $fn$;
revoke all on function public.vsat__application_inherit_attr() from public, anon, authenticated;

drop trigger if exists trg_vsat_application_inherit_attr on public.application_manager;
create trigger trg_vsat_application_inherit_attr
  before insert on public.application_manager
  for each row execute function public.vsat__application_inherit_attr();

-- ── backfill (additive — new columns only) ───────────────────────────────────────────────
-- leads: fill the primary breakout from the existing primary_utm. secondary/tertiary stay
-- null for historical rows (past touches aren't reconstructable) and fill going forward.
update public.lead_manager
   set primary_utm_source   = nullif(btrim(split_part(primary_utm, '/', 1)), ''),
       primary_utm_medium   = nullif(btrim(split_part(primary_utm, '/', 2)), ''),
       primary_utm_campaign = nullif(btrim(split_part(primary_utm, '/', 3)), '')
 where primary_utm is not null and primary_utm <> ''
   and primary_utm_source is null and primary_utm_medium is null and primary_utm_campaign is null;

-- applications: inherit from their lead where not already set
update public.application_manager am
   set primary_utm          = l.primary_utm,
       secondary_utm        = l.secondary_utm,
       tertiary_utm         = l.tertiary_utm,
       latest_utm           = l.latest_utm,
       primary_utm_source   = l.primary_utm_source,
       primary_utm_medium   = l.primary_utm_medium,
       primary_utm_campaign = l.primary_utm_campaign
  from public.lead_manager l
 where l.lead_id = am.lead_id
   and am.primary_utm is null and am.latest_utm is null;

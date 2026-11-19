-- 0112 · VSAT attribution — seed a lead's PRIMARY from the profile's true first touch.
--
-- Bug: lead_manager.primary_utm (and its source/medium/campaign breakout) was set by
-- trg_vsat_lead_attribution (0092) from whatever raw UTM was present when the VSAT lead
-- was CREATED. But a VSAT lead is created later than the Vedam One profile, so that raw
-- UTM is the person's *latest* touch, not their first — so "primary" ended up showing the
-- most recent campaign. The profile already stores the correct first touch in
-- profiles.utm_primary (plus utm_secondary/tertiary/latest).
--
-- Fix: a BEFORE INSERT trigger on lead_manager seeds the whole attribution chain from the
-- profile. It is named to sort BEFORE trg_vsat_lead_attribution, so it runs first; that
-- trigger then sees primary already set and preserves it (write-once) while it keeps
-- latest/secondary/tertiary maintained from the live touch stream. Nothing ever overwrites
-- primary_utm or its split once set. application_manager inherits from the lead as before
-- (0092's trg_vsat_application_inherit_attr), so fixing the lead fixes the application.
--
-- Also backfills existing leads + applications whose primary diverged from the profile.
-- Rollback: supabase/rollback/0112_vsat_lead_primary_from_profile_down.sql
--   (drops the trigger + function; the one-time data backfill is a correction and is not
--    reversed — the previous, incorrect primary values are intentionally not restored.)

create or replace function public.vsat__lead_profile_attr()
returns trigger language plpgsql security definer set search_path to '' as $fn$
declare r record;
begin
  -- never override an already-set primary (write-once); only seed a fresh lead
  if new.primary_utm is not null then return new; end if;
  select p.utm_primary, p.utm_secondary, p.utm_tertiary, p.utm_latest
    into r from public.profiles p where p.id = new.lead_id;
  if r.utm_primary is not null and btrim(r.utm_primary) <> '' then
    new.primary_utm          := r.utm_primary;
    new.primary_utm_source   := nullif(btrim(split_part(r.utm_primary, '/', 1)), '');
    new.primary_utm_medium   := nullif(btrim(split_part(r.utm_primary, '/', 2)), '');
    new.primary_utm_campaign := nullif(btrim(split_part(r.utm_primary, '/', 3)), '');
    new.secondary_utm        := coalesce(new.secondary_utm, r.utm_secondary);
    new.tertiary_utm         := coalesce(new.tertiary_utm, r.utm_tertiary);
    new.latest_utm           := coalesce(new.latest_utm, r.utm_latest);
  end if;
  return new;
end $fn$;
revoke all on function public.vsat__lead_profile_attr() from public, anon, authenticated;

-- 'aa' in the name sorts this trigger before trg_vsat_lead_attribution, so primary is
-- seeded from the profile first and the attribution trigger then preserves it.
drop trigger if exists trg_vsat_lead_aa_profile_attr on public.lead_manager;
create trigger trg_vsat_lead_aa_profile_attr
  before insert on public.lead_manager
  for each row execute function public.vsat__lead_profile_attr();

-- ── backfill: re-point existing leads' primary + split from the profile's first touch ────
update public.lead_manager lm
   set primary_utm          = p.utm_primary,
       primary_utm_source   = nullif(btrim(split_part(p.utm_primary, '/', 1)), ''),
       primary_utm_medium   = nullif(btrim(split_part(p.utm_primary, '/', 2)), ''),
       primary_utm_campaign = nullif(btrim(split_part(p.utm_primary, '/', 3)), ''),
       secondary_utm        = coalesce(lm.secondary_utm, p.utm_secondary),
       tertiary_utm         = coalesce(lm.tertiary_utm, p.utm_tertiary)
  from public.profiles p
 where p.id = lm.lead_id
   and p.utm_primary is not null and btrim(p.utm_primary) <> ''
   and lm.primary_utm is distinct from p.utm_primary;

-- ── backfill: same for applications ──────────────────────────────────────────────────────
update public.application_manager am
   set primary_utm          = p.utm_primary,
       primary_utm_source   = nullif(btrim(split_part(p.utm_primary, '/', 1)), ''),
       primary_utm_medium   = nullif(btrim(split_part(p.utm_primary, '/', 2)), ''),
       primary_utm_campaign = nullif(btrim(split_part(p.utm_primary, '/', 3)), ''),
       secondary_utm        = coalesce(am.secondary_utm, p.utm_secondary),
       tertiary_utm         = coalesce(am.tertiary_utm, p.utm_tertiary)
  from public.profiles p
 where p.id = am.lead_id
   and p.utm_primary is not null and btrim(p.utm_primary) <> ''
   and am.primary_utm is distinct from p.utm_primary;

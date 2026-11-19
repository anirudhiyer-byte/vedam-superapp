-- Rollback for 0112 — remove the profile-seed trigger + function.
-- The one-time data backfill (re-pointing primary from the profile's true first touch) is a
-- correction and is intentionally NOT reversed: the previous, incorrect primary values are
-- not restored. Going forward without this trigger, new leads revert to 0092 behaviour
-- (primary derived from the raw touch at lead creation).

drop trigger if exists trg_vsat_lead_aa_profile_attr on public.lead_manager;
drop function if exists public.vsat__lead_profile_attr();

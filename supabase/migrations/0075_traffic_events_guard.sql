-- 0075 · traffic_events — clean up rows written by browsers (QA finding M3).
--
-- Why: the page-view and click trackers (src/components/traffic-tracker.tsx, click-tracker.tsx)
-- insert straight into traffic_events with the public key, and the insert policy allows any row.
-- So anyone could write rows dated in the past, rows for another user, made-up page paths or
-- other "kind" values, and very long text. Visitors / Attempted on the Insights and Dashboards
-- pages are counted from this table.
--
-- What this adds: one BEFORE INSERT trigger. For rows written by a browser (role anon or
-- authenticated) it:
--   * sets created_at to now()                  (no back- or future-dating)
--   * sets user_id to the signed-in user, or null (no writing rows for someone else)
--   * treats a missing kind as 'view'; drops the row if kind is not 'view' or 'click'
--   * drops the row if path is not a plain path ("/...", no spaces, ?, # or control
--     characters, max 300 characters) or the session id is not a short token (max 100
--     characters: letters, digits, - and _)
--   * cuts label / section / utm_* to sane lengths
-- "Drops" = the insert is skipped silently, exactly as the trackers expect (they ignore errors).
-- Rows written by the database itself or the service role (postgres, service_role, scripts)
-- are not touched. The trackers' code does not change and real traffic is unaffected: every
-- value they send already passes these rules.
--
-- Not covered (needs an edge rate limit, a separate decision): someone sending many genuine-
-- looking current page views with made-up session ids. That inflates Visitors no matter what
-- the database checks, because to the database it looks like real traffic.
--
-- Note: the path length is checked with length(), not a regex {0,299}: Postgres regexes allow at
-- most 255 repetitions, and the larger count made every browser insert fail (caught on staging
-- by insert tests within a minute of applying; fixed before any real traffic arrived).
--
-- Rollback: supabase/rollback/0075_traffic_events_guard_down.sql (drops the trigger and function).
-- Tests:    supabase/tests/traffic_events_guard.test.sql

create or replace function public.trg_traffic_events_guard()
returns trigger
language plpgsql
set search_path to ''
as $$
begin
  -- only rows that come straight from a browser through the API
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;

  new.created_at := now();
  new.user_id    := auth.uid();
  new.kind       := coalesce(new.kind, 'view');

  if new.kind not in ('view', 'click')
     or new.path is null or length(new.path) > 300 or new.path !~ '^/[^[:space:][:cntrl:]?#]*$'
     or new.session_id is null or new.session_id !~ '^[A-Za-z0-9_-]{1,100}$' then
    return null;  -- skip the row
  end if;

  new.label        := left(new.label, 120);
  new.section      := left(new.section, 80);
  new.utm_source   := left(new.utm_source, 200);
  new.utm_medium   := left(new.utm_medium, 200);
  new.utm_campaign := left(new.utm_campaign, 200);
  return new;
end $$;

revoke all on function public.trg_traffic_events_guard() from public, anon, authenticated;

drop trigger if exists traffic_events_guard on public.traffic_events;
create trigger traffic_events_guard
  before insert on public.traffic_events
  for each row execute function public.trg_traffic_events_guard();

-- 0010_event_visibility.sql
-- Private (unlisted) events: an event marked 'private' is hidden from the public
-- Events list but still fully reachable + joinable via its direct deeplink
-- (/events/<event_code>). Everything else about the event flow is unchanged.
--
-- Note: this is "unlisted" by design (the shared link is the gate) — the public
-- listing query filters visibility<>'private'; the per-code event page does not,
-- so the deeplink keeps working.

alter table public.events add column if not exists visibility text not null default 'public';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'events_visibility_chk') then
    alter table public.events add constraint events_visibility_chk check (visibility in ('public','private'));
  end if;
end $$;

-- defensive: ensure no nulls (the NOT NULL DEFAULT already covers existing rows)
update public.events set visibility = 'public' where visibility is null;

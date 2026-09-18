"use client";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useIsAdmin } from "@/hooks/use-is-admin";
import { EventsList } from "@/components/events/events-list";
import { AdminEventsList } from "@/components/admin/admin-events-list";
import { Analytics } from "@/components/admin/analytics";
import type { EventRow } from "@/lib/events";

/** Clean browse view by default. Admins reach Manage/Analytics via the profile
 *  dropdown → /events?admin=manage or /events?admin=analytics.
 *  useSearchParams must be inside <Suspense> for the statically-cached /events page. */
function EventsPageInner({ initialEvents }: { initialEvents: EventRow[] }) {
  const isAdmin = useIsAdmin();
  const adminView = useSearchParams().get("admin");
  if (isAdmin && adminView === "manage") return <AdminEventsList />;
  if (isAdmin && adminView === "analytics") return <Analytics />;
  return <EventsList initialEvents={initialEvents} />;
}

export function EventsPage({ initialEvents = [] }: { initialEvents?: EventRow[] } = {}) {
  return (
    <Suspense fallback={<EventsList initialEvents={initialEvents} />}>
      <EventsPageInner initialEvents={initialEvents} />
    </Suspense>
  );
}

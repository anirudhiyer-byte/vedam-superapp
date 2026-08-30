"use client";
import { useState } from "react";
import { useIsAdmin } from "@/hooks/use-is-admin";
import { AdminTabs, AdminTabsSkeleton } from "@/components/admin/admin-tabs";
import { EventsList } from "@/components/events/events-list";
import { AdminEventsList } from "@/components/admin/admin-events-list";
import { Analytics } from "@/components/admin/analytics";

type Tab = "browse" | "manage" | "analytics";
export function EventsPage() {
  const isAdmin = useIsAdmin();
  const [tab, setTab] = useState<Tab>("browse");
  if (isAdmin === null) return (<div><AdminTabsSkeleton /><EventsList /></div>);
  if (!isAdmin) return <EventsList />;
  return (
    <div>
      <AdminTabs<Tab> tabs={[{ key: "browse", label: "Browse" }, { key: "manage", label: "Manage" }, { key: "analytics", label: "Analytics" }]} active={tab} onChange={setTab} />
      {tab === "browse" ? <EventsList /> : tab === "manage" ? <AdminEventsList /> : <Analytics />}
    </div>
  );
}

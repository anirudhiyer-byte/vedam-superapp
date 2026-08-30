"use client";
import { useState } from "react";
import { useIsAdmin } from "@/hooks/use-is-admin";
import { AdminTabs, AdminTabsSkeleton } from "@/components/admin/admin-tabs";
import { CsLanding } from "@/components/codesprint/cs-landing";
import { CsAdmin } from "@/components/admin/cs-admin";

type Tab = "learn" | "manage";
export function CsPage() {
  const isAdmin = useIsAdmin();
  const [tab, setTab] = useState<Tab>("learn");
  if (isAdmin === null) return (<div><AdminTabsSkeleton /><CsLanding /></div>);
  if (!isAdmin) return <CsLanding />;
  return (
    <div>
      <AdminTabs<Tab> tabs={[{ key: "learn", label: "Learn (student view)" }, { key: "manage", label: "Manage + Analytics" }]} active={tab} onChange={setTab} />
      {tab === "learn" ? <CsLanding /> : <CsAdmin />}
    </div>
  );
}

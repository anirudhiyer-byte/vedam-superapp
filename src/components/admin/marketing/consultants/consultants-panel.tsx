"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { CSS } from "./css";
import { ConsultantsListing } from "./listing";
import { ConsultantsPerformance } from "./perf";
import { PERF_CSS } from "./perf-css";

export type ConsultantsPage = "listing" | "perf";

/**
 * Growth → Marketing Channels → Consultants Channel: Consultant Listing (migration 0130) and Consultant Performance (0131).
 * Every read and write goes through the admin-checked growth_cons_* RPCs; the browser has no table access.
 */
export function ConsultantsPanel({ page = "listing" }: { page?: ConsultantsPage }) {
  const [sb] = useState(() => createClient());
  return (
    <div className="vcn">
      <style>{CSS}</style>
      {page === "perf" ? <><style>{PERF_CSS}</style><ConsultantsPerformance sb={sb} /></> : <ConsultantsListing sb={sb} />}
    </div>
  );
}

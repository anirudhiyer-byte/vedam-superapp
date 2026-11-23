"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { CSS } from "../consultants/css";
import { PERF_CSS } from "../consultants/perf-css";
import { SchoolConnectListing } from "./listing";
import { SchoolConnectPerformance } from "./perf";
import { SP_CSS } from "./perf-css";

/** School Connect green in place of the Consultants orange; the Listing styles are shared, plus a 6-card KPI grid. */
const SC_CSS = CSS.replace(/#f97d03/gi, "#0CA678") + `
.vcn .vsc-kpis{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.vcn .vsc-kpis>:first-child{grid-column:1/-1}
@media (min-width:640px){.vcn .vsc-kpis{grid-template-columns:repeat(3,minmax(0,1fr))}.vcn .vsc-kpis>:first-child{grid-column:auto}}
@media (min-width:1024px){.vcn .vsc-kpis{grid-template-columns:repeat(6,minmax(0,1fr))}}
.vcn .vsc-filters .vcn-search{min-width:220px}
.vcn .vsc-filters .vcn-sel{max-width:220px}
`;

export type SchoolConnectPage = "listing" | "perf";

/**
 * Growth → Marketing Channels → School Connect Channel: Listing and Performance (migration 0144).
 * Every read and write goes through the admin-checked growth_sc_* RPCs; the browser has no table access.
 */
export function SchoolConnectPanel({ page = "listing" }: { page?: SchoolConnectPage }) {
  const [sb] = useState(() => createClient());
  return (
    <div className="vcn">
      <style>{SC_CSS}</style>
      {page === "perf"
        ? <><style>{PERF_CSS.replace(/#f97d03/gi, "#0CA678") + SP_CSS}</style><SchoolConnectPerformance sb={sb} /></>
        : <SchoolConnectListing sb={sb} />}
    </div>
  );
}

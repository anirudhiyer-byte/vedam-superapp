"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { CSS } from "../consultants/css";
import { PERF_CSS } from "../consultants/perf-css";
import { VedantuListing } from "./listing";
import { VedantuPerformance } from "./perf";
import { VP_CSS } from "./perf-css";

/** Vedantu pink (the CRM's Vedantu accent) in place of the Consultants orange; the rest of the Listing styles are shared. */
const VD_CSS = CSS.replace(/#f97d03/gi, "#E80074") + `
.vcn .vvd-kpis{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.vcn .vvd-kpis>:first-child{grid-column:1/-1}
@media (min-width:640px){.vcn .vvd-kpis{grid-template-columns:repeat(3,minmax(0,1fr))}.vcn .vvd-kpis>:first-child{grid-column:auto}}
@media (min-width:1024px){.vcn .vvd-kpis{grid-template-columns:repeat(5,minmax(0,1fr))}}
.vcn .vvd-filters .vcn-search{min-width:220px}
.vcn .vvd-filters .vcn-sel{max-width:220px}
.vcn .vvd-vc{display:inline-flex;flex-direction:column;line-height:1.25;white-space:nowrap}
.vcn .vvd-vc b{font-weight:600}
.vcn .vvd-vc small{font-size:11px;opacity:.75}
.vcn .vvd-vc.up b{color:var(--gr,#22c55e)}
.vcn .vvd-vc.dn b{color:var(--pink,#E80074)}
.vcn .vvd-fill{font-size:11px;opacity:.75}
`;

export type VedantuPage = "listing" | "perf";

/**
 * Growth → Marketing Channels → Vedantu Channel: Vedantu Listing (migration 0136) and Vedantu Performance (0137).
 * Every read and write goes through the admin-checked growth_vd_* RPCs; the browser has no table access.
 */
export function VedantuPanel({ page = "listing" }: { page?: VedantuPage }) {
  const [sb] = useState(() => createClient());
  return (
    <div className="vcn">
      <style>{VD_CSS}</style>
      {page === "perf"
        ? <><style>{PERF_CSS.replace(/#f97d03/gi, "#E80074") + VP_CSS}</style><VedantuPerformance sb={sb} /></>
        : <VedantuListing sb={sb} />}
    </div>
  );
}

"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { CSS } from "../consultants/css";
import { PERF_CSS } from "../consultants/perf-css";
import { TelegramListing } from "./listing";
import { TelegramPerformance } from "./perf";
import { TP_CSS } from "./perf-css";

/** Telegram blue (the CRM's Telegram accent) in place of the Consultants orange; the rest of the Listing styles are shared. */
const TG_CSS = CSS.replace(/#f97d03/gi, "#229ed9") + `
.vcn .vtg-kpis{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
@media (min-width:640px){.vcn .vtg-kpis{grid-template-columns:repeat(4,minmax(0,1fr))}}
@media (min-width:1024px){.vcn .vtg-kpis{grid-template-columns:repeat(8,minmax(0,1fr))}}
.vcn .vtg-filters .vcn-search{min-width:220px}
`;

export type TelegramPage = "listing" | "perf";

/**
 * Growth → Marketing Channels → Telegram Channel: Telegram Listing (migrations 0132, 0133) and Telegram Performance (0134).
 * Every read and write goes through the admin-checked growth_tg_* RPCs; the browser has no table access.
 */
export function TelegramPanel({ page = "listing" }: { page?: TelegramPage }) {
  const [sb] = useState(() => createClient());
  return (
    <div className="vcn">
      <style>{TG_CSS}</style>
      {page === "perf" ? <><style>{PERF_CSS + TP_CSS}</style><TelegramPerformance sb={sb} /></> : <TelegramListing sb={sb} />}
    </div>
  );
}

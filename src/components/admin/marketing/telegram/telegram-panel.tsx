"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { CSS } from "../consultants/css";
import { TelegramListing } from "./listing";

/** Telegram blue (the CRM's Telegram accent) in place of the Consultants orange; the rest of the Listing styles are shared. */
const TG_CSS = CSS.replace(/#f97d03/gi, "#229ed9") + `
.vcn .vtg-kpis{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
@media (min-width:640px){.vcn .vtg-kpis{grid-template-columns:repeat(4,minmax(0,1fr))}}
@media (min-width:1024px){.vcn .vtg-kpis{grid-template-columns:repeat(8,minmax(0,1fr))}}
`;

/**
 * Growth → Marketing Channels → Telegram Channel: Telegram Listing (migration 0132).
 * Every read and write goes through the admin-checked growth_tg_* RPCs; the browser has no table access.
 */
export function TelegramPanel() {
  const [sb] = useState(() => createClient());
  return (
    <div className="vcn">
      <style>{TG_CSS}</style>
      <TelegramListing sb={sb} />
    </div>
  );
}

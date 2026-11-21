"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { CSS } from "./css";
import { ConsultantsListing } from "./listing";

/**
 * Growth → Marketing Channels → Consultants Channel. Only the Consultant Listing page for now.
 * Every read and write goes through the admin-checked growth_cons_* RPCs of migration 0130; the browser has no table access.
 */
export function ConsultantsPanel() {
  const [sb] = useState(() => createClient());
  return (
    <div className="vcn">
      <style>{CSS}</style>
      <ConsultantsListing sb={sb} />
    </div>
  );
}

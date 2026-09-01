"use client";

import { useEffect } from "react";
import { captureUtm, readUtm } from "@/lib/utm";
import { createClient } from "@/lib/supabase/client";

/** Records first-touch UTM locally, and on each authed load captures the touch
 *  into profiles (primary/secondary/tertiary/latest) via capture_utm — deduped
 *  per session, and never blank (organic/referral/direct derived). */
export function UtmCapture() {
  useEffect(() => {
    captureUtm();
    (async () => {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const params = new URLSearchParams(window.location.search);
      const stored = readUtm();
      const src = params.get("utm_source") || stored.utm_source || null;
      const med = params.get("utm_medium") || stored.utm_medium || null;
      const camp = params.get("utm_campaign") || stored.utm_campaign || null;

      let label: string | null;
      if (src) {
        label = [src, med, camp].filter(Boolean).join("/");
      } else {
        const ref = document.referrer;
        if (!ref) label = "direct";
        else {
          try {
            const host = new URL(ref).host;
            if (host.includes(window.location.host)) label = null; // internal nav
            else if (/google\.|bing\.|yahoo\.|duckduckgo\.|ecosia\./i.test(host)) label = "organic-search";
            else label = "referral";
          } catch { label = "direct"; }
        }
      }
      if (!label) return;
      if (sessionStorage.getItem("vedam_utm_last") === label) return;
      sessionStorage.setItem("vedam_utm_last", label);
      try { await supabase.rpc("capture_utm", { p_label: label, p_source: src, p_medium: med, p_campaign: camp }); } catch { /* best effort */ }
    })();
  }, []);
  return null;
}

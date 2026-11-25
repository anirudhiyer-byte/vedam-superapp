"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

const KEY = "vsat_dash_reauth";

/**
 * Fallback for /apply/dashboard when the SERVER render missed the session.
 *
 * On a hard reload several requests (the page, prefetches, /api/vsat/me) race to rotate the one
 * Supabase refresh token — an @supabase/ssr quirk — and the page's request can lose and see no
 * user, which bounced the dashboard to /apply. Here the browser client (which holds the real
 * session) refreshes it, persisting fresh cookies, and reloads the dashboard once so the server
 * now resolves it. A sessionStorage guard stops it from ever looping; VsatDashboard clears the
 * guard when it actually renders.
 */
export function DashboardReauth() {
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const sb = createClient();
    (async () => {
      let hasSession = false;
      try { const { data } = await sb.auth.getSession(); hasSession = !!data.session; } catch { /* ignore */ }
      if (!hasSession) { try { const { data } = await sb.auth.refreshSession(); hasSession = !!data.session; } catch { /* ignore */ } }
      if (!hasSession) {
        try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
        window.location.replace("/apply");
        return;
      }
      let tried = "0";
      try { tried = sessionStorage.getItem(KEY) ?? "0"; } catch { /* ignore */ }
      if (tried !== "1") {
        try { sessionStorage.setItem(KEY, "1"); } catch { /* ignore */ }
        window.location.replace("/apply/dashboard");
        return;
      }
      // already retried once and still here — don't loop; let them click through.
      setStuck(true);
    })();
  }, []);

  return (
    <div className="grid min-h-[60vh] place-items-center p-8 text-center font-sans">
      <div>
        <p className="text-sm text-[#6b647e]">{stuck ? "Almost there." : "Loading your dashboard…"}</p>
        {stuck && (
          <a href="/apply/dashboard" className="mt-3 inline-block rounded-xl bg-gradient-to-r from-[#00cfe5] to-[#c200db] px-6 py-2.5 text-sm font-semibold text-white">Continue to dashboard →</a>
        )}
      </div>
    </div>
  );
}

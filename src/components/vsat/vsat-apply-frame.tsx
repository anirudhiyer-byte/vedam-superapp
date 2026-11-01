"use client";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { readUtm } from "@/lib/utm";

export type VsatPrefill = {
  full_name?: string | null; email?: string | null; phone?: string | null;
  grad_year?: number | null; stream?: string | null; state?: string | null; city?: string | null;
};

type SubmitData = {
  fullName?: string; email?: string; phone?: string; passYear?: string;
  stream?: string; state?: string; city?: string; campus?: string; hear?: string;
};

/**
 * Renders the designed /public/vedam-one/apply.html page UNCHANGED in an iframe.
 * - Prefill: the profile is passed in the iframe URL hash; a script in apply.html
 *   fills the form on load.
 * - Submit: when the user hits "Start application" on the final step, apply.html
 *   posts the form data here; we create the VSAT lead + application for the
 *   signed-in user and send them to the designed /vsat/dashboard (instead of the
 *   mockup's static "submitted" screen). The design itself is never touched.
 */
export function VsatApplyFrame({ profile }: { profile: VsatPrefill }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [submitting, setSubmitting] = useState(false);
  const src = `/vedam-one/apply.html#vsatpf=${encodeURIComponent(JSON.stringify(profile ?? {}))}`;

  useEffect(() => {
    const supabase = createClient();
    let busy = false;

    async function onSubmit(d: SubmitData) {
      if (busy) return; busy = true; setSubmitting(true);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        const uid = session?.user?.id;
        if (!token || !uid) { window.location.href = "/vsat/dashboard"; return; }

        const gradYear = d.passYear && /^\d{4}/.test(d.passYear) ? parseInt(d.passYear, 10) : null;

        // best-effort: persist the step-2 fields so future visits prefill (own row — RLS ok)
        try {
          await supabase.from("profiles").update({
            grad_year: gradYear, stream: d.stream || null, state: d.state || null, city: d.city || null,
          }).eq("id", uid);
        } catch { /* non-blocking */ }

        const utm = readUtm();
        const triple = (utm.utm_source || utm.utm_medium || utm.utm_campaign)
          ? `${utm.utm_source ?? ""}/${utm.utm_medium ?? ""}/${utm.utm_campaign ?? ""}` : null;

        // 1) lead
        await fetch("/api/vsat/lead", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
          accessToken: token,
          lead: { name: d.fullName, email: d.email, phone: d.phone, hearAbout: d.hear, campusPref: d.campus,
            utm_source: utm.utm_source, utm_medium: utm.utm_medium, utm_campaign: utm.utm_campaign,
            full_utm: triple, lead_source: utm.utm_source },
        }) }).catch(() => {});

        // 2) application
        await fetch("/api/vsat/application", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
          accessToken: token,
          app: { name: d.fullName, email: d.email, phone: d.phone, campusPref: d.campus,
            stream: d.stream, gradYear, state: d.state, city: d.city },
        }) }).catch(() => {});

        // 3) the designed dashboard
        window.location.href = "/vsat/dashboard";
      } catch {
        window.location.href = "/vsat/dashboard";
      }
    }

    function onMsg(ev: MessageEvent) {
      if (ev.origin !== window.location.origin) return;
      const data = ev.data as { type?: string; data?: SubmitData };
      if (data?.type === "vsat-submit" && data.data) void onSubmit(data.data);
    }
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);

  return (
    <>
      <iframe ref={ref} title="Vedam One — Application" src={src}
        className="fixed inset-0 block h-screen w-screen border-0 bg-white" />
      {submitting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 text-white">
          <div className="rounded-xl bg-[#160a30] px-6 py-4 text-sm">Starting your application…</div>
        </div>
      )}
    </>
  );
}

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
 * - Submit: on the final "Start application", apply.html posts the form data here;
 *   we create the VSAT lead + application for the signed-in user and route to the
 *   designed /vsat/dashboard (instead of the mockup's static "submitted" screen).
 *
 * The iframe src carries ?v=<deploy> so the CDN-cached static file is refreshed
 * on every deploy (otherwise a stale apply.html with no wiring gets served).
 */
export function VsatApplyFrame({ profile, version, hasApplication = false }: { profile: VsatPrefill; version: string; hasApplication?: boolean }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [status, setStatus] = useState<"idle" | "submitting" | "error">("idle");
  const [errMsg, setErrMsg] = useState("");
  const src = `/vedam-one/apply.html?v=${encodeURIComponent(version)}#vsatpf=${encodeURIComponent(JSON.stringify(profile ?? {}))}`;

  useEffect(() => {
    const supabase = createClient();
    let busy = false;

    async function onSubmit(d: SubmitData) {
      if (busy) return; busy = true; setStatus("submitting"); setErrMsg("");
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        const uid = session?.user?.id;
        if (!token || !uid) { setStatus("error"); setErrMsg("You're not signed in. Please log in and try again."); busy = false; return; }

        const gradYear = d.passYear && /^\d{4}/.test(d.passYear) ? parseInt(d.passYear, 10) : null;

        try {
          await supabase.from("profiles").update({
            grad_year: gradYear, stream: d.stream || null, state: d.state || null, city: d.city || null,
          }).eq("id", uid);
        } catch { /* non-blocking */ }

        const utm = readUtm();
        // NOTE: the lead schema fields are .optional() (undefined), NOT nullable —
        // sending null fails validation ("bad request"). Omit instead of null.
        const triple = (utm.utm_source || utm.utm_medium || utm.utm_campaign)
          ? `${utm.utm_source ?? ""}/${utm.utm_medium ?? ""}/${utm.utm_campaign ?? ""}` : undefined;

        const leadRes = await fetch("/api/vsat/lead", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
          accessToken: token,
          lead: { name: d.fullName, email: d.email, phone: d.phone, hearAbout: d.hear, campusPref: d.campus,
            utm_source: utm.utm_source, utm_medium: utm.utm_medium, utm_campaign: utm.utm_campaign,
            full_utm: triple, lead_source: utm.utm_source },
        }) });
        const leadJson = await leadRes.json().catch(() => ({ ok: false, error: "lead request failed" }));
        if (!leadJson.ok) { setStatus("error"); setErrMsg("Couldn't create your lead: " + (leadJson.error || leadRes.status)); busy = false; return; }

        const appRes = await fetch("/api/vsat/application", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
          accessToken: token,
          app: { name: d.fullName, email: d.email, phone: d.phone, campusPref: d.campus,
            stream: d.stream, gradYear, state: d.state, city: d.city },
        }) });
        const appJson = await appRes.json().catch(() => ({ ok: false, error: "application request failed" }));
        if (!appJson.ok) { setStatus("error"); setErrMsg("Couldn't start your application: " + (appJson.error || appRes.status)); busy = false; return; }

        window.location.href = "/vsat/dashboard";
      } catch (e) {
        setStatus("error"); setErrMsg(String((e as Error)?.message || e)); busy = false;
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
      {hasApplication && (
        <div className="fixed inset-x-0 top-0 z-40 flex flex-wrap items-center justify-center gap-3 bg-[#160a30] px-4 py-2.5 text-sm text-white">
          <span>You&apos;ve already started your VSAT application.</span>
          <a href="/vsat/dashboard" className="rounded-lg bg-gradient-to-r from-[#00cfe5] to-[#c200db] px-4 py-1.5 font-semibold text-white">Continue to dashboard →</a>
        </div>
      )}
      <iframe ref={ref} title="Vedam One — Application" src={src}
        className={`fixed inset-x-0 bottom-0 block w-screen border-0 bg-white ${hasApplication ? "top-11 h-[calc(100vh-2.75rem)]" : "top-0 h-screen"}`} />
      {status !== "idle" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 text-white">
          <div className="max-w-sm rounded-xl bg-[#160a30] px-6 py-5 text-sm">
            {status === "submitting"
              ? "Starting your application…"
              : <><p className="font-semibold text-[#ff9db0]">Something went wrong</p><p className="mt-2 text-white/80">{errMsg}</p><button onClick={() => setStatus("idle")} className="mt-4 rounded-lg border border-white/20 px-4 py-2">Close</button></>}
          </div>
        </div>
      )}
    </>
  );
}

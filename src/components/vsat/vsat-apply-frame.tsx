"use client";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { readUtm } from "@/lib/utm";
import { INDIA_STATES, STATE_CITIES } from "@/lib/india-cities";
import { VsatAuthOverlay, type VsatFirst, type VsatVerifiedProfile } from "@/components/vsat/vsat-auth-overlay";
import { VsatEmailOverlay } from "@/components/vsat/vsat-email-overlay";
import { VsatLoginOverlay } from "@/components/vsat/vsat-login-overlay";

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
 *   we verify the email (overlay) if needed, create the VSAT lead + application for
 *   the signed-in user, and route to the designed /vsat/dashboard.
 * - New logged-out user: the OTP + Turnstile overlay creates the account + lead,
 *   then advances the iframe to pane 2.
 * - Returning lead (part 1 done, no application): auto-advance to pane 2 on load.
 * - "Already started? Login": the login overlay signs the user in and routes.
 *
 * The iframe src carries ?v=<deploy> so the CDN-cached static file is refreshed
 * on every deploy (otherwise a stale apply.html with no wiring gets served).
 */
export function VsatApplyFrame({
  profile, version, hasApplication = false, hasLead = false, loggedIn = false,
}: { profile: VsatPrefill; version: string; hasApplication?: boolean; hasLead?: boolean; loggedIn?: boolean }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [supabase] = useState(() => createClient());
  const [status, setStatus] = useState<"idle" | "submitting" | "error">("idle");
  const [errMsg, setErrMsg] = useState("");
  const busyRef = useRef(false);

  // Overlays
  const [authOpen, setAuthOpen] = useState(false);          // new-user phone OTP
  const [authInitial, setAuthInitial] = useState<VsatFirst>({});
  const [emailOpen, setEmailOpen] = useState(false);        // email verify/change on pane 2
  const [loginOpen, setLoginOpen] = useState(false);        // "already started? login"
  const pendingRef = useRef<SubmitData | null>(null);       // pane-2 data awaiting email verify

  const src = `/vedam-one/apply.html?v=${encodeURIComponent(version)}#vsatpf=${encodeURIComponent(JSON.stringify(profile ?? {}))}${hasApplication ? "&vsatapp=1" : ""}${loggedIn ? "&vsatli=1" : ""}`;

  // Complete the application once the email is confirmed (or was already verified).
  async function finishApplication(d: SubmitData, finalEmail: string, markEmailVerified: boolean) {
    if (busyRef.current) return; busyRef.current = true; setStatus("submitting"); setErrMsg("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const uid = session?.user?.id;
      if (!token || !uid) { setStatus("error"); setErrMsg("You're not signed in. Please log in and try again."); busyRef.current = false; return; }

      const gradYear = d.passYear && /^\d{4}/.test(d.passYear) ? parseInt(d.passYear, 10) : null;

      try {
        const patch: Record<string, unknown> = {
          grad_year: gradYear, stream: d.stream || null, state: d.state || null, city: d.city || null, email: finalEmail,
        };
        if (markEmailVerified) patch.email_verified = true;
        await supabase.from("profiles").update(patch).eq("id", uid);
      } catch { /* non-blocking */ }

      const utm = readUtm();
      // lead schema fields are .optional() (undefined), NOT nullable — omit, don't send null.
      const triple = (utm.utm_source || utm.utm_medium || utm.utm_campaign)
        ? `${utm.utm_source ?? ""}/${utm.utm_medium ?? ""}/${utm.utm_campaign ?? ""}` : undefined;

      const leadRes = await fetch("/api/vsat/lead", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        accessToken: token,
        lead: { name: d.fullName, email: finalEmail, phone: d.phone, hearAbout: d.hear, campusPref: d.campus,
          utm_source: utm.utm_source, utm_medium: utm.utm_medium, utm_campaign: utm.utm_campaign,
          full_utm: triple, lead_source: utm.utm_source },
      }) });
      const leadJson = await leadRes.json().catch(() => ({ ok: false, error: "lead request failed" }));
      if (!leadJson.ok) { setStatus("error"); setErrMsg("Couldn't update your lead: " + (leadJson.error || leadRes.status)); busyRef.current = false; return; }

      const appRes = await fetch("/api/vsat/application", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        accessToken: token,
        app: { name: d.fullName, email: finalEmail, phone: d.phone, campusPref: d.campus,
          stream: d.stream, gradYear, state: d.state, city: d.city },
      }) });
      const appJson = await appRes.json().catch(() => ({ ok: false, error: "application request failed" }));
      if (!appJson.ok) { setStatus("error"); setErrMsg("Couldn't start your application: " + (appJson.error || appRes.status)); busyRef.current = false; return; }

      window.location.href = "/vsat/dashboard";
    } catch (e) {
      setStatus("error"); setErrMsg(String((e as Error)?.message || e)); busyRef.current = false;
    }
  }

  // Pane-2 "Start application": gate on email verification, then finish.
  async function onSubmit(d: SubmitData) {
    setStatus("submitting"); setErrMsg("");
    const { data: { session } } = await supabase.auth.getSession();
    const uid = session?.user?.id;
    if (!uid) { setStatus("error"); setErrMsg("You're not signed in. Please log in and try again."); return; }
    let verified = false;
    try {
      const { data: p } = await supabase.from("profiles").select("email_verified").eq("id", uid).maybeSingle();
      verified = !!(p as { email_verified?: boolean } | null)?.email_verified;
    } catch { /* treat as unverified */ }
    if (verified) { await finishApplication(d, (d.email || "").trim(), false); return; }
    // Unverified: collect the pane-2 data, open the email verify/change overlay.
    pendingRef.current = d;
    setStatus("idle");
    setEmailOpen(true);
  }

  // Pane-1 "Save and next" for a signed-in user -> become a VSAT lead right away.
  // Best-effort + silent: must not block the mockup advancing to pane 2.
  async function onFirst(d: SubmitData) {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) return;
      const utm = readUtm();
      const triple = (utm.utm_source || utm.utm_medium || utm.utm_campaign)
        ? `${utm.utm_source ?? ""}/${utm.utm_medium ?? ""}/${utm.utm_campaign ?? ""}` : undefined;
      await fetch("/api/vsat/lead", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        accessToken: token,
        lead: { name: d.fullName, email: d.email, phone: d.phone,
          utm_source: utm.utm_source, utm_medium: utm.utm_medium, utm_campaign: utm.utm_campaign,
          full_utm: triple, lead_source: utm.utm_source },
      }) });
    } catch { /* non-blocking: lead is also (re)created on Start application */ }
  }

  // After a successful login overlay: route by what the user already has.
  async function onLoggedIn() {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/vsat/me", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accessToken: session?.access_token }) });
      const j = await res.json().catch(() => ({ ok: false }));
      if (j.ok && j.app) { window.location.href = "/vsat/dashboard"; return; }
      // Lead (or brand-new) -> reload so SSR re-renders signed-in and auto-resumes to pane 2.
      window.location.reload();
    } catch {
      window.location.reload();
    }
  }

  // Keep the message handler pointing at the latest closures without re-binding.
  const handlers = useRef({ onSubmit, onFirst });
  handlers.current = { onSubmit, onFirst };

  useEffect(() => {
    function onMsg(ev: MessageEvent) {
      if (ev.origin !== window.location.origin) return;
      const data = ev.data as { type?: string; data?: SubmitData };
      if (data?.type === "vsat-submit" && data.data) void handlers.current.onSubmit(data.data);
      if (data?.type === "vsat-first" && data.data) void handlers.current.onFirst(data.data);
      if (data?.type === "vsat-first-new" && data.data) {
        setAuthInitial({ fullName: data.data.fullName, email: data.data.email, phone: data.data.phone });
        setAuthOpen(true);
      }
      if (data?.type === "vsat-login") setLoginOpen(true);
    }
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);

  function onIframeLoad() {
    const win = ref.current?.contentWindow;
    if (!win) return;
    // Feed the State/City dataset so apply.html can render them as cascading
    // dropdowns (same lists as the profile registration form).
    try { win.postMessage({ type: "vsat-geo", states: INDIA_STATES, cities: STATE_CITIES }, window.location.origin); } catch { /* ignore */ }
    // Returning lead (part 1 done, no application yet): jump straight to pane 2.
    if (loggedIn && hasLead && !hasApplication) {
      try { win.postMessage({ type: "vsat-advance", profile }, window.location.origin); } catch { /* ignore */ }
    }
  }

  return (
    <>
      {/* The "already started → continue to dashboard" greeting and the "Already
          started? Login" link are injected INSIDE the form area by apply.html. */}
      <iframe ref={ref} title="Vedam One — Application" src={src} onLoad={onIframeLoad}
        className="fixed inset-0 block h-screen w-screen border-0 bg-white" />

      {authOpen && (
        <VsatAuthOverlay
          initial={authInitial}
          onClose={() => setAuthOpen(false)}
          onVerified={(p: VsatVerifiedProfile) => {
            try { ref.current?.contentWindow?.postMessage({ type: "vsat-advance", profile: p }, window.location.origin); } catch { /* ignore */ }
            setAuthOpen(false);
          }}
        />
      )}

      {emailOpen && (
        <VsatEmailOverlay
          initialEmail={(pendingRef.current?.email || profile?.email || "").trim()}
          onClose={() => setEmailOpen(false)}
          onVerified={(finalEmail: string) => {
            setEmailOpen(false);
            const d = pendingRef.current;
            if (d) void finishApplication(d, finalEmail, true);
          }}
        />
      )}

      {loginOpen && (
        <VsatLoginOverlay onClose={() => setLoginOpen(false)} onLoggedIn={() => { setLoginOpen(false); void onLoggedIn(); }} />
      )}

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

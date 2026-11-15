"use client";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { saveProfile } from "@/lib/supabase/profile-write";
import { readUtm } from "@/lib/utm";
import { Turnstile } from "@/components/turnstile";

export type VsatFirst = { fullName?: string; email?: string; phone?: string };
export type VsatVerifiedProfile = {
  full_name?: string | null; email?: string | null; phone?: string | null;
};

const e164 = (raw: string) => "+91" + (raw || "").replace(/\D/g, "").slice(-10);
const captchaRequired = !!process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

/**
 * OTP + Turnstile overlay for a LOGGED-OUT first-time user on /vsat.
 *
 * It renders OVER the designed apply.html iframe (never touching its DOM). The
 * iframe holds at pane 1 (see wireSubmit / vsat-first-new in apply.html) and posts
 * the typed name/email/phone up; this overlay verifies the phone by SMS OTP (with a
 * Cloudflare Turnstile challenge, same as the Register button), which:
 *   - creates the Vedam One profile  (auth trigger reads signInWithOtp metadata)
 *   - creates the VSAT lead           (makeLead, on verify)
 * On success it calls onVerified(profile); the parent frame posts `vsat-advance`
 * so the iframe moves to pane 2, where the existing vsat-submit path (now with a
 * session) finishes the application. Email is verified on pane 2, not here.
 *
 * Light theme to match the designed form card it sits over.
 */
export function VsatAuthOverlay({
  initial, onVerified, onClose,
}: { initial: VsatFirst; onVerified: (p: VsatVerifiedProfile) => void; onClose: () => void }) {
  const [supabase] = useState(() => createClient());
  const [step, setStep] = useState<"send" | "otp">("send");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [otp, setOtp] = useState("");
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaKey, setCaptchaKey] = useState(0);

  const fullName = (initial.fullName || "").trim();
  const email = (initial.email || "").trim();
  const phone = (initial.phone || "").replace(/\D/g, "").slice(-10);

  const firstRender = useRef(true);
  useEffect(() => { firstRender.current = false; }, []);

  async function makeLead(verifiedToken?: string) {
    const utm = readUtm();
    const triple = (utm.utm_source || utm.utm_medium || utm.utm_campaign)
      ? `${utm.utm_source ?? ""}/${utm.utm_medium ?? ""}/${utm.utm_campaign ?? ""}` : null;
    // Prefer the token returned straight from verifyOtp: right after verify, a
    // re-fetched session can carry a token the server rejects (timing race), which
    // used to 401 the lead route and silently drop the lead.
    let token = verifiedToken;
    if (!token) { const { data: { session } } = await supabase.auth.getSession(); token = session?.access_token; }
    const body = JSON.stringify({
      accessToken: token,
      lead: {
        name: fullName, email, phone: e164(phone),
        utm_source: utm.utm_source, utm_medium: utm.utm_medium, utm_campaign: utm.utm_campaign,
        full_utm: triple, lead_source: utm.utm_source,
      },
    });
    // The lead must land; retry a couple of times on a transient failure.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch("/api/vsat/lead", { method: "POST", headers: { "Content-Type": "application/json" }, body });
        if (res.ok) return;
      } catch { /* network blip — retry */ }
      if (attempt < 2) await new Promise((r) => setTimeout(r, 600));
    }
    console.warn("[vsat] lead creation did not confirm after retries");
  }

  async function sendOtp() {
    setError(null);
    if (!fullName) return setError("Enter your full name in the form first.");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return setError("Enter a valid email in the form first.");
    if (phone.length < 10) return setError("Enter a valid 10-digit mobile in the form first.");
    if (captchaRequired && !captchaToken) return setError("Please complete the human check.");
    setLoading(true);
    // Reclaim an account that may already exist for this phone/email (idempotent, best effort).
    try { await fetch("/api/auth/reclaim", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone: e164(phone), email }) }); } catch { /* best effort */ }
    const u = readUtm();
    // Name + email go in metadata so the DB trigger captures them at account creation;
    // email must not depend on a client-side update after verify.
    const { error: err } = await supabase.auth.signInWithOtp({
      phone: e164(phone),
      options: {
        shouldCreateUser: true, channel: "sms",
        captchaToken: captchaToken || undefined,
        data: { full_name: fullName, email, consent_given: "true", utm_source: u.utm_source, utm_medium: u.utm_medium, utm_campaign: u.utm_campaign },
      },
    });
    setLoading(false);
    setCaptchaToken(null); setCaptchaKey((k) => k + 1); // tokens are single-use
    if (err) return setError(err.message || "Couldn't send the OTP. Please try again.");
    setStep("otp");
  }

  async function verify() {
    setError(null);
    if (otp.replace(/\D/g, "").length < 4) return setError("Enter the code we sent you.");
    setLoading(true);
    const { data, error: err } = await supabase.auth.verifyOtp({ phone: e164(phone), token: otp.replace(/\D/g, ""), type: "sms" });
    if (err || !data.user) { setLoading(false); return setError(err?.message || "That code didn't work. Try again."); }
    const utm = readUtm();
    // email + mobile_verified are guaranteed server-side by the auth triggers; this is
    // a best-effort fast-path. Confirm + log, don't block the lead.
    const { error: vErr } = await saveProfile(supabase, data.user.id, {
      full_name: fullName, email, mobile_verified: true,
      utm_source: utm.utm_source ?? null, utm_medium: utm.utm_medium ?? null, utm_campaign: utm.utm_campaign ?? null,
    });
    if (vErr) console.warn("[vsat] verify profile write did not confirm:", vErr);
    await makeLead(data.session?.access_token);   // <-- VSAT lead on OTP verify (use the just-minted token)
    setLoading(false);
    onVerified({ full_name: fullName, email, phone: e164(phone) });
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-[0_24px_70px_-20px_rgba(22,10,48,0.45)] sm:p-7">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold text-[#160a30]">
              {step === "send" ? "Verify your mobile" : "Enter the code"}
            </h2>
            <p className="mt-1 text-[13px] leading-snug text-[#4b5563]">
              {step === "send"
                ? <>We&apos;ll text a one-time code to <span className="font-semibold text-[#160a30]">+91 {phone || "……"}</span> to secure your spot.</>
                : <>Sent to <span className="font-semibold text-[#160a30]">+91 {phone}</span>. Enter it below.</>}
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" className="ml-3 shrink-0 rounded-lg px-2 py-1 text-xl leading-none text-[#9ca3af] hover:text-[#160a30]">×</button>
        </div>

        {step === "send" && (
          <div className="mt-5">
            {captchaRequired && <Turnstile onToken={setCaptchaToken} resetKey={captchaKey} />}
            {error && <p className="mt-3 text-xs text-[#d6336c]">{error}</p>}
            <button
              onClick={sendOtp} disabled={loading || (captchaRequired && !captchaToken)}
              className="mt-4 w-full rounded-xl bg-gradient-to-r from-[#00cfe5] to-[#c200db] py-3 text-sm font-semibold text-white disabled:opacity-50"
            >{loading ? "Sending…" : "Send code"}</button>
          </div>
        )}

        {step === "otp" && (
          <div className="mt-5">
            <input
              value={otp} onChange={(e) => setOtp(e.target.value)} onKeyDown={(e) => e.key === "Enter" && verify()}
              placeholder="● ● ● ●" inputMode="numeric" autoFocus
              className="w-full rounded-xl border border-[#e5e7eb] bg-[#f9fafb] px-4 py-3 text-center text-lg tracking-[0.5em] text-[#160a30] outline-none focus:border-[#c200db]"
            />
            {error && <p className="mt-3 text-xs text-[#d6336c]">{error}</p>}
            <button
              onClick={verify} disabled={loading}
              className="mt-4 w-full rounded-xl bg-gradient-to-r from-[#00cfe5] to-[#c200db] py-3 text-sm font-semibold text-white disabled:opacity-50"
            >{loading ? "Verifying…" : "Verify & continue"}</button>
            <button onClick={() => { setStep("send"); setOtp(""); setError(null); }} className="mt-3 w-full text-xs text-[#6b7280] hover:text-[#160a30]">← Use a different number / resend</button>
          </div>
        )}
      </div>
    </div>
  );
}

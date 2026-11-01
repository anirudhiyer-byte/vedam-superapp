"use client";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Turnstile } from "@/components/turnstile";

const e164 = (raw: string) => "+91" + (raw || "").replace(/\D/g, "").slice(-10);
const captchaRequired = !!process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

/**
 * "Already started? Login to your VSAT dashboard" overlay.
 *
 * Phone-OTP login for an EXISTING applicant (shouldCreateUser:false, so a new
 * number is rejected rather than silently creating an account). On verify it
 * calls onLoggedIn(); the parent decides where to go (dashboard if an application
 * exists, resume to pane 2 if only a lead, else let them register).
 */
export function VsatLoginOverlay({ onLoggedIn, onClose }: { onLoggedIn: () => void; onClose: () => void }) {
  const [supabase] = useState(() => createClient());
  const [step, setStep] = useState<"phone" | "otp">("phone");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaKey, setCaptchaKey] = useState(0);

  async function sendOtp() {
    setError(null);
    if (phone.replace(/\D/g, "").length < 10) return setError("Enter your registered 10-digit mobile.");
    if (captchaRequired && !captchaToken) return setError("Please complete the human check.");
    setLoading(true);
    const { error: err } = await supabase.auth.signInWithOtp({
      phone: e164(phone),
      options: { shouldCreateUser: false, channel: "sms", captchaToken: captchaToken || undefined },
    });
    setLoading(false);
    setCaptchaToken(null); setCaptchaKey((k) => k + 1);
    if (err) {
      const m = (err.message || "").toLowerCase();
      if (m.includes("signup") || m.includes("not allowed") || m.includes("not found"))
        return setError("No account found for this number. Register below instead.");
      return setError(err.message || "Couldn't send the OTP. Try again.");
    }
    setStep("otp");
  }

  async function verify() {
    setError(null);
    if (otp.replace(/\D/g, "").length < 4) return setError("Enter the code we sent you.");
    setLoading(true);
    const { data, error: err } = await supabase.auth.verifyOtp({ phone: e164(phone), token: otp.replace(/\D/g, ""), type: "sms" });
    if (err || !data.user) { setLoading(false); return setError(err?.message || "That code didn't work. Try again."); }
    setLoading(false);
    onLoggedIn();
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-[0_24px_70px_-20px_rgba(22,10,48,0.45)] sm:p-7">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold text-[#160a30]">{step === "phone" ? "Log in to your dashboard" : "Enter the code"}</h2>
            <p className="mt-1 text-[13px] leading-snug text-[#4b5563]">
              {step === "phone"
                ? "Already started your VSAT application? Log in with your registered mobile."
                : <>Sent to <span className="font-semibold text-[#160a30]">+91 {phone.replace(/\D/g, "").slice(-10)}</span>.</>}
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" className="ml-3 shrink-0 rounded-lg px-2 py-1 text-xl leading-none text-[#9ca3af] hover:text-[#160a30]">×</button>
        </div>

        {step === "phone" && (
          <div className="mt-5">
            <div className="flex items-center gap-2">
              <span className="rounded-xl border border-[#e5e7eb] bg-[#f9fafb] px-3 py-3 text-sm text-[#6b7280]">+91</span>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} onKeyDown={(e) => e.key === "Enter" && sendOtp()} placeholder="98765 43210" inputMode="numeric"
                className="w-full rounded-xl border border-[#e5e7eb] bg-[#f9fafb] px-4 py-3 text-sm text-[#160a30] outline-none focus:border-[#c200db]" />
            </div>
            {captchaRequired && <div className="mt-3"><Turnstile onToken={setCaptchaToken} resetKey={captchaKey} /></div>}
            {error && <p className="mt-3 text-xs text-[#d6336c]">{error}</p>}
            <button onClick={sendOtp} disabled={loading || (captchaRequired && !captchaToken)}
              className="mt-4 w-full rounded-xl bg-gradient-to-r from-[#00cfe5] to-[#c200db] py-3 text-sm font-semibold text-white disabled:opacity-50">{loading ? "Sending…" : "Send OTP"}</button>
          </div>
        )}

        {step === "otp" && (
          <div className="mt-5">
            <input value={otp} onChange={(e) => setOtp(e.target.value)} onKeyDown={(e) => e.key === "Enter" && verify()} placeholder="● ● ● ●" inputMode="numeric" autoFocus
              className="w-full rounded-xl border border-[#e5e7eb] bg-[#f9fafb] px-4 py-3 text-center text-lg tracking-[0.5em] text-[#160a30] outline-none focus:border-[#c200db]" />
            {error && <p className="mt-3 text-xs text-[#d6336c]">{error}</p>}
            <button onClick={verify} disabled={loading}
              className="mt-4 w-full rounded-xl bg-gradient-to-r from-[#00cfe5] to-[#c200db] py-3 text-sm font-semibold text-white disabled:opacity-50">{loading ? "Logging in…" : "Log in"}</button>
            <button onClick={() => { setStep("phone"); setOtp(""); setError(null); }} className="mt-3 w-full text-xs text-[#6b7280] hover:text-[#160a30]">← Use a different number</button>
          </div>
        )}
      </div>
    </div>
  );
}

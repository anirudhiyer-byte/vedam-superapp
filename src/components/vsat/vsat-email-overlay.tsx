"use client";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Email verify / change overlay, shown on "Start application" (pane 2) when the
 * user's email is not yet verified. The user can correct the email here before
 * verifying; on verify the parent updates profiles + the VSAT lead to the final
 * email (same row, so the old value is replaced) and then creates the application.
 *
 * Uses Supabase email-change OTP: updateUser({ email }) sends a code, verifyOtp
 * type "email_change" confirms it. No captcha (not a signup/signin).
 */
export function VsatEmailOverlay({ initialEmail, onVerified, onClose }: { initialEmail: string; onVerified: (finalEmail: string) => void; onClose: () => void }) {
  const [supabase] = useState(() => createClient());
  const [email, setEmail] = useState((initialEmail || "").trim());
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function sendCode() {
    setError(null); setInfo(null);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) return setError("Enter a valid email address.");
    setLoading(true);
    const { error: err } = await supabase.auth.updateUser({ email: email.trim() });
    setLoading(false);
    if (err) return setError(err.message || "Couldn't send the code. Try again.");
    setSent(true);
    setInfo("Code sent to " + email.trim());
  }

  async function verify() {
    setError(null);
    if (code.replace(/\D/g, "").length < 4) return setError("Enter the code sent to your email.");
    setLoading(true);
    const { error: err } = await supabase.auth.verifyOtp({ email: email.trim(), token: code.replace(/\D/g, ""), type: "email_change" });
    setLoading(false);
    if (err) return setError(err.message || "That code didn't work. Check and try again.");
    onVerified(email.trim());
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-[0_24px_70px_-20px_rgba(22,10,48,0.45)] sm:p-7">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold text-[#160a30]">Verify your email</h2>
            <p className="mt-1 text-[13px] leading-snug text-[#4b5563]">One last step — confirm your email so we can send your VSAT slot and updates. You can correct it here if it&apos;s wrong.</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="ml-3 shrink-0 rounded-lg px-2 py-1 text-xl leading-none text-[#9ca3af] hover:text-[#160a30]">×</button>
        </div>

        <div className="mt-5 space-y-3">
          <div className="flex items-center gap-2">
            <input value={email} onChange={(e) => { setEmail(e.target.value); setSent(false); setInfo(null); }} placeholder="you@email.com" inputMode="email"
              className="w-full rounded-xl border border-[#e5e7eb] bg-[#f9fafb] px-4 py-3 text-sm text-[#160a30] outline-none focus:border-[#c200db]" />
            <button onClick={sendCode} disabled={loading}
              className="shrink-0 rounded-xl border border-[#d1d5db] px-3 py-3 text-xs font-medium text-[#374151] disabled:opacity-50">{sent ? "Resend" : "Send code"}</button>
          </div>
          {sent && (
            <input value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => e.key === "Enter" && verify()} placeholder="Email code" inputMode="numeric" autoFocus
              className="w-full rounded-xl border border-[#e5e7eb] bg-[#f9fafb] px-4 py-3 text-center text-base tracking-[0.3em] text-[#160a30] outline-none focus:border-[#c200db]" />
          )}
          {info && !error && <p className="text-xs text-[#059669]">{info}</p>}
          {error && <p className="text-xs text-[#d6336c]">{error}</p>}
          <button onClick={verify} disabled={loading || !sent}
            className="w-full rounded-xl bg-gradient-to-r from-[#00cfe5] to-[#c200db] py-3 text-sm font-semibold text-white disabled:opacity-50">{loading ? "Working…" : "Verify & finish"}</button>
        </div>
      </div>
    </div>
  );
}

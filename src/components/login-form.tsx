"use client";
import { gtmEvent } from "@/lib/analytics/gtm";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { readUtm } from "@/lib/utm";
import { Turnstile } from "@/components/turnstile";

type Mode = "phone" | "email";

export function LoginForm() {
  const [supabase] = useState(() => createClient());
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/";

  const [mode, setMode] = useState<Mode>("phone");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaReset, setCaptchaReset] = useState(0);

  const e164 = (raw: string) => "+91" + raw.replace(/\D/g, "").slice(-10);

  async function staffLogin() {
    setError(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=/admin`,
        queryParams: { hd: "vedam.org", prompt: "select_account" },
      },
    });
    if (error) setError(error.message);
  }

  async function sendCode() {
    setError(null);
    if (mode === "phone" && phone.replace(/\D/g, "").length < 10) return setError("Enter a valid WhatsApp number.");
    if (mode === "email" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return setError("Enter a valid email.");
    if (process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY && !captchaToken) return setError("Please complete the captcha.");

    setLoading(true);
    const { error } =
      mode === "phone"
        ? await supabase.auth.signInWithOtp({ phone: e164(phone), options: { shouldCreateUser: false, channel: "sms", captchaToken: captchaToken || undefined } })
        : await supabase.auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: false, captchaToken: captchaToken || undefined } });
    setLoading(false);
    if (error) { setCaptchaToken(null); setCaptchaReset((x) => x + 1); const friendly = /signups? not allowed/i.test(error.message) ? "No account found with these details yet. Please create an account first." : error.message; return setError(friendly); }
    setSent(true);
  }

  async function verify() {
    setError(null);
    if (otp.replace(/\D/g, "").length < 4) return setError("Enter the code we sent you.");
    setLoading(true);

    const { data, error } =
      mode === "phone"
        ? await supabase.auth.verifyOtp({ phone: e164(phone), token: otp.replace(/\D/g, ""), type: "sms" })
        : await supabase.auth.verifyOtp({ email: email.trim(), token: otp.replace(/\D/g, ""), type: "email" });

    if (error || !data.user) {
      setLoading(false);
      return setError(error?.message ?? "That code didn't work. Try again.");
    }

    const utm = readUtm();
    await supabase.rpc("record_login");
    await supabase.from("activity_log").insert({
      user_id: data.user.id,
      event_type: "login",
      utm_source: utm.utm_source ?? null,
      utm_medium: utm.utm_medium ?? null,
      utm_campaign: utm.utm_campaign ?? null,
    });

    gtmEvent("login", { method: mode === "phone" ? "otp_sms" : "otp_email" });
    // hard navigation so the fresh session cookie is present on the next request
    window.location.assign(next);
  }

  return (
    <div className="rounded-2xl border border-white/12 bg-white/[0.05] p-6 shadow-[0_24px_60px_-30px_rgba(0,0,0,0.6)] backdrop-blur-xl sm:p-8">
      <h1 className="font-display text-2xl font-bold text-white">Welcome back</h1>
      <p className="mt-1 font-body text-sm text-white/55">Log in to your Vedam account.</p>

      {!sent && (
        <div className="mt-5 flex rounded-lg border border-white/12 p-1">
          {(["phone", "email"] as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => { setMode(m); setError(null); }}
              className={[
                "flex-1 rounded-md py-2 text-sm font-medium capitalize transition-colors",
                mode === m ? "bg-brand-gradient text-white" : "text-white/50 hover:text-white",
              ].join(" ")}
            >
              {m === "phone" ? "WhatsApp" : "Email"}
            </button>
          ))}
        </div>
      )}

      <div className="mt-5 space-y-4">
        {!sent ? (
          <>
            {mode === "phone" ? (
              <div className="flex">
                <span className="inline-flex items-center rounded-l-lg border border-r-0 border-white/12 bg-white/[0.06] px-3 text-sm text-white/60">+91</span>
                <input className={inputCls + " rounded-l-none"} value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="numeric" placeholder="98765 43210" />
              </div>
            ) : (
              <input className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="you@example.com" />
            )}
            <Turnstile onToken={setCaptchaToken} resetKey={captchaReset} />
            {error && <p className="font-body text-sm text-red-500">{error}</p>}
            <button onClick={sendCode} disabled={loading} className={primaryBtn}>
              {loading ? "Sending code…" : "Send code"}
            </button>
          </>
        ) : (
          <>
            <input className={inputCls + " text-center text-lg tracking-[0.4em]"} value={otp} onChange={(e) => setOtp(e.target.value)} inputMode="numeric" maxLength={6} placeholder="••••••" />
            {error && <p className="font-body text-sm text-red-500">{error}</p>}
            <button onClick={verify} disabled={loading} className={primaryBtn}>
              {loading ? "Verifying…" : "Verify & log in"}
            </button>
            <button onClick={() => { setSent(false); setOtp(""); setError(null); }} className="w-full font-body text-sm text-white/55">
              ← Use a different {mode}
            </button>
          </>
        )}

        <p className="text-center font-body text-sm text-white/55">
          New to Vedam?{" "}
          <Link href="/register" className="font-semibold text-accent">Create an account</Link>
        </p>

        <div className="flex items-center gap-3 pt-1">
          <div className="h-px flex-1 bg-white/12" />
          <span className="font-mono text-[10px] uppercase tracking-wide text-white/55">Vedam staff</span>
          <div className="h-px flex-1 bg-white/12" />
        </div>
        <button
          onClick={staffLogin}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-white/15 bg-white/[0.06] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-white/[0.12]"
        >
          <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.6 4.1 29.6 2 24 2 11.8 2 2 11.8 2 24s9.8 22 22 22 22-9.8 22-22c0-1.2-.1-2.3-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16 19 13 24 13c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.6 4.1 29.6 2 24 2 15.6 2 8.3 6.8 6.3 14.7z"/><path fill="#4CAF50" d="M24 46c5.5 0 10.5-2.1 14.3-5.6l-6.6-5.6C29.6 36.5 26.9 37.5 24 37.5c-5.2 0-9.6-3.3-11.2-7.9l-6.6 5.1C8.3 41.2 15.6 46 24 46z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4 5.4l6.6 5.6C41.9 36.5 46 31 46 24c0-1.2-.1-2.3-.4-3.5z"/></svg>
          Staff sign-in with Google
        </button>
      </div>
    </div>
  );
}

const inputCls =
  "w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-white/90 outline-none transition-colors focus:border-[color:rgb(var(--accent))]";
const primaryBtn =
  "w-full rounded-xl bg-brand-gradient px-5 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60";

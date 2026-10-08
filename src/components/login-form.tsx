"use client";
import { gtmEvent } from "@/lib/analytics/gtm";

import { useEffect, useState } from "react";
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
  const next = decodeURIComponent(params.get("next") || "/");

  const [mode, setMode] = useState<Mode>("phone");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaReset, setCaptchaReset] = useState(0);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown((c) => c - 1), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  const e164 = (raw: string) => "+91" + raw.replace(/\D/g, "").slice(-10);

  // resend the code on the OTP screen (fresh captcha token from the widget below)
  async function resendCode() {
    setError(null);
    if (mode === "phone") { const { data: allowed } = await supabase.rpc("otp_allowed", { p_phone: e164(phone), p_ip: null }); if (allowed === false) return setError("Too many code requests for this number. Please wait a few minutes and try again."); }
    if (process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY && !captchaToken) return setError("Please complete the captcha to resend.");
    const { error } =
      mode === "phone"
        ? await supabase.auth.signInWithOtp({ phone: e164(phone), options: { shouldCreateUser: false, channel: "sms", captchaToken: captchaToken || undefined } })
        : await supabase.auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: email.trim().toLowerCase().endsWith("@vedam.org"), captchaToken: captchaToken || undefined } });
    setCaptchaToken(null); setCaptchaReset((x) => x + 1);
    if (error) return setError(error.message);
    setOtp(""); setCooldown(30);
  }

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
    if (mode === "phone") { const { data: allowed } = await supabase.rpc("otp_allowed", { p_phone: e164(phone), p_ip: null }); if (allowed === false) return setError("Too many code requests for this number. Please wait a few minutes and try again."); }
    if (mode === "email" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return setError("Enter a valid email.");
    if (process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY && !captchaToken) return setError("Please complete the captcha.");

    setLoading(true);
    const { error } =
      mode === "phone"
        ? await supabase.auth.signInWithOtp({ phone: e164(phone), options: { shouldCreateUser: false, channel: "sms", captchaToken: captchaToken || undefined } })
        : await supabase.auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: email.trim().toLowerCase().endsWith("@vedam.org"), captchaToken: captchaToken || undefined } });
    setLoading(false);
    if (error) { setCaptchaToken(null); setCaptchaReset((x) => x + 1);
      let friendly = error.message;
      if (/signups? not allowed/i.test(error.message)) friendly = mode === "email"
        ? "No account is verified for this email yet. If you registered with it but skipped email OTP, sign in with your phone number for now — then verify your email from your Profile to enable email sign-in."
        : "No account found with these details yet. Please create an account first.";
      return setError(friendly); }
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
                <input className={inputCls + " rounded-l-none"} value={phone} onChange={(e) => setPhone(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !loading) sendCode(); }} inputMode="numeric" placeholder="98765 43210" />
              </div>
            ) : (
              <input className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !loading) sendCode(); }} type="email" placeholder="you@example.com" />
            )}
            <Turnstile onToken={setCaptchaToken} resetKey={captchaReset} />
            {error && <p className="font-body text-sm text-red-500">{error}</p>}
            <button onClick={sendCode} disabled={loading} className={primaryBtn}>
              {loading ? "Sending code…" : "Send code"}
            </button>
          </>
        ) : (
          <>
            <input className={inputCls + " text-center text-lg tracking-[0.4em]"} value={otp} onChange={(e) => setOtp(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !loading) verify(); }} inputMode="numeric" maxLength={6} placeholder="••••••" />
            <Turnstile onToken={setCaptchaToken} resetKey={captchaReset} />
            {error && <p className="font-body text-sm text-red-500">{error}</p>}
            <button onClick={verify} disabled={loading} className={primaryBtn}>
              {loading ? "Verifying…" : "Verify & log in"}
            </button>
            <button onClick={resendCode} disabled={cooldown > 0} className="w-full rounded-xl border border-white/15 px-5 py-2.5 text-sm font-semibold text-accent disabled:opacity-50">
              {cooldown > 0 ? `Resend OTP in ${cooldown}s` : "Resend OTP"}
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
      </div>
    </div>
  );
}

const inputCls =
  "w-full rounded-lg border border-white/15 bg-white/[0.06] px-3 py-2.5 text-sm text-white/90 outline-none transition-colors [color-scheme:dark] focus:border-[#00cfe5]";
const primaryBtn =
  "w-full rounded-xl bg-brand-gradient px-5 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60";

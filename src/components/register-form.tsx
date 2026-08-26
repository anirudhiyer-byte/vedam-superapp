"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { readUtm } from "@/lib/utm";

const GRAD_YEARS = [2024, 2025, 2026, 2027, 2028];
const STREAMS = ["PCM", "PCMB", "PCB", "Others"] as const;

type Step = "details" | "otp" | "done";

export function RegisterForm() {
  const [supabase] = useState(() => createClient());
  const router = useRouter();

  const [step, setStep] = useState<Step>("details");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [gradYear, setGradYear] = useState<number | "">("");
  const [stream, setStream] = useState<(typeof STREAMS)[number] | "">("");
  const [streamOther, setStreamOther] = useState("");
  const [consent, setConsent] = useState(false);
  const [otp, setOtp] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [resendState, setResendState] = useState<"idle" | "sending" | "sent">("idle");

  async function resendVerification() {
    setResendState("sending");
    const { error } = await supabase.auth.updateUser({ email: email.trim() });
    setEmailError(error ? error.message : null);
    setResendState(error ? "idle" : "sent");
  }

  const e164 = (raw: string) => "+91" + raw.replace(/\D/g, "").slice(-10);

  async function sendOtp() {
    setError(null);
    if (!fullName.trim()) return setError("Enter your name.");
    if (phone.replace(/\D/g, "").length < 10) return setError("Enter a valid 10-digit phone number.");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return setError("Enter a valid email.");
    if (!gradYear) return setError("Select your class 12 graduation year.");
    if (!stream) return setError("Select your stream.");
    if (stream === "Others" && !streamOther.trim()) return setError("Tell us your stream.");
    if (!consent) return setError("Please accept the consent to continue.");

    setLoading(true);
    const utm = readUtm();
    const { error } = await supabase.auth.signInWithOtp({
      phone: e164(phone),
      options: {
        shouldCreateUser: true,
        channel: "sms",
        data: {
          full_name: fullName.trim(),
          email: email.trim(),
          grad_year: String(gradYear),
          stream,
          stream_other: stream === "Others" ? streamOther.trim() : null,
          consent_given: "true",
          ...utm,
        },
      },
    });
    setLoading(false);
    if (error) return setError(error.message);
    setStep("otp");
  }

  async function verify() {
    setError(null);
    if (otp.replace(/\D/g, "").length < 4) return setError("Enter the code we sent you.");
    setLoading(true);

    const { data, error } = await supabase.auth.verifyOtp({
      phone: e164(phone),
      token: otp.replace(/\D/g, ""),
      type: "sms",
    });
    if (error || !data.user) {
      setLoading(false);
      return setError(error?.message ?? "That code didn't work. Try again.");
    }

    const utm = readUtm();
    // Ensure the profile carries everything (incl. email, which phone signup
    // leaves blank on auth.users) — the signup trigger set the rest.
    await supabase
      .from("profiles")
      .update({
        full_name: fullName.trim(),
        email: email.trim(),
        grad_year: Number(gradYear),
        stream,
        stream_other: stream === "Others" ? streamOther.trim() : null,
        consent_given: true,
        consent_at: new Date().toISOString(),
        last_login_at: new Date().toISOString(),
        utm_source: utm.utm_source ?? null,
        utm_medium: utm.utm_medium ?? null,
        utm_campaign: utm.utm_campaign ?? null,
        referrer: utm.referrer ?? null,
        landing_path: utm.landing_path ?? null,
      })
      .eq("id", data.user.id);

    await supabase.from("activity_log").insert({
      user_id: data.user.id,
      event_type: "signup",
      utm_source: utm.utm_source ?? null,
      utm_medium: utm.utm_medium ?? null,
      utm_campaign: utm.utm_campaign ?? null,
    });

    // Attach + verify the email on this same account (sends via SMTP2GO).
    const { error: emailErr } = await supabase.auth.updateUser({ email: email.trim() });
    setEmailError(emailErr ? emailErr.message : null);

    setLoading(false);
    setStep("done");
  }

  return (
    <div className="rounded-2xl border border-border bg-surface p-6 sm:p-8">
      {step === "details" && (
        <>
          <h1 className="font-display text-2xl font-bold text-heading">Create your account</h1>
          <p className="mt-1 font-body text-sm text-muted">One login for the entire Vedam ecosystem.</p>

          <div className="mt-6 space-y-4">
            <Field label="Full name">
              <input className={inputCls} value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Aarav Sharma" />
            </Field>

            <Field label="Phone number">
              <div className="flex">
                <span className="inline-flex items-center rounded-l-lg border border-r-0 border-border bg-surface-warm px-3 text-sm text-muted">+91</span>
                <input className={inputCls + " rounded-l-none"} value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="numeric" placeholder="98765 43210" />
              </div>
            </Field>

            <Field label="Email">
              <input className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="you@example.com" />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Class 12 grad year">
                <select className={inputCls} value={gradYear} onChange={(e) => setGradYear(e.target.value ? Number(e.target.value) : "")}>
                  <option value="">Select</option>
                  {GRAD_YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
                </select>
              </Field>
              <Field label="Stream">
                <select className={inputCls} value={stream} onChange={(e) => setStream(e.target.value as typeof stream)}>
                  <option value="">Select</option>
                  {STREAMS.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </Field>
            </div>

            {stream === "Others" && (
              <Field label="Your stream">
                <input className={inputCls} value={streamOther} onChange={(e) => setStreamOther(e.target.value)} placeholder="e.g. Commerce" />
              </Field>
            )}

            <label className="flex items-start gap-2.5 pt-1">
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1 h-4 w-4 accent-[color:rgb(var(--accent))]" />
              <span className="font-body text-xs leading-relaxed text-muted">
                I agree to Vedam contacting me and processing my details as per the privacy policy.
              </span>
            </label>

            {error && <p className="font-body text-sm text-red-500">{error}</p>}

            <button onClick={sendOtp} disabled={loading} className={primaryBtn}>
              {loading ? "Sending code…" : "Send OTP"}
            </button>

            <p className="text-center font-body text-sm text-muted">
              Already have an account?{" "}
              <Link href="/login" className="font-semibold text-accent">Log in</Link>
            </p>
          </div>
        </>
      )}

      {step === "otp" && (
        <>
          <h1 className="font-display text-2xl font-bold text-heading">Enter the code</h1>
          <p className="mt-1 font-body text-sm text-muted">
            We sent a 6-digit code to +91 {phone.replace(/\D/g, "").slice(-10)}.
          </p>
          <div className="mt-6 space-y-4">
            <input className={inputCls + " text-center text-lg tracking-[0.4em]"} value={otp} onChange={(e) => setOtp(e.target.value)} inputMode="numeric" maxLength={6} placeholder="••••••" />
            {error && <p className="font-body text-sm text-red-500">{error}</p>}
            <button onClick={verify} disabled={loading} className={primaryBtn}>
              {loading ? "Verifying…" : "Verify & create account"}
            </button>
            <button onClick={() => { setStep("details"); setOtp(""); setError(null); }} className="w-full font-body text-sm text-muted">
              ← Edit my details
            </button>
          </div>
        </>
      )}

      {step === "done" && (
        <>
          <h1 className="font-display text-2xl font-bold text-heading">You&apos;re in 🎉</h1>

          {emailError ? (
            <p className="mt-2 font-body text-sm leading-relaxed text-muted">
              Your account is ready. We couldn&apos;t send the verification email to{" "}
              <b className="text-foreground">{email}</b> just now — you can still explore, and resend it below.
            </p>
          ) : (
            <p className="mt-2 font-body text-sm leading-relaxed text-muted">
              Your account is ready. We&apos;ve sent a verification link to{" "}
              <b className="text-foreground">{email}</b> — confirm it to secure your account. You can start exploring right away.
            </p>
          )}

          <div className="mt-4 flex items-center gap-3">
            <button
              onClick={resendVerification}
              disabled={resendState === "sending"}
              className="font-body text-sm font-semibold text-accent disabled:opacity-60"
            >
              {resendState === "sending" ? "Sending…" : resendState === "sent" ? "Sent again ✓" : "Resend verification email"}
            </button>
          </div>

          <button onClick={() => router.push("/")} className={primaryBtn + " mt-6"}>
            Go to Vedam
          </button>
        </>
      )}
    </div>
  );
}

const inputCls =
  "w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none transition-colors focus:border-[color:rgb(var(--accent))]";
const primaryBtn =
  "w-full rounded-xl bg-brand-gradient px-5 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block font-body text-xs font-semibold text-foreground">{label}</span>
      {children}
    </label>
  );
}

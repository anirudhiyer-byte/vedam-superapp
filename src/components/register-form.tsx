"use client";
import { gtmEvent } from "@/lib/analytics/gtm";
import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { readUtm } from "@/lib/utm";
import { Turnstile } from "@/components/turnstile";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { INDIA_STATES, STATE_CITIES } from "@/lib/india-cities";

const GRAD_YEARS = [2024, 2025, 2026, 2027, 2028];
const STREAMS = ["PCM", "PCMB", "PCB", "Others"] as const;

type Step = "part1" | "otp" | "part2" | "done";

export function RegisterForm() {
  const [supabase] = useState(() => createClient());
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextUrl = decodeURIComponent(searchParams.get("next") || "/");
  // if we're inside the VSAT flow, part-2 copy leads with the VSAT confirmation
  const isVsat = nextUrl.startsWith("/vsat");

  const [step, setStep] = useState<Step>("part1");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Part 1
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaReset, setCaptchaReset] = useState(0);
  const [otp, setOtp] = useState("");
  // Part 2
  const [gradYear, setGradYear] = useState<number | "">("");
  const [stream, setStream] = useState<(typeof STREAMS)[number] | "">("");
  const [streamOther, setStreamOther] = useState("");
  const [state, setState] = useState("");
  const [city, setCity] = useState("");
  const [emailOtp, setEmailOtp] = useState("");
  const [emailVerified, setEmailVerified] = useState(false);
  const [resendState, setResendState] = useState<"idle" | "sending" | "sent">("idle");
  const [savingP2, setSavingP2] = useState(false);

  const e164 = (raw: string) => "+91" + raw.replace(/\D/g, "").slice(-10);
  const goNext = () => window.location.assign(nextUrl);

  // ---------- PART 1: name + WhatsApp + email -> phone OTP ----------
  async function sendOtp() {
    setError(null);
    if (!fullName.trim()) return setError("Enter your name.");
    if (phone.replace(/\D/g, "").length < 10) return setError("Enter a valid 10-digit WhatsApp number.");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return setError("Enter a valid email.");
    if (!consent) return setError("Please accept the consent to continue.");
    if (process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY && !captchaToken) return setError("Please complete the captcha.");

    setLoading(true);
    // rate-limit OTP sends (per phone) to prevent SMS abuse — Turnstile already gates bots
    const { data: allowed } = await supabase.rpc("otp_allowed", { p_phone: e164(phone), p_ip: null });
    if (allowed === false) { setLoading(false); setCaptchaToken(null); setCaptchaReset((x) => x + 1); return setError("Too many code requests for this number. Please wait a few minutes and try again."); }
    const utm = readUtm();
    try { await fetch("/api/auth/reclaim", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone: e164(phone), email: email.trim() }) }); } catch { /* best effort */ }
    const { error } = await supabase.auth.signInWithOtp({
      phone: e164(phone),
      options: { shouldCreateUser: true, channel: "sms", captchaToken: captchaToken || undefined,
        data: { full_name: fullName.trim(), email: email.trim(), consent_given: "true", ...utm } },
    });
    setLoading(false);
    if (error) { setCaptchaToken(null); setCaptchaReset((x) => x + 1); return setError(error.message); }
    setStep("otp");
  }

  // ---------- PHONE OTP -> save Part-1 (lead) -> Part 2 ----------
  async function verify() {
    setError(null);
    if (otp.replace(/\D/g, "").length < 4) return setError("Enter the code we sent you.");
    setLoading(true);
    const { data, error } = await supabase.auth.verifyOtp({ phone: e164(phone), token: otp.replace(/\D/g, ""), type: "sms" });
    if (error || !data.user) { setLoading(false); return setError(error?.message ?? "That code didn't work. Try again."); }

    const utm = readUtm();
    await supabase.from("profiles").update({
      full_name: fullName.trim(), email: email.trim(), mobile_verified: true,
      consent_given: true, consent_at: new Date().toISOString(), last_login_at: new Date().toISOString(),
      utm_source: utm.utm_source ?? null, utm_medium: utm.utm_medium ?? null, utm_campaign: utm.utm_campaign ?? null,
      referrer: utm.referrer ?? null, landing_path: utm.landing_path ?? null,
    }).eq("id", data.user.id);
    await supabase.from("activity_log").insert({ user_id: data.user.id, event_type: "signup",
      utm_source: utm.utm_source ?? null, utm_medium: utm.utm_medium ?? null, utm_campaign: utm.utm_campaign ?? null });
    gtmEvent("sign_up", { method: "otp" });   // Part-1 done = a Vedam One lead

    // if this is the VSAT flow, record the early interest right away (single-button, no questions)
    if (isVsat) { try { await supabase.rpc("record_vsat_interest"); } catch { /* */ } }

    // attach email -> sends the 6-digit email code for Part-2 verification
    try { await fetch("/api/auth/reclaim", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: email.trim() }) }); } catch { /* */ }
    try { await supabase.auth.updateUser({ email: email.trim() }); } catch { /* */ }
    setLoading(false);
    setStep("part2");
  }

  // ---------- PART 2: details + email verify (skippable) ----------
  async function completePart2() {
    setError(null);
    if (!gradYear) return setError("Select your class 12 graduation year.");
    if (!stream) return setError("Select your stream.");
    if (stream === "Others" && !streamOther.trim()) return setError("Tell us your stream.");
    if (!state) return setError("Select your state.");
    if (!city) return setError("Select your city.");
    if (emailOtp.replace(/\D/g, "").length < 4) return setError("Enter the code from your email to verify it.");
    setSavingP2(true);
    // verify email
    const { error: eErr } = await supabase.auth.verifyOtp({ email: email.trim(), token: emailOtp.replace(/\D/g, ""), type: "email_change" });
    if (eErr) { setSavingP2(false); return setError(eErr.message || "Email code didn't work."); }
    const { data: u } = await supabase.auth.getUser();
    if (u?.user) {
      await supabase.from("profiles").update({
        grad_year: Number(gradYear), stream, stream_other: stream === "Others" ? streamOther.trim() : null,
        state, city, email_verified: true,     // -> profile_completed flips true via the DB trigger
      }).eq("id", u.user.id);
    }
    setEmailVerified(true); setSavingP2(false);
    goNext();   // resume the pending action / land back where they came from
  }

  async function resendEmailCode() {
    setResendState("sending");
    const { error } = await supabase.auth.updateUser({ email: email.trim() });
    setResendState(error ? "idle" : "sent");
  }

  return (
    <div className="relative rounded-2xl border border-white/12 bg-white/[0.05] p-6 shadow-[0_24px_60px_-30px_rgba(0,0,0,0.6)] backdrop-blur-xl sm:p-8">
      {/* PART 1 */}
      {step === "part1" && (
        <>
          <h1 className="font-display text-2xl font-bold text-white">Create your account</h1>
          <p className="mt-1 font-body text-sm text-white/55">Takes 20 seconds — just the essentials to get you in.</p>
          <div className="mt-6 space-y-4">
            <Field label="Full name"><input className={inputCls} value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Aarav Sharma" /></Field>
            <Field label="WhatsApp number">
              <div className="flex">
                <span className="inline-flex items-center rounded-l-lg border border-r-0 border-white/12 bg-white/[0.06] px-3 text-sm text-white/60">+91</span>
                <input className={inputCls + " rounded-l-none"} value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="numeric" placeholder="98765 43210" />
              </div>
              <p className="mt-1 font-body text-xs text-white/55">We&apos;ll send reminders and updates here on WhatsApp.</p>
            </Field>
            <Field label="Email"><input className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="you@example.com" /></Field>
            <label className="flex items-start gap-2.5 pt-1">
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1 h-4 w-4 accent-[color:rgb(var(--accent))]" />
              <span className="font-body text-xs leading-relaxed text-white/55">I agree to Vedam contacting me and processing my details as per the <a href="/privacy" target="_blank" className="text-accent underline">Privacy Policy</a> and <a href="/terms" target="_blank" className="text-accent underline">Terms</a>.</span>
            </label>
            <Turnstile onToken={setCaptchaToken} resetKey={captchaReset} />
            {error && <p className="font-body text-sm text-red-500">{error}</p>}
            <button onClick={sendOtp} disabled={loading} className={primaryBtn}>{loading ? "Sending code…" : "Send OTP"}</button>
            <p className="text-center font-body text-sm text-white/55">Already have an account? <Link href={`/login?next=${encodeURIComponent(nextUrl)}`} className="font-semibold text-accent">Log in</Link></p>
          </div>
        </>
      )}

      {/* PHONE OTP */}
      {step === "otp" && (
        <>
          <h1 className="font-display text-2xl font-bold text-white">Enter the code</h1>
          <p className="mt-1 font-body text-sm text-white/55">We sent a 6-digit code to +91 {phone.replace(/\D/g, "").slice(-10)}.</p>
          <div className="mt-6 space-y-4">
            <input className={otpCls} value={otp} onChange={(e) => setOtp(e.target.value)} inputMode="numeric" maxLength={6} placeholder="••••••" />
            {error && <p className="font-body text-sm text-red-500">{error}</p>}
            <button onClick={verify} disabled={loading} className={primaryBtn}>{loading ? "Verifying…" : "Verify phone"}</button>
            <button onClick={() => { setStep("part1"); setOtp(""); setError(null); }} className="w-full font-body text-sm text-white/55">← Wrong number or email? Edit details</button>
          </div>
        </>
      )}

      {/* PART 2 — details + email verify, SKIPPABLE */}
      {step === "part2" && (
        <>
          <button onClick={goNext} aria-label="Skip for now" className="absolute right-4 top-4 grid h-8 w-8 place-items-center rounded-full text-white/50 hover:bg-white/10 hover:text-white">✕</button>
          {isVsat ? (
            <>
              <h1 className="font-display text-xl font-bold text-white">Your Early VSAT Registration is confirmed & recorded ✅</h1>
              <p className="mt-2 font-body text-sm leading-relaxed text-white/60">Please fill the details below to access Live Bootcamps, CodeSprint modules and other Vedam One products. It only takes 30 seconds.</p>
            </>
          ) : (
            <>
              <h1 className="font-display text-xl font-bold text-white">You&apos;re in 🎉 One more step</h1>
              <p className="mt-2 font-body text-sm leading-relaxed text-white/60">These details unlock Bootcamps, events, CodeSprint and other Vedam One products. <b className="text-[#8fe9f5]">Pro Tip: do it now — takes 30 seconds.</b></p>
            </>
          )}
          <div className="mt-5 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Class 12 grad year"><select className={inputCls} value={gradYear} onChange={(e) => setGradYear(e.target.value ? Number(e.target.value) : "")}><option value="" className="bg-[#160a30] text-white">Select</option>{GRAD_YEARS.map((y) => <option key={y} value={y} className="bg-[#160a30] text-white">{y}</option>)}</select></Field>
              <Field label="Stream"><select className={inputCls} value={stream} onChange={(e) => setStream(e.target.value as typeof stream)}><option value="" className="bg-[#160a30] text-white">Select</option>{STREAMS.map((s) => <option key={s} value={s} className="bg-[#160a30] text-white">{s}</option>)}</select></Field>
            </div>
            {stream === "Others" && <Field label="Your stream"><input className={inputCls} value={streamOther} onChange={(e) => setStreamOther(e.target.value)} placeholder="e.g. Commerce" /></Field>}
            <div className="grid grid-cols-2 gap-3">
              <Field label="State / UT"><SearchableSelect options={INDIA_STATES} value={state} onChange={(v) => { setState(v); setCity(""); }} placeholder="Select state…" /></Field>
              <Field label="City"><SearchableSelect options={state ? (STATE_CITIES[state] ?? []) : []} value={city} onChange={setCity} placeholder={state ? "Select city…" : "Pick a state first"} disabled={!state} /></Field>
            </div>
            <Field label={`Verify your email (${email})`}>
              <div className="flex gap-2">
                <input className={inputCls + " text-center tracking-[0.3em]"} value={emailOtp} onChange={(e) => setEmailOtp(e.target.value)} inputMode="numeric" maxLength={6} placeholder="Email code" />
                <button onClick={resendEmailCode} disabled={resendState === "sending"} className="shrink-0 rounded-lg border border-white/15 px-3 text-xs font-semibold text-accent disabled:opacity-60">{resendState === "sending" ? "…" : resendState === "sent" ? "Sent ✓" : "Resend"}</button>
              </div>
            </Field>
            {error && <p className="font-body text-sm text-red-500">{error}</p>}
            <button onClick={completePart2} disabled={savingP2} className={primaryBtn}>{savingP2 ? "Saving…" : "Complete profile"}</button>
            <button onClick={goNext} className="w-full font-body text-sm text-white/50 hover:text-white/80">I&apos;ll do this later →</button>
          </div>
        </>
      )}
    </div>
  );
}

const inputCls = "w-full rounded-lg border border-white/15 bg-white/[0.06] px-3 py-2.5 text-sm text-white/90 outline-none transition-colors [color-scheme:dark] focus:border-[#00cfe5]";
const otpCls = inputCls + " text-center text-lg tracking-[0.4em]";
const primaryBtn = "w-full rounded-xl bg-brand-gradient px-5 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (<label className="block"><span className="mb-1.5 block font-body text-xs font-semibold text-white/90">{label}</span>{children}</label>);
}

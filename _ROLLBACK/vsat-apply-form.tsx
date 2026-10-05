"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { readUtm } from "@/lib/utm";
import { track } from "@/lib/analytics/track";

const GRAD_YEARS = [2024, 2025, 2026, 2027, 2028];
const STREAMS = ["PCM", "PCMB", "PCB", "Others"] as const;
const CAMPUSES = ["Gurugram (Sushant University)", "Pune (ADYPU)"] as const;
const HEAR = ["Instagram", "YouTube", "Google Search", "Friend / Referral", "School / Teacher", "Event / Webinar", "Other"] as const;

type Step = "part1" | "otp" | "part2" | "done";
const inputCls = "w-full rounded-xl border border-white/15 bg-white/[0.06] px-4 py-3 text-sm text-white placeholder-white/35 outline-none transition focus:border-[#00cfe5] [color-scheme:dark]";
const headGrad = { background: "linear-gradient(138deg,#00cfe5 5%,#c200db 97%)", WebkitBackgroundClip: "text" as const, backgroundClip: "text" as const, WebkitTextFillColor: "transparent" as const, color: "transparent" };

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1.5 block text-xs font-medium text-white/60">{label}</span>{children}</label>;
}
const e164 = (raw: string) => "+91" + raw.replace(/\D/g, "").slice(-10);

export function VsatApplyForm() {
  const [supabase] = useState(() => createClient());
  const router = useRouter();
  const [step, setStep] = useState<Step>("part1");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [phoneVerified, setPhoneVerified] = useState(false);

  const [gradYear, setGradYear] = useState<number | "">("");
  const [stream, setStream] = useState<(typeof STREAMS)[number] | "">("");
  const [streamOther, setStreamOther] = useState("");
  const [state, setState] = useState("");
  const [city, setCity] = useState("");
  const [campusPref, setCampusPref] = useState<(typeof CAMPUSES)[number] | "">("");
  const [hearAbout, setHearAbout] = useState<(typeof HEAR)[number] | "">("");
  const [emailOtp, setEmailOtp] = useState("");
  const [emailVerified, setEmailVerified] = useState(false);
  const [savingP2, setSavingP2] = useState(false);

  // ---- prefill from existing profile; resume saved state ----
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: p } = await supabase.from("profiles").select("full_name,email,phone,mobile_verified,email_verified,grad_year,stream,stream_other,state,city").eq("id", user.id).maybeSingle();
      if (!p) return;
      const prof = p as Record<string, unknown>;
      setFullName((prof.full_name as string) ?? "");
      setEmail((prof.email as string) ?? "");
      setPhone(((prof.phone as string) ?? "").replace(/^\+91/, ""));
      if (prof.mobile_verified) setPhoneVerified(true);
      if (prof.email_verified) setEmailVerified(true);
      if (prof.grad_year) setGradYear(Number(prof.grad_year));
      if (prof.stream) setStream(prof.stream as typeof stream);
      if (prof.stream_other) setStreamOther(prof.stream_other as string);
      if (prof.state) setState(prof.state as string);
      if (prof.city) setCity(prof.city as string);
    })();
  }, [supabase]);

  async function makeLead() {
    const utm = readUtm();
    const { data: { session } } = await supabase.auth.getSession();
    await fetch("/api/vsat/lead", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
      accessToken: session?.access_token,
      lead: { name: fullName.trim(), email: email.trim(), phone: e164(phone), hearAbout, campusPref,
        utm_source: utm.utm_source, utm_medium: utm.utm_medium, utm_campaign: utm.utm_campaign, utm_content: utm.utm_content,
        primary_utm: utm.utm_campaign, latest_utm: utm.utm_campaign, lead_source: utm.utm_source },
    }) });
    track("vsat_lead_created");
  }

  // ---------- PART 1 ----------
  async function sendOtp() {
    setError(null);
    if (!fullName.trim()) return setError("Enter your full name.");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return setError("Enter a valid email.");
    if (phone.replace(/\D/g, "").length < 10) return setError("Enter a valid 10-digit mobile.");
    // existing verified phone: skip OTP, go straight to lead + part 2
    if (phoneVerified) { setLoading(true); await supabase.from("profiles").update({ full_name: fullName.trim(), email: email.trim() }).eq("id", (await supabase.auth.getUser()).data.user?.id ?? ""); await makeLead(); setLoading(false); return setStep("part2"); }
    setLoading(true);
    try { await fetch("/api/auth/reclaim", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone: e164(phone), email: email.trim() }) }); } catch { /* best effort */ }
    const { error } = await supabase.auth.signInWithOtp({ phone: e164(phone) });
    setLoading(false);
    if (error) return setError(error.message || "Couldn't send OTP.");
    setStep("otp");
  }

  async function verify() {
    setError(null);
    if (otp.replace(/\D/g, "").length < 4) return setError("Enter the OTP.");
    setLoading(true);
    const { data, error } = await supabase.auth.verifyOtp({ phone: e164(phone), token: otp.replace(/\D/g, ""), type: "sms" });
    if (error || !data.user) { setLoading(false); return setError(error?.message || "OTP didn't work."); }
    const utm = readUtm();
    await supabase.from("profiles").update({
      full_name: fullName.trim(), email: email.trim(), mobile_verified: true,
      utm_source: utm.utm_source ?? null, utm_medium: utm.utm_medium ?? null, utm_campaign: utm.utm_campaign ?? null,
    }).eq("id", data.user.id);
    await makeLead();                      // <-- LEAD IS CREATED ON OTP VERIFY
    track("sign_up", { method: "otp", surface: "vsat" });
    setPhoneVerified(true); setLoading(false); setStep("part2");
  }

  // ---------- PART 2 -> APPLICANT ----------
  async function startApplication() {
    setError(null);
    if (!gradYear) return setError("Select your class 12 passing year.");
    if (!stream) return setError("Select your stream.");
    if (stream === "Others" && !streamOther.trim()) return setError("Tell us your stream.");
    if (!state) return setError("Enter your state.");
    if (!city) return setError("Enter your city.");
    if (!campusPref) return setError("Select your campus preference.");
    if (!emailVerified && emailOtp.replace(/\D/g, "").length < 4) return setError("Verify your email to continue.");
    setSavingP2(true);
    if (!emailVerified) {
      const { error: eErr } = await supabase.auth.verifyOtp({ email: email.trim(), token: emailOtp.replace(/\D/g, ""), type: "email_change" });
      if (eErr) { setSavingP2(false); return setError(eErr.message || "Email code didn't work."); }
    }
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      await supabase.from("profiles").update({
        grad_year: Number(gradYear), stream, stream_other: stream === "Others" ? streamOther.trim() : null,
        state, city, email: email.trim(), email_verified: true,
      }).eq("id", user.id);
    }
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch("/api/vsat/application", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
      accessToken: session?.access_token,
      app: { name: fullName.trim(), email: email.trim(), phone: e164(phone), campusPref, stream: stream === "Others" ? streamOther.trim() : stream, gradYear: Number(gradYear), state, city },
    }) });
    const j = await res.json();
    setSavingP2(false);
    if (!j.ok) return setError(j.error || "Couldn't start application.");
    track("vsat_application_started");
    setStep("done");
    setTimeout(() => router.push("/vsat/dashboard"), 900);   // applicant dashboard (next build)
  }

  async function sendEmailCode() {
    setError(null);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return setError("Enter a valid email.");
    const { error } = await supabase.auth.updateUser({ email: email.trim() });
    if (error) return setError(error.message || "Couldn't send the email code.");
  }

  return (
    <div className="w-full max-w-md rounded-2xl border border-white/12 bg-white/[0.05] p-6 shadow-[0_24px_60px_-30px_rgba(0,0,0,0.6)] backdrop-blur-xl sm:p-8">
      {step === "part1" && (<>
        <h1 className="font-display text-2xl font-bold" style={headGrad}>Register for VSAT</h1>
        <p className="mt-1 text-sm text-white/55">Takes 20 seconds. Verify your number to secure your spot.</p>
        <div className="mt-6 space-y-4">
          <Field label="Full name"><input className={inputCls} value={fullName} onChange={(e) => setFullName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && sendOtp()} placeholder="Aarav Sharma" /></Field>
          <Field label="Email"><input className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === "Enter" && sendOtp()} placeholder="you@email.com" /></Field>
          <Field label="Mobile"><div className="flex items-center gap-2"><span className="rounded-xl border border-white/15 bg-white/[0.06] px-3 py-3 text-sm text-white/70">+91</span><input className={inputCls} value={phone} onChange={(e) => setPhone(e.target.value)} onKeyDown={(e) => e.key === "Enter" && sendOtp()} placeholder="98765 43210" inputMode="numeric" /></div></Field>
        </div>
        {error && <p className="mt-3 text-xs text-[#ff9db0]">{error}</p>}
        <button onClick={sendOtp} disabled={loading} className="mt-6 w-full rounded-xl bg-gradient-to-r from-[#00cfe5] to-[#c200db] py-3 text-sm font-semibold text-white disabled:opacity-50">{loading ? "…" : phoneVerified ? "Save & next" : "Verify number"}</button>
      </>)}

      {step === "otp" && (<>
        <h1 className="font-display text-2xl font-bold" style={headGrad}>Verify OTP</h1>
        <p className="mt-1 text-sm text-white/55">Enter the code sent to +91 {phone}.</p>
        <div className="mt-6 space-y-4">
          <Field label="OTP"><input className={inputCls} value={otp} onChange={(e) => setOtp(e.target.value)} onKeyDown={(e) => e.key === "Enter" && verify()} placeholder="••••" inputMode="numeric" /></Field>
        </div>
        {error && <p className="mt-3 text-xs text-[#ff9db0]">{error}</p>}
        <button onClick={verify} disabled={loading} className="mt-6 w-full rounded-xl bg-gradient-to-r from-[#00cfe5] to-[#c200db] py-3 text-sm font-semibold text-white disabled:opacity-50">{loading ? "…" : "Verify & continue"}</button>
        <button onClick={() => setStep("part1")} className="mt-3 w-full text-xs text-white/50">← Edit details</button>
      </>)}

      {step === "part2" && (<>
        <h1 className="font-display text-2xl font-bold" style={headGrad}>A few more details</h1>
        <p className="mt-1 text-sm text-white/55">Then start your application.</p>
        <div className="mt-6 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Class 12 passing year"><select className={inputCls} value={gradYear} onChange={(e) => setGradYear(e.target.value ? Number(e.target.value) : "")}><option value="" className="bg-[#160a30]">Select</option>{GRAD_YEARS.map((y) => <option key={y} value={y} className="bg-[#160a30]">{y}</option>)}</select></Field>
            <Field label="Stream"><select className={inputCls} value={stream} onChange={(e) => setStream(e.target.value as typeof stream)}><option value="" className="bg-[#160a30]">Select</option>{STREAMS.map((s) => <option key={s} value={s} className="bg-[#160a30]">{s}</option>)}</select></Field>
          </div>
          {stream === "Others" && <Field label="Your stream"><input className={inputCls} value={streamOther} onChange={(e) => setStreamOther(e.target.value)} /></Field>}
          <div className="grid grid-cols-2 gap-3">
            <Field label="State"><input className={inputCls} value={state} onChange={(e) => setState(e.target.value)} placeholder="Haryana" /></Field>
            <Field label="City"><input className={inputCls} value={city} onChange={(e) => setCity(e.target.value)} placeholder="Gurugram" /></Field>
          </div>
          <Field label="Campus preference"><select className={inputCls} value={campusPref} onChange={(e) => setCampusPref(e.target.value as typeof campusPref)}><option value="" className="bg-[#160a30]">Select</option>{CAMPUSES.map((c) => <option key={c} value={c} className="bg-[#160a30]">{c}</option>)}</select></Field>
          <Field label="Where did you hear about us?"><select className={inputCls} value={hearAbout} onChange={(e) => setHearAbout(e.target.value as typeof hearAbout)}><option value="" className="bg-[#160a30]">Select</option>{HEAR.map((h) => <option key={h} value={h} className="bg-[#160a30]">{h}</option>)}</select></Field>
          {!emailVerified && (
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
              <p className="text-xs text-white/55">Verify your email: {email}</p>
              <div className="mt-2 flex items-center gap-2">
                <input className={inputCls} value={emailOtp} onChange={(e) => setEmailOtp(e.target.value)} placeholder="Email OTP" inputMode="numeric" />
                <button onClick={sendEmailCode} className="shrink-0 rounded-xl border border-white/15 px-3 py-3 text-xs text-white/70">Send code</button>
              </div>
            </div>
          )}
        </div>
        {error && <p className="mt-3 text-xs text-[#ff9db0]">{error}</p>}
        <button onClick={startApplication} disabled={savingP2} className="mt-6 w-full rounded-xl bg-gradient-to-r from-[#00cfe5] to-[#c200db] py-3 text-sm font-semibold text-white disabled:opacity-50">{savingP2 ? "Starting…" : "Start application"}</button>
      </>)}

      {step === "done" && (<div className="py-8 text-center">
        <div className="text-4xl">🎉</div>
        <h1 className="mt-3 font-display text-2xl font-bold" style={headGrad}>You're an applicant!</h1>
        <p className="mt-2 text-sm text-white/55">Taking you to your dashboard…</p>
      </div>)}
    </div>
  );
}

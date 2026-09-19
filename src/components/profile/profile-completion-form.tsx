"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { INDIA_STATES, STATE_CITIES } from "@/lib/india-cities";

const GRAD_YEARS = [2024, 2025, 2026, 2027, 2028];
const STREAMS = ["PCM", "PCMB", "PCB", "Others"] as const;
const inputCls = "w-full rounded-lg border border-white/15 bg-white/[0.06] px-3 py-2.5 text-sm text-white/90 outline-none [color-scheme:dark] focus:border-[#00cfe5]";
const primaryBtn = "w-full rounded-xl bg-brand-gradient px-5 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60";

/** Part-2 profile completion, reused by the header dropdown AND the product gate.
 *  On success (email verified + all fields saved -> profile_completed=true), calls onComplete(). */
export function ProfileCompletionForm({ onComplete }: { onComplete: () => void }) {
  const [supabase] = useState(() => createClient());
  const [email, setEmail] = useState("");
  const [gradYear, setGradYear] = useState<number | "">("");
  const [stream, setStream] = useState<(typeof STREAMS)[number] | "">("");
  const [streamOther, setStreamOther] = useState("");
  const [state, setState] = useState("");
  const [city, setCity] = useState("");
  const [emailOtp, setEmailOtp] = useState("");
  const [sent, setSent] = useState<"idle" | "sending" | "sent">("idle");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return;
      const { data: p } = await supabase.from("profiles").select("email, grad_year, stream, stream_other, state, city, email_verified").eq("id", session.user.id).maybeSingle();
      const pr = p as { email?: string; grad_year?: number; stream?: string; stream_other?: string; state?: string; city?: string; email_verified?: boolean } | null;
      setEmail(pr?.email || session.user.email || "");
      if (pr?.grad_year) setGradYear(pr.grad_year);
      if (pr?.stream) setStream(pr.stream as typeof stream);
      if (pr?.stream_other) setStreamOther(pr.stream_other);
      if (pr?.state) setState(pr.state);
      if (pr?.city) setCity(pr.city);
      if (pr?.email_verified) setSent("sent"); // already verified — hide the code step effectively
    })();
  }, [supabase]);

  async function sendCode() {
    setSent("sending"); setErr("");
    const { error } = await supabase.auth.updateUser({ email: email.trim() });
    setSent(error ? "idle" : "sent");
    if (error) setErr(error.message);
  }

  async function save() {
    setErr("");
    if (!gradYear) return setErr("Select your class 12 graduation year.");
    if (!stream) return setErr("Select your stream.");
    if (stream === "Others" && !streamOther.trim()) return setErr("Tell us your stream.");
    if (!state) return setErr("Select your state.");
    if (!city) return setErr("Select your city.");
    setSaving(true);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) { setSaving(false); return setErr("Session expired — please refresh."); }
    // verify email unless already verified
    const { data: prof } = await supabase.from("profiles").select("email_verified").eq("id", session.user.id).maybeSingle();
    if (!(prof as { email_verified?: boolean } | null)?.email_verified) {
      if (emailOtp.replace(/\D/g, "").length < 4) { setSaving(false); return setErr("Enter the code from your email to verify it."); }
      const { error: eErr } = await supabase.auth.verifyOtp({ email: email.trim(), token: emailOtp.replace(/\D/g, ""), type: "email_change" });
      if (eErr) { setSaving(false); return setErr(eErr.message || "Email code didn't work."); }
    }
    await supabase.from("profiles").update({
      grad_year: Number(gradYear), stream, stream_other: stream === "Others" ? streamOther.trim() : null,
      state, city, email_verified: true,
    }).eq("id", session.user.id);
    setSaving(false);
    onComplete();
  }

  return (
    <div className="space-y-4">
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
          <button onClick={sendCode} disabled={sent === "sending"} className="shrink-0 rounded-lg border border-white/15 px-3 text-xs font-semibold text-accent disabled:opacity-60">{sent === "sending" ? "…" : sent === "sent" ? "Sent ✓" : "Send code"}</button>
        </div>
      </Field>
      {err && <p className="font-body text-sm text-red-500">{err}</p>}
      <button onClick={save} disabled={saving} className={primaryBtn}>{saving ? "Saving…" : "Complete profile"}</button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (<label className="block"><span className="mb-1.5 block font-body text-xs font-semibold text-white/90">{label}</span>{children}</label>);
}

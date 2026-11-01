"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { track } from "@/lib/analytics/track";

const VSAT_FEE = 1000; // placeholder — real amount comes from the VSAT campaign
type App = Record<string, unknown> | null;
type Lead = Record<string, unknown> | null;

const MILESTONES = [
  { key: "started", label: "Application started" },
  { key: "paid", label: "Pay VSAT fee" },
  { key: "form", label: "Fill application form" },
  { key: "slot", label: "Select exam slot" },
  { key: "exam", label: "Give VSAT" },
  { key: "result", label: "VSAT result" },
  { key: "interview", label: "Interview" },
  { key: "counselling", label: "Counselling & offer" },
  { key: "enrolled", label: "Enroll" },
];

function activeIndex(app: App): number {
  if (!app) return 0;
  const a = app as Record<string, string>;
  const pay = a.payment_stage_1, appl = a.application_stage_1;
  if (appl === "enrolled") return 8;
  if (appl === "offer_released" || appl === "counselling_done") return 7;
  if (appl === "interview_selected" || appl === "interview_rejected") return 6;
  if (appl === "vsat_cleared" || appl === "vsat_not_cleared") return 5;
  if (appl === "slot_selected") return 4;
  if (pay === "payment_approved") return 2;
  if (pay === "payment_initiated") return 1;
  return 1; // applicant, unpaid -> next action is pay
}

/** Live HH:MM:SS left until `deadline` (ms epoch); null once elapsed. Ticks every second. */
function useCountdown(deadline: number): string | null {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!deadline) return;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [deadline]);
  if (!deadline) return null;
  const ms = deadline - Date.now();
  if (ms <= 0) return null;
  const h = Math.floor(ms / 3_600_000), m = Math.floor((ms % 3_600_000) / 60_000), s = Math.floor((ms % 60_000) / 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// light theme tokens
const card = "rounded-2xl border border-[#ece8f6] bg-white p-6 shadow-[0_8px_30px_-18px_rgba(90,40,160,0.25)]";
const gradBtn = "rounded-xl bg-gradient-to-r from-[#00cfe5] to-[#c200db] px-6 py-3 text-sm font-semibold text-white disabled:opacity-50";

export function VsatDashboard() {
  const [supabase] = useState(() => createClient());
  const [app, setApp] = useState<App>(null);
  const [lead, setLead] = useState<Lead>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setLoading(false); return; }
    const res = await fetch("/api/vsat/me", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accessToken: session.access_token }) });
    const j = await res.json();
    if (j.ok) { setApp(j.app); setLead(j.lead); }
    setLoading(false);
  }, [supabase]);
  useEffect(() => { void load(); }, [load]);

  const a0 = (app ?? {}) as Record<string, string>;
  const created0 = a0.created_at ? new Date(a0.created_at).getTime() : 0;
  const deadline = created0 ? created0 + 24 * 3600 * 1000 : 0;
  const countdown = useCountdown(deadline); // live for everyone while the 24h window is open

  async function patch(updates: Record<string, unknown>) {
    setBusy(true); setErr("");
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch("/api/vsat/stage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accessToken: session?.access_token, updates }) });
    const j = await res.json(); setBusy(false);
    if (!j.ok) return setErr(j.error || "Update failed.");
    await load();
  }

  const BackBar = (
    <div className="flex items-center justify-between px-6 py-4 lg:px-10">
      <Link href="/vsat" className="inline-flex items-center gap-2 rounded-full border border-[#ece8f6] bg-white px-4 py-2 text-sm font-medium text-[#1b1430] shadow-sm transition hover:bg-[#f6f3fd]">← Back</Link>
    </div>
  );

  if (loading) return <div className="min-h-screen bg-[#faf9fe]">{BackBar}<div className="p-10 text-[#6b647e]">Loading your dashboard…</div></div>;
  if (!app) return <div className="min-h-screen bg-[#faf9fe]">{BackBar}<div className="p-10 text-[#1b1430]">No VSAT application found. <a href="/vsat" className="font-semibold text-[#7b2ff7] underline">Start one →</a></div></div>;

  const a = app as Record<string, string>;
  const pay = a.payment_stage_1, appl = a.application_stage_1;
  const paid = pay === "payment_approved";
  const idx = activeIndex(app);

  const quickLinks = [
    { label: "📘 Download brochure", free: true },
    { label: "📄 Download mock papers", free: false },
    { label: "📝 Start a mock test", free: false },
    { label: "🎯 VSAT syllabus & pattern", free: false },
  ];

  return (
    <div className="min-h-screen bg-[#faf9fe] text-[#1b1430]">
      {BackBar}
      <div className="lg:grid lg:grid-cols-[25%_50%_25%]">
        {/* LEFT 25% — journey rail */}
        <aside className="border-[#ece8f6] px-6 pb-8 lg:border-r lg:px-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#9a93ad]">Your journey</p>
          <p className="mt-1 text-sm font-semibold">{(lead as Record<string,string>)?.public_id ?? a.application_no}</p>
          <ol className="mt-6 space-y-1">
            {MILESTONES.map((m, i) => (
              <li key={m.key} className="flex items-start gap-3">
                <div className="flex flex-col items-center">
                  <span className={`flex h-6 w-6 items-center justify-center rounded-full border text-[11px] ${i < idx ? "border-[#16a34a] bg-[#16a34a]/10 text-[#16a34a]" : i === idx ? "border-[#7b2ff7] bg-[#7b2ff7]/10 text-[#7b2ff7]" : "border-[#e0dbee] text-[#b4adc4]"}`}>{i < idx ? "✓" : i + 1}</span>
                  {i < MILESTONES.length - 1 && <span className={`my-0.5 h-5 w-px ${i < idx ? "bg-[#16a34a]/40" : "bg-[#e7e3f2]"}`} />}
                </div>
                <span className={`pt-0.5 text-sm ${i === idx ? "font-semibold text-[#1b1430]" : i < idx ? "text-[#6b647e]" : "text-[#b4adc4]"}`}>{m.label}</span>
              </li>
            ))}
          </ol>
        </aside>

        {/* MIDDLE 50% — contextual action */}
        <main className="px-6 pb-12 lg:px-10">
          {countdown && (
            <div className="mb-6 rounded-2xl border border-[#f5a623]/40 bg-[#fff7e8] p-4 text-sm text-[#8a5a00]">
              ⏳ <b>{countdown}</b> left on your 24-hour early-bird window{!paid ? " — pay now to save ₹200 on your VSAT fee." : "."}
            </div>
          )}
          {!paid && (
            <div className={card}>
              <h2 className="font-display text-2xl font-bold">Pay your VSAT fee</h2>
              <p className="mt-2 text-[#6b647e]">Pay ₹{VSAT_FEE} to unlock your exam slot, mock tests and the application form.</p>
              <button onClick={() => { track("vsat_pay_click"); setErr("Payments open here soon."); }} disabled={busy} className={`mt-5 ${gradBtn}`}>Pay ₹{VSAT_FEE}</button>
              {pay === "payment_initiated" && <p className="mt-3 text-xs text-[#b8860b]">Payment initiated — complete it on the gateway.</p>}
            </div>
          )}
          {paid && appl !== "slot_selected" && !["vsat_cleared","vsat_not_cleared","interview_selected","counselling_done","offer_released","enrolled"].includes(appl) && (
            <div className="space-y-4">
              <div className={card}>
                <h2 className="font-display text-xl font-bold">Select your exam slot</h2>
                <p className="mt-2 text-sm text-[#6b647e]">Pick your VSAT date &amp; time. You can fill the application form in parallel.</p>
                <button onClick={() => patch({ application_stage_1: "slot_selected", vsat_slot_datetime_1: new Date(Date.now()+7*864e5).toISOString() })} disabled={busy} className={`mt-4 ${gradBtn}`}>Choose slot</button>
              </div>
              <div className={card}>
                <h2 className="font-display text-xl font-bold">Fill application form</h2>
                <p className="mt-2 text-sm text-[#6b647e]">Basic details, academics, parents, documents, consent. Required before the enrollment fee.</p>
                <button onClick={() => patch({ form_stage_1: "form_initiated" })} disabled={busy} className="mt-4 rounded-xl border border-[#d9d2ec] px-5 py-2.5 text-sm font-semibold text-[#1b1430] disabled:opacity-50">Start form</button>
              </div>
            </div>
          )}
          {appl === "slot_selected" && (
            <div className={card}>
              <h2 className="font-display text-xl font-bold">Your slot is booked ✅</h2>
              <p className="mt-2 text-sm text-[#6b647e]">Exam: {a.vsat_slot_datetime_1 ? new Date(a.vsat_slot_datetime_1).toLocaleString() : "—"}. The Take-Test button unlocks at your slot time.</p>
              <button disabled className="mt-4 cursor-not-allowed rounded-xl bg-[#f0edf8] px-5 py-2.5 text-sm font-semibold text-[#b4adc4]">🔒 Take test (locked until slot)</button>
            </div>
          )}
          {["vsat_cleared","interview_selected","counselling_done","offer_released","enrolled"].includes(appl) && (
            <div className="rounded-2xl border border-[#16a34a]/30 bg-[#16a34a]/5 p-6">
              <h2 className="font-display text-xl font-bold text-[#16a34a]">Stage: {appl.replace(/_/g, " ")}</h2>
              <p className="mt-2 text-sm text-[#4b5563]">You&apos;re progressing through the admissions funnel. Watch your email/WhatsApp for the next step.</p>
            </div>
          )}
          {err && <p className="mt-4 text-xs text-[#d14343]">{err}</p>}
        </main>

        {/* RIGHT 25% — quick links (brochure is free; the rest unlock after payment) */}
        <aside className="border-[#ece8f6] px-6 pb-10 lg:border-l">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#9a93ad]">Quick links</p>
          <div className="mt-4 space-y-3">
            {quickLinks.map((q) => {
              const open = q.free || paid;
              return (
                <button key={q.label} disabled={!open} className={`block w-full rounded-xl border px-4 py-3 text-left text-sm transition ${open ? "border-[#e0dbee] bg-white text-[#1b1430] hover:bg-[#f6f3fd]" : "cursor-not-allowed border-[#eee9f6] bg-[#f6f4fb] text-[#b4adc4]"}`}>
                  {q.label}{!open && " 🔒"}
                </button>
              );
            })}
          </div>
          {!paid && <p className="mt-3 text-[11px] text-[#9a93ad]">Mock papers, mock test &amp; syllabus unlock after you pay the VSAT fee. The brochure is free to download.</p>}
        </aside>
      </div>
    </div>
  );
}

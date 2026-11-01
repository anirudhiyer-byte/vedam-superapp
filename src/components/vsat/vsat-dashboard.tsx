"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { track } from "@/lib/analytics/track";
import { VsatFormFill } from "@/components/vsat/vsat-form-fill";

type App = Record<string, unknown> | null;
type Lead = Record<string, unknown> | null;
type Quote = { base: number; discount: number; net: number; within24h: boolean; windowEndsAt: string | null } | null;

type CashfreeCheckout = { checkout: (o: { paymentSessionId: string; redirectTarget?: string }) => void };
declare global { interface Window { Cashfree?: (opts: { mode: string }) => CashfreeCheckout } }

/** Lazy-load the Cashfree v3 web SDK and return an initialised checkout instance. */
function loadCashfree(mode: string): Promise<CashfreeCheckout> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined") return reject(new Error("no window"));
    if (window.Cashfree) return resolve(window.Cashfree({ mode }));
    const s = document.createElement("script");
    s.src = "https://sdk.cashfree.com/js/v3/cashfree.js";
    s.async = true;
    s.onload = () => (window.Cashfree ? resolve(window.Cashfree({ mode })) : reject(new Error("Cashfree SDK unavailable")));
    s.onerror = () => reject(new Error("Could not load the payment SDK"));
    document.head.appendChild(s);
  });
}

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

/** Live HH:MM:SS left until `endsAt` (ISO); null once elapsed. Ticks every second. */
function useCountdown(endsAt: string | null): string | null {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!endsAt) return;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [endsAt]);
  if (!endsAt) return null;
  const ms = new Date(endsAt).getTime() - Date.now();
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
  const [quote, setQuote] = useState<Quote>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const [fillOpen, setFillOpen] = useState(false);

  const load = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setLoading(false); return; }
    const res = await fetch("/api/vsat/me", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accessToken: session.access_token }) });
    const j = await res.json();
    if (j.ok) { setApp(j.app); setLead(j.lead); }
    // fee quote (server-authoritative) drives the 24h banner + the exact pay amount
    try {
      const q = await fetch("/api/payments/vsat-quote", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accessToken: session.access_token }) });
      const qj = await q.json();
      if (qj.ok) setQuote({ base: qj.base, discount: qj.discount, net: qj.net, within24h: qj.within24h, windowEndsAt: qj.windowEndsAt });
    } catch { /* banner is best-effort */ }
    setLoading(false);
  }, [supabase]);

  // On the Cashfree return (?pay=return&order=…), confirm server-side then clean the URL.
  useEffect(() => {
    (async () => {
      const url = new URL(window.location.href);
      if (url.searchParams.get("pay") !== "return") { void load(); return; }
      const orderId = url.searchParams.get("order");
      const { data: { session } } = await supabase.auth.getSession();
      if (orderId && session) {
        setNote("Confirming your payment…");
        try {
          const res = await fetch("/api/payments/vsat-status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accessToken: session.access_token, orderId }) });
          const j = await res.json();
          setNote(j.ok && j.status === "paid" ? "Payment successful 🎉" : j.status === "already_paid" ? "" : "Payment not completed. You can try again.");
        } catch { setNote("Could not confirm payment. Refresh in a moment."); }
      }
      window.history.replaceState({}, "", "/vsat/dashboard");
      void load();
    })();
  }, [supabase, load]);

  async function patch(updates: Record<string, unknown>) {
    setBusy(true); setErr("");
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch("/api/vsat/stage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accessToken: session?.access_token, updates }) });
    const j = await res.json(); setBusy(false);
    if (!j.ok) return setErr(j.error || "Update failed.");
    await load();
  }

  async function startPayment() {
    setBusy(true); setErr("");
    track("vsat_pay_click");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/payments/vsat-create-order", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accessToken: session?.access_token }) });
      const j = await res.json();
      if (!j.ok) { setBusy(false); return setErr(j.error === "already_paid" ? "You've already paid." : j.error || "Could not start payment."); }
      const cashfree = await loadCashfree(j.mode || "sandbox");
      cashfree.checkout({ paymentSessionId: j.paymentSessionId, redirectTarget: "_self" });
      // browser now navigates to Cashfree; on return the effect above confirms.
    } catch (e) {
      setBusy(false);
      setErr(String((e as Error)?.message || "Payment could not start."));
    }
  }

  // live 24h countdown, shown for everyone while the early-bird window is open
  // (hook must run before any early return)
  const countdown = useCountdown(quote?.within24h ? quote?.windowEndsAt ?? null : null);

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
  const payAmount = quote?.net ?? 1000;
  const showDiscount = !!quote && quote.discount > 0 && quote.within24h && !paid;

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
          {note && <div className="mb-4 rounded-xl border border-[#c200db]/25 bg-[#faf1ff] p-3 text-sm text-[#7b2ff7]">{note}</div>}
          {countdown && (
            <div className="mb-6 rounded-2xl border border-[#f5a623]/40 bg-[#fff7e8] p-4 text-sm text-[#8a5a00]">
              ⏳ <b>{countdown}</b> left on your 24-hour early-bird window{showDiscount ? ` — pay now to save ₹${quote?.discount}.` : "."}
            </div>
          )}
          {!paid && (
            <div className={card}>
              <h2 className="font-display text-2xl font-bold">Pay your VSAT fee</h2>
              <p className="mt-2 text-[#6b647e]">Pay to unlock your exam slot, mock tests and the application form.</p>
              <div className="mt-4 flex items-baseline gap-2">
                <span className="text-3xl font-bold">₹{payAmount}</span>
                {showDiscount && <span className="text-lg text-[#b4adc4] line-through">₹{quote?.base}</span>}
                {showDiscount && <span className="rounded-full bg-[#16a34a]/10 px-2 py-0.5 text-xs font-semibold text-[#16a34a]">₹{quote?.discount} off</span>}
              </div>
              <button onClick={startPayment} disabled={busy} className={`mt-5 ${gradBtn}`}>{busy ? "Starting…" : `Pay ₹${payAmount}`}</button>
              {pay === "payment_initiated" && <p className="mt-3 text-xs text-[#b8860b]">Payment initiated — if you didn&apos;t complete it, click Pay to try again.</p>}
              {pay === "payment_failed" && <p className="mt-3 text-xs text-[#d14343]">Last payment failed. You can try again.</p>}
            </div>
          )}
          {paid && appl !== "slot_selected" && !["vsat_cleared","vsat_not_cleared","interview_selected","counselling_done","offer_released","enrolled"].includes(appl) && (
            fillOpen || a.form_status === "in_progress" ? (
              <VsatFormFill onDone={() => { setFillOpen(false); void load(); }} />
            ) : (
            <div className="space-y-4">
              <div className={card}>
                <h2 className="font-display text-xl font-bold">Select your exam slot</h2>
                <p className="mt-2 text-sm text-[#6b647e]">Pick your VSAT date &amp; time. You can fill the application form in parallel.</p>
                <button onClick={() => patch({ application_stage_1: "slot_selected", vsat_slot_datetime_1: new Date(Date.now()+7*864e5).toISOString() })} disabled={busy} className={`mt-4 ${gradBtn}`}>Choose slot</button>
              </div>
              <div className={card}>
                <h2 className="font-display text-xl font-bold">Fill application form</h2>
                <p className="mt-2 text-sm text-[#6b647e]">Basic details, academics, parents, documents, consent. Required before you can take VSAT.</p>
                <button onClick={() => setFillOpen(true)} disabled={busy} className="mt-4 rounded-xl border border-[#d9d2ec] px-5 py-2.5 text-sm font-semibold text-[#1b1430] disabled:opacity-50">{a.form_status === "completed" ? "Review form" : "Start form"}</button>
              </div>
            </div>
            )
          )}
          {paid && a.form_status === "completed" && appl !== "slot_selected" && (
            <p className="mt-3 text-xs text-[#16a34a]">Application form submitted ✓</p>
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

"use client";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { track } from "@/lib/analytics/track";

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

export function VsatDashboard() {
  const [supabase] = useState(() => createClient());
  const [app, setApp] = useState<App>(null);
  const [lead, setLead] = useState<Lead>(null);
  const [quote, setQuote] = useState<Quote>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setLoading(false); return; }
    const res = await fetch("/api/vsat/me", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accessToken: session.access_token }) });
    const j = await res.json();
    if (j.ok) { setApp(j.app); setLead(j.lead); }
    // fee quote (server-authoritative) for the banner + the exact pay amount
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

  const countdown = useCountdown(quote?.within24h ? quote?.windowEndsAt ?? null : null);

  if (loading) return <div className="p-10 text-white/50">Loading your dashboard…</div>;
  if (!app) return <div className="p-10 text-white/60">No VSAT application found. <a href="/vsat" className="text-[#00cfe5] underline">Start one →</a></div>;

  const a = app as Record<string, string>;
  const pay = a.payment_stage_1, appl = a.application_stage_1;
  const paid = pay === "payment_approved";
  const idx = activeIndex(app);
  const payAmount = quote?.net ?? 1000;
  const showDiscount = !!quote && quote.discount > 0 && quote.within24h && !paid;

  return (
    <div className="min-h-screen bg-[#0b0618] text-white lg:grid lg:grid-cols-[25%_50%_25%]">
      {/* LEFT 25% — journey rail */}
      <aside className="border-white/10 p-6 lg:border-r">
        <p className="text-xs uppercase tracking-wide text-white/40">Your journey</p>
        <p className="mt-1 text-sm font-semibold">{(lead as Record<string,string>)?.public_id ?? a.application_no}</p>
        <ol className="mt-6 space-y-1">
          {MILESTONES.map((m, i) => (
            <li key={m.key} className="flex items-start gap-3">
              <div className="flex flex-col items-center">
                <span className={`flex h-6 w-6 items-center justify-center rounded-full border text-[11px] ${i < idx ? "border-[#22e06a] bg-[#22e06a]/20 text-[#22e06a]" : i === idx ? "border-[#00cfe5] bg-[#00cfe5]/20 text-[#00cfe5]" : "border-white/15 text-white/35"}`}>{i < idx ? "✓" : i + 1}</span>
                {i < MILESTONES.length - 1 && <span className={`my-0.5 h-5 w-px ${i < idx ? "bg-[#22e06a]/40" : "bg-white/10"}`} />}
              </div>
              <span className={`pt-0.5 text-sm ${i === idx ? "font-semibold text-white" : i < idx ? "text-white/60" : "text-white/35"}`}>{m.label}</span>
            </li>
          ))}
        </ol>
      </aside>

      {/* MIDDLE 50% — contextual action */}
      <main className="p-6 lg:p-10">
        {note && <div className="mb-6 rounded-2xl border border-white/15 bg-white/[0.05] p-4 text-sm">{note}</div>}

        {showDiscount && (
          <div className="mb-6 overflow-hidden rounded-2xl border border-[#22e06a]/40 bg-gradient-to-r from-[#22e06a]/15 to-[#00cfe5]/10 p-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="font-display text-xl font-bold text-[#22e06a]">₹{quote!.discount} off — pay just ₹{quote!.net}</p>
                <p className="mt-1 text-sm text-white/70">Early-bird offer on your VSAT fee. Pay now and save.</p>
              </div>
              {countdown && <div className="shrink-0 text-right"><p className="text-[10px] uppercase tracking-wide text-white/50">Ends in</p><p className="font-mono text-lg font-bold text-white">{countdown}</p></div>}
            </div>
          </div>
        )}

        {!paid && (
          <div className="rounded-2xl border border-white/12 bg-white/[0.04] p-6">
            <h2 className="font-display text-2xl font-bold">Pay your VSAT fee</h2>
            <p className="mt-2 text-white/60">Unlock your exam slot, mock tests and the application form.</p>
            <div className="mt-4 flex items-baseline gap-2">
              <span className="font-display text-3xl font-bold">₹{payAmount}</span>
              {showDiscount && <span className="text-sm text-white/40 line-through">₹{quote!.base}</span>}
            </div>
            <button onClick={startPayment} disabled={busy}
              className="mt-5 rounded-xl bg-gradient-to-r from-[#00cfe5] to-[#c200db] px-6 py-3 text-sm font-semibold disabled:opacity-50">
              {busy ? "Starting…" : `Pay ₹${payAmount}`}
            </button>
            {pay === "payment_initiated" && <p className="mt-3 text-xs text-[#f5a623]">A payment was started but not completed — tap Pay to try again.</p>}
            {pay === "payment_failed" && <p className="mt-3 text-xs text-[#ff9db0]">Your last payment failed. Please try again.</p>}
          </div>
        )}

        {paid && appl !== "slot_selected" && !["vsat_cleared","vsat_not_cleared","interview_selected","counselling_done","offer_released","enrolled"].includes(appl) && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-white/12 bg-white/[0.04] p-6">
              <h2 className="font-display text-xl font-bold">Select your exam slot</h2>
              <p className="mt-2 text-sm text-white/60">Pick your VSAT date & time. You can fill the application form in parallel.</p>
              <button onClick={() => patch({ application_stage_1: "slot_selected", vsat_slot_datetime_1: new Date(Date.now()+7*864e5).toISOString() })} disabled={busy} className="mt-4 rounded-xl bg-gradient-to-r from-[#00cfe5] to-[#c200db] px-5 py-2.5 text-sm font-semibold disabled:opacity-50">Choose slot</button>
            </div>
            <div className="rounded-2xl border border-white/12 bg-white/[0.04] p-6">
              <h2 className="font-display text-xl font-bold">Fill application form</h2>
              <p className="mt-2 text-sm text-white/60">Basic details, academics, parents, documents, consent. Required before the enrollment fee.</p>
              <button onClick={() => patch({ form_stage_1: "form_initiated" })} disabled={busy} className="mt-4 rounded-xl border border-white/20 px-5 py-2.5 text-sm font-semibold disabled:opacity-50">Start form</button>
            </div>
          </div>
        )}
        {appl === "slot_selected" && (
          <div className="rounded-2xl border border-white/12 bg-white/[0.04] p-6">
            <h2 className="font-display text-xl font-bold">Your slot is booked ✅</h2>
            <p className="mt-2 text-sm text-white/60">Exam: {a.vsat_slot_datetime_1 ? new Date(a.vsat_slot_datetime_1).toLocaleString() : "—"}. The Take-Test button unlocks at your slot time.</p>
            <button disabled className="mt-4 cursor-not-allowed rounded-xl bg-white/10 px-5 py-2.5 text-sm font-semibold text-white/40">🔒 Take test (locked until slot)</button>
          </div>
        )}
        {["vsat_cleared","interview_selected","counselling_done","offer_released","enrolled"].includes(appl) && (
          <div className="rounded-2xl border border-[#22e06a]/30 bg-[#22e06a]/10 p-6">
            <h2 className="font-display text-xl font-bold text-[#22e06a]">Stage: {appl.replace(/_/g, " ")}</h2>
            <p className="mt-2 text-sm text-white/70">You&apos;re progressing through the admissions funnel. Watch your email/WhatsApp for the next step.</p>
          </div>
        )}
        {err && <p className="mt-4 text-xs text-[#ff9db0]">{err}</p>}
      </main>

      {/* RIGHT 25% — quick links (locked until paid) */}
      <aside className="border-white/10 p-6 lg:border-l">
        <p className="text-xs uppercase tracking-wide text-white/40">Quick links</p>
        <div className="mt-4 space-y-3">
          {[
            { label: "📄 Download mock papers" },
            { label: "📝 Start a mock test" },
            { label: "📘 Download brochure" },
            { label: "🎯 VSAT syllabus & pattern" },
          ].map((q) => (
            <button key={q.label} disabled={!paid} className={`block w-full rounded-xl border px-4 py-3 text-left text-sm ${paid ? "border-white/15 bg-white/[0.04] hover:bg-white/[0.08]" : "cursor-not-allowed border-white/8 bg-white/[0.02] text-white/30"}`}>
              {q.label}{!paid && " 🔒"}
            </button>
          ))}
        </div>
        {!paid && <p className="mt-3 text-[11px] text-white/35">Unlocks after you pay the VSAT fee.</p>}
      </aside>
    </div>
  );
}

"use client";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import { track } from "@/lib/analytics/track";
import { VsatFormFill } from "@/components/vsat/vsat-form-fill";
import { VsatExamBlock } from "@/components/vsat/vsat-exam-block";
import { offerPayable, type EnrollApp } from "@/lib/payments/enroll-fee";

const RESULT_STAGES = ["vsat_cleared", "vsat_not_cleared", "interview_selected", "interview_rejected", "counselling_done", "offer_released", "offer_cancelled", "enrolled"];

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
  { key: "paid", label: "VSAT fee paid" },
  { key: "form", label: "Application form" },
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

// ── brand tokens (light, restrained: gradient only on the hero) ──────────────
const HERO_GRAD = "linear-gradient(104deg,#f97d03 0%,#c200db 52%,#8a18ff 100%)";
const card = "rounded-2xl border border-[#e9e4f2] bg-white p-5 shadow-[0_10px_30px_-22px_rgba(43,19,92,0.38)]";
const leadCard = `${card} border-t-[3px] border-t-[#8a18ff]`;
const btn = "inline-flex items-center justify-center gap-2 rounded-xl bg-[#8a18ff] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#7312e0] disabled:opacity-50";
const btnGhost = "inline-flex items-center justify-center gap-2 rounded-xl border border-[#e9e4f2] bg-white px-4 py-2 text-sm font-semibold text-[#1b1030] transition hover:border-[#8a18ff] disabled:opacity-50";
const pillGood = "inline-flex items-center gap-1.5 rounded-md bg-[#eafaf1] px-2.5 py-1 text-xs font-bold text-[#1f9d57]";
const pillOrange = "inline-flex items-center gap-1.5 rounded-md bg-[#fff3e6] px-2.5 py-1 text-xs font-bold text-[#f97d03]";
const iconTint = "grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-[#f2ebfd] text-base";

const firstName = (s: string) => (s || "").trim().split(/\s+/)[0] || "";

export function VsatDashboard({ isAdmin = false }: { isAdmin?: boolean } = {}) {
  const [supabase] = useState(() => createClient());
  const [app, setApp] = useState<App>(null);
  const [lead, setLead] = useState<Lead>(null);
  const [quote, setQuote] = useState<Quote>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const [fillOpen, setFillOpen] = useState(false);
  const [perfAtt, setPerfAtt] = useState(1);
  // Admin-only demo: lets staff skip the real payment to walk the post-pay flow.
  // Not a bypass of the pay screen — the admin still sees "Pay", with a Simulate
  // button below it. Persisted per browser so a refresh keeps them past the gate.
  const [simPaid, setSimPaid] = useState(false);
  useEffect(() => { try { if (isAdmin && localStorage.getItem("vsat_admin_sim_paid") === "1") setSimPaid(true); } catch { /* ignore */ } }, [isAdmin]);
  function simulatePayment() {
    try { localStorage.setItem("vsat_admin_sim_paid", "1"); } catch { /* ignore */ }
    setSimPaid(true);
    setNote("Simulated payment (admin) — the exam/application flow is unlocked. This does not create a real payment.");
  }

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

  // On a Cashfree return, confirm server-side then clean the URL. Two flows:
  //   ?pay=return         -> VSAT fee        (/api/payments/vsat-status)
  //   ?pay=enroll_return  -> enrollment fee  (/api/payments/enroll-status)
  useEffect(() => {
    (async () => {
      const url = new URL(window.location.href);
      const flow = url.searchParams.get("pay");
      if (flow !== "return" && flow !== "enroll_return") { void load(); return; }
      const orderId = url.searchParams.get("order");
      const endpoint = flow === "enroll_return" ? "/api/payments/enroll-status" : "/api/payments/vsat-status";
      const { data: { session } } = await supabase.auth.getSession();
      if (orderId && session) {
        setNote("Confirming your payment…");
        try {
          const res = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accessToken: session.access_token, orderId }) });
          const j = await res.json();
          setNote(j.ok && j.status === "paid" ? "Payment successful 🎉" : j.status === "already_paid" ? "" : "Payment not completed. You can try again.");
        } catch { setNote("Could not confirm payment. Refresh in a moment."); }
      }
      window.history.replaceState({}, "", "/vsat/dashboard");
      void load();
    })();
  }, [supabase, load]);

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

  async function startEnrollment() {
    setBusy(true); setErr("");
    track("vsat_enroll_click");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/payments/enroll-create-order", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accessToken: session?.access_token }) });
      const j = await res.json();
      if (!j.ok) { setBusy(false); return setErr(j.error === "already_enrolled" ? "You're already enrolled." : j.error === "offer_expired" ? "Your offer has expired — please contact the admissions team." : j.error || "Could not start enrollment."); }
      const cashfree = await loadCashfree(j.mode || "sandbox");
      cashfree.checkout({ paymentSessionId: j.paymentSessionId, redirectTarget: "_self" });
    } catch (e) {
      setBusy(false);
      setErr(String((e as Error)?.message || "Enrollment could not start."));
    }
  }

  // live 24h countdown, shown for everyone while the early-bird window is open
  // (hook must run before any early return)
  const countdown = useCountdown(quote?.within24h ? quote?.windowEndsAt ?? null : null);

  const BackBar = (
    <div className="mb-4 flex items-center justify-between">
      <Image src="/vedam-logo.png" alt="Vedam School of Technology" width={200} height={70} className="h-8 w-auto" priority />
      <Link href="/vsat" className="inline-flex items-center gap-2 rounded-[10px] border border-[#e9e4f2] bg-white px-3.5 py-2 text-sm font-semibold text-[#1b1030] transition hover:border-[#8a18ff]">← Back</Link>
    </div>
  );

  if (loading) return <div className="min-h-screen bg-[#f6f4fa]"><div className="mx-auto max-w-[1200px] px-4 py-5">{BackBar}<div className="py-10 text-[#6c6485]">Loading your dashboard…</div></div></div>;
  if (!app) return <div className="min-h-screen bg-[#f6f4fa]"><div className="mx-auto max-w-[1200px] px-4 py-5">{BackBar}<div className="py-10 text-[#1b1030]">No VSAT application found. <a href="/vsat" className="font-semibold text-[#8a18ff] underline">Start one →</a></div></div></div>;

  const a = app as Record<string, string>;
  const ao = app as Record<string, unknown>;
  const l = (lead as Record<string, string>) ?? {};
  const pay = a.payment_stage_1, appl = a.application_stage_1;
  // Admins/staff bypass payment so they can walk the full exam demo without paying.
  const paid = pay === "payment_approved" || (isAdmin && simPaid);
  const idx = activeIndex(app);
  const pct = Math.round((idx / (MILESTONES.length - 1)) * 100);
  const payAmount = quote?.net ?? 1000;
  const showDiscount = !!quote && quote.discount > 0 && quote.within24h && !paid;

  // enrollment / offer gate (same rule as the server's offerPayable)
  const enrollApp: EnrollApp = {
    enrollment_stage: (ao.enrollment_stage as string) ?? null,
    application_stage_1: appl,
    scholarship_percentage: ao.scholarship_percentage != null ? Number(ao.scholarship_percentage) : null,
    offer_released_at: (ao.offer_released_at as string) ?? null,
    offer_expires_at: (ao.offer_expires_at as string) ?? null,
    offer_cancelled: ao.offer_cancelled === true,
  };
  const enrolled = appl === "enrolled" || ao.enrollment_stage === "approved";
  const canEnroll = offerPayable(enrollApp).ok;
  const offerIssued = ao.scholarship_percentage != null && !!ao.offer_released_at;
  const offerActive = offerIssued && ao.offer_cancelled !== true;
  const inExamPhase = paid && !RESULT_STAGES.includes(appl);
  const vps = ao.vps_score != null ? Number(ao.vps_score) : null;
  const hasResults = vps != null || RESULT_STAGES.includes(appl);

  // personalisation
  const name = firstName(l.registered_name || "");
  const appId = l.public_id || a.application_no || a.application_id || "—";
  const campus = l.campus_preference || (a.campus_preference as string) || (a.campus as string) || "";
  const stream = (a.stream as string) || "";

  // quick links — offer letter appears only once an offer is live, drops if cancelled
  const quickLinks: { label: string; icon: string; open: boolean }[] = [
    { label: "Download brochure", icon: "📘", open: true },
    { label: "Mock papers", icon: "📄", open: paid },
    { label: "Start a mock test", icon: "📝", open: paid },
    { label: "Syllabus & pattern", icon: "🎯", open: paid },
  ];
  if (offerActive) quickLinks.push({ label: "Offer letter", icon: "📜", open: true });

  // ── performance rows (attempt 1), student-facing only (raw marks stay admin-only) ──
  const reachedInterview = ["interview_selected", "interview_rejected", "counselling_done", "offer_released", "offer_cancelled", "enrolled"].includes(appl);
  const perfRows: { icon: string; title: string; desc: string; value: ReactNode }[] = [];
  if (hasResults) {
    const vsatCleared = appl !== "vsat_not_cleared";
    perfRows.push({
      icon: "🎯", title: `VSAT · ${vsatCleared ? "cleared" : "not cleared"}`, desc: "VSAT Performance Score",
      value: vps != null ? <span className="tabular-nums">{vps}<small className="text-xs font-semibold text-[#6c6485]">/10</small></span> : <span className="text-[#a79fbd]">—</span>,
    });
    if (reachedInterview) {
      const sel = appl !== "interview_rejected";
      perfRows.push({ icon: "🗣️", title: "Interview", desc: "Admissions panel", value: <span className={sel ? pillGood : "inline-flex items-center rounded-md bg-[#fdeaea] px-2.5 py-1 text-xs font-bold text-[#d14343]"}>{sel ? "Selected" : "Not selected"}</span> });
    }
    if (offerIssued) {
      perfRows.push({ icon: "🎓", title: "Counselling", desc: "Scholarship offered", value: <span className="tabular-nums">{String(ao.scholarship_percentage)}%</span> });
    }
  }

  return (
    <div className="min-h-screen bg-[#f6f4fa] text-[#1b1030]">
      <div className="mx-auto max-w-[1200px] px-4 py-5">
        {BackBar}

        {/* ── personalised hero (the single gradient moment) ── */}
        <section className="relative overflow-hidden rounded-[20px] p-6 text-white" style={{ background: HERO_GRAD }}>
          <div className="flex flex-wrap items-center gap-5">
            <div className="min-w-0 flex-1 basis-80">
              <span className="text-[13px] font-semibold opacity-90">Welcome back,</span>
              <h1 className="font-display text-[clamp(22px,4.2vw,30px)] font-extrabold leading-tight tracking-tight text-balance">
                {name ? `${name}, ` : ""}your VSAT journey is on track.
              </h1>
              <div className="mt-3.5 flex flex-wrap gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-lg border border-white/25 bg-white/[0.15] px-2.5 py-1 text-xs font-semibold"><span className="opacity-75">App ID</span> <span className="tabular-nums">{appId}</span></span>
                {campus && <span className="inline-flex items-center gap-1.5 rounded-lg border border-white/25 bg-white/[0.15] px-2.5 py-1 text-xs font-semibold"><span className="opacity-75">Campus</span> {campus}</span>}
                {stream && <span className="inline-flex items-center gap-1.5 rounded-lg border border-white/25 bg-white/[0.15] px-2.5 py-1 text-xs font-semibold"><span className="opacity-75">Stream</span> {stream}</span>}
              </div>
            </div>
            <div className="relative grid h-[110px] w-[110px] shrink-0 place-items-center">
              <svg viewBox="0 0 120 120" width="110" height="110" className="absolute inset-0 -rotate-90">
                <circle cx="60" cy="60" r="52" fill="none" stroke="rgba(255,255,255,.26)" strokeWidth="10" />
                <circle cx="60" cy="60" r="52" fill="none" stroke="#fff" strokeWidth="10" strokeLinecap="round" strokeDasharray="326.7" strokeDashoffset={326.7 * (1 - pct / 100)} />
              </svg>
              <div className="text-center">
                <div className="font-display text-[25px] font-extrabold leading-none tabular-nums">{pct}%</div>
                <div className="mt-0.5 text-[10px] uppercase tracking-wide opacity-85">Step {idx + 1} / {MILESTONES.length}</div>
              </div>
            </div>
          </div>
        </section>

        <div className="mt-5 grid items-start gap-[18px] lg:grid-cols-[252px_minmax(0,1fr)_252px]">
          {/* LEFT · journey rail */}
          <aside className={card}>
            <p className="text-[11px] font-bold uppercase tracking-[0.13em] text-[#a79fbd]">Your journey</p>
            <p className="mb-4 mt-1 font-display text-sm font-bold tabular-nums">{appId}</p>
            <ol>
              {MILESTONES.map((m, i) => (
                <li key={m.key} className="flex items-start gap-3">
                  <div className="flex flex-col items-center">
                    <span className={`grid h-[25px] w-[25px] place-items-center rounded-full border-[1.5px] font-display text-[11px] font-bold ${i < idx ? "border-[#1f9d57] bg-[#1f9d57] text-white" : i === idx ? "border-[#8a18ff] bg-[#8a18ff] text-white shadow-[0_0_0_4px_#f2ebfd]" : "border-[#e9e4f2] bg-white text-[#a79fbd]"}`}>{i < idx ? "✓" : i + 1}</span>
                    {i < MILESTONES.length - 1 && <span className={`my-[3px] w-0.5 flex-1 ${i < idx ? "bg-[#1f9d57]" : "bg-[#e9e4f2]"}`} style={{ minHeight: 19 }} />}
                  </div>
                  <span className={`pb-3 pt-[3px] text-[13.5px] ${i === idx ? "font-bold text-[#1b1030]" : i < idx ? "text-[#6c6485]" : "text-[#a79fbd]"}`}>
                    {m.label}{i === idx && <small className="mt-0.5 block text-[11.5px] font-semibold text-[#8a18ff]">You&apos;re here</small>}
                  </span>
                </li>
              ))}
            </ol>
          </aside>

          {/* MIDDLE · action box + form-progress / performance slot */}
          <main className="min-w-0">
            {note && <div className="mb-4 rounded-xl border border-[#8a18ff]/25 bg-[#f6f0ff] p-3 text-sm font-medium text-[#7312e0]">{note}</div>}
            {countdown && (
              <div className="mb-4 flex items-center gap-2 rounded-xl border border-[#f3d79a] bg-[#fff6e6] px-3.5 py-2.5 text-[13px] font-semibold text-[#b26a00]">
                ⏳ <span><b className="tabular-nums text-sm">{countdown}</b> left on your early-bird window{showDiscount ? ` — pay now to save ₹${quote?.discount}.` : "."}</span>
              </div>
            )}

            {/* action box */}
            {!paid ? (
              <div className={`${leadCard} mb-4`}>
                <div className="flex flex-wrap items-center justify-between gap-2.5">
                  <h2 className="font-display text-[19px] font-extrabold">Pay your VSAT fee</h2>
                </div>
                <p className="mt-1.5 text-sm text-[#6c6485]">Unlocks your exam slot, mock tests and the application form.</p>
                <div className="mt-3 flex items-baseline gap-2.5">
                  <span className="font-display text-[27px] font-extrabold tabular-nums">₹{payAmount}</span>
                  {showDiscount && <span className="text-base text-[#a79fbd] line-through tabular-nums">₹{quote?.base}</span>}
                  {showDiscount && <span className={pillOrange}>₹{quote?.discount} off</span>}
                </div>
                <button onClick={startPayment} disabled={busy} className={`${btn} mt-4`}>{busy ? "Starting…" : `Pay ₹${payAmount}`}</button>
                {pay === "payment_initiated" && <p className="mt-3 text-xs text-[#b26a00]">Payment initiated — if you didn&apos;t complete it, click Pay to try again.</p>}
                {pay === "payment_failed" && <p className="mt-3 text-xs text-[#d14343]">Last payment failed. You can try again.</p>}
                {isAdmin && (
                  <div className="mt-4 border-t border-dashed border-[#d9d2ef] pt-3">
                    <button onClick={simulatePayment} className="w-full rounded-xl border border-[#8a18ff]/35 bg-[#f6f0ff] px-4 py-2.5 text-sm font-semibold text-[#7312e0] transition hover:bg-[#efe6ff]">⚡ Simulate payment &amp; continue (admin)</button>
                    <p className="mt-1.5 text-[11px] text-[#9a93ad]">Admin-only. Skips the real payment to walk the next screens — no real payment is created.</p>
                  </div>
                )}
              </div>
            ) : inExamPhase ? (
              <div className="mb-4">
                <div className="mb-2 flex items-center justify-between gap-2.5">
                  <h2 className="font-display text-[19px] font-extrabold">Your VSAT exam</h2>
                  <span className={pillGood}>● Fee paid</span>
                </div>
                <VsatExamBlock app={app as Record<string, unknown>} onChange={load} />
              </div>
            ) : enrolled ? (
              <div className={`${card} mb-4 border-[#1f9d57]/30 bg-[#f1fbf5]`}>
                <h2 className="font-display text-[19px] font-extrabold text-[#1f9d57]">You&apos;re enrolled 🎉</h2>
                <p className="mt-2 text-sm text-[#2b135c]/70">Welcome to Vedam! Our team will reach out with your joining details.</p>
              </div>
            ) : canEnroll ? (
              <div className={`${leadCard} mb-4`}>
                <h2 className="font-display text-[19px] font-extrabold">You&apos;re offered admission 🎉</h2>
                <p className="mt-1.5 text-sm text-[#6c6485]">
                  Scholarship <b className="text-[#1b1030]">{String(ao.scholarship_percentage)}%</b>. Block your seat with the enrollment fee.
                  {ao.offer_expires_at ? <> Offer valid till <b className="text-[#1b1030]">{new Date(String(ao.offer_expires_at)).toLocaleString()}</b>.</> : null}
                </p>
                <button onClick={startEnrollment} disabled={busy} className={`${btn} mt-4`}>{busy ? "Starting…" : `Enroll · pay ₹${Number(ao.enrollment_amount ?? 50000)}`}</button>
                {ao.enrollment_stage === "initiated" && <p className="mt-3 text-xs text-[#b26a00]">Enrollment payment initiated — click Enroll to complete it.</p>}
                {ao.enrollment_stage === "failed" && <p className="mt-3 text-xs text-[#d14343]">Last enrollment payment failed. You can try again.</p>}
              </div>
            ) : offerIssued ? (
              <div className={`${card} mb-4 border-[#f3d79a] bg-[#fff6e6]`}>
                <h2 className="font-display text-[19px] font-extrabold text-[#b26a00]">Your offer is no longer active</h2>
                <p className="mt-2 text-sm text-[#b26a00]">The enrollment window for your offer has closed. Please contact the admissions team if you still wish to enroll.</p>
              </div>
            ) : appl === "vsat_not_cleared" || appl === "interview_rejected" ? (
              <div className={`${card} mb-4`}>
                <h2 className="font-display text-[19px] font-extrabold">{appl === "vsat_not_cleared" ? "VSAT result" : "Interview result"}</h2>
                <p className="mt-2 text-sm text-[#6c6485]">Thank you for appearing. You weren&apos;t selected to proceed this time. The admissions team will share details and any next options.</p>
              </div>
            ) : hasResults ? (
              <div className={`${card} mb-4 border-[#1f9d57]/30 bg-[#f1fbf5]`}>
                <h2 className="font-display text-[19px] font-extrabold text-[#1f9d57]">
                  {appl === "vsat_cleared" ? "You've cleared VSAT 🎉" : appl === "interview_selected" ? "Interview cleared 🎉" : appl === "counselling_done" ? "Counselling done" : "Offer released"}
                </h2>
                <p className="mt-2 text-sm text-[#2b135c]/70">You&apos;re progressing through the admissions funnel. Watch your email/WhatsApp for the next step.</p>
              </div>
            ) : null}

            {/* secondary slot: application form in exam phase → performance summary after results */}
            {inExamPhase ? (
              a.form_status === "completed" ? (
                <div className={card}><p className="flex items-center gap-2 text-sm font-semibold text-[#1f9d57]"><span className={pillGood}>✓ Submitted</span> Application form</p></div>
              ) : fillOpen || a.form_status === "in_progress" ? (
                <VsatFormFill onDone={() => { setFillOpen(false); void load(); }} />
              ) : (
                <div className={card}>
                  <div className="flex flex-wrap items-center justify-between gap-2.5">
                    <h3 className="font-display text-[15.5px] font-bold">Application form</h3>
                  </div>
                  <p className="mt-1.5 text-sm text-[#6c6485]">Basic details, academics, parents, documents, consent. Required before you can take VSAT.</p>
                  <button onClick={() => setFillOpen(true)} disabled={busy} className={`${btnGhost} mt-4`}>Start form →</button>
                </div>
              )
            ) : hasResults && perfRows.length > 0 ? (
              <div className={card}>
                <div className="flex flex-wrap items-center justify-between gap-2.5">
                  <h3 className="font-display text-[15.5px] font-bold">Your performance</h3>
                  <div className="inline-flex gap-1.5 rounded-[10px] bg-[#f4f0fa] p-1">
                    {[1, 2].map((n) => (
                      <button key={n} onClick={() => setPerfAtt(n)} className={`rounded-md px-3 py-[5px] font-display text-[12.5px] font-bold transition ${perfAtt === n ? "bg-white text-[#7312e0] shadow-[0_1px_3px_rgba(43,19,92,0.14)]" : "text-[#6c6485]"}`}>Attempt {n}</button>
                    ))}
                  </div>
                </div>
                <div className="mt-3">
                  {perfAtt === 1 ? (
                    <div className="flex flex-col gap-2.5">
                      {perfRows.map((r, i) => (
                        <div key={i} className="flex items-center gap-3 rounded-xl border border-[#e9e4f2] p-3">
                          <span className={iconTint}>{r.icon}</span>
                          <div className="min-w-0 flex-1"><div className="font-display text-[13.5px] font-bold">{r.title}</div><div className="text-xs text-[#6c6485]">{r.desc}</div></div>
                          <div className="font-display text-[15px] font-extrabold">{r.value}</div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-xl border border-dashed border-[#e9e4f2] px-3.5 py-6 text-center text-[13px] text-[#a79fbd]">No second attempt yet. If a re-attempt is granted, Attempt 2 will appear here.</div>
                  )}
                </div>
              </div>
            ) : null}

            {err && <p className="mt-4 text-xs text-[#d14343]">{err}</p>}
          </main>

          {/* RIGHT · quick links */}
          <aside className={card}>
            <p className="text-[11px] font-bold uppercase tracking-[0.13em] text-[#a79fbd]">Quick links</p>
            <div className="mt-3 flex flex-col gap-2.5">
              {quickLinks.map((q) => (
                <button key={q.label} disabled={!q.open} className={`flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left text-[13px] font-semibold transition ${q.open ? "border-[#e9e4f2] bg-white text-[#1b1030] hover:border-[#8a18ff]" : "cursor-not-allowed border-[#e9e4f2] bg-[#f4f0fa] text-[#a79fbd]"}`}>
                  <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg text-sm ${q.open ? "bg-[#f2ebfd]" : "bg-[#f7f4fb]"}`}>{q.icon}</span>
                  <span className="min-w-0 flex-1">{q.label}</span>
                  {!q.open && <span className="text-xs">🔒</span>}
                </button>
              ))}
            </div>
            {!paid && <p className="mt-2.5 text-[11.5px] text-[#a79fbd]">Mock papers, mock test &amp; syllabus unlock after you pay the VSAT fee. The brochure is free.</p>}
            {paid && !offerActive && <p className="mt-2.5 text-[11.5px] text-[#a79fbd]">Your offer letter will appear here once admission is offered.</p>}
          </aside>
        </div>
      </div>
    </div>
  );
}

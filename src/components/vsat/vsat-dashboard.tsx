"use client";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import { track } from "@/lib/analytics/track";
import { VsatFormFill } from "@/components/vsat/vsat-form-fill";
import { VsatExamBlock } from "@/components/vsat/vsat-exam-block";
import { HelpBox } from "@/components/vsat/help-box";
import { InterviewCard } from "@/components/vsat/interview-card";
import { offerPayable, type EnrollApp } from "@/lib/payments/enroll-fee";

const RESULT_STAGES = ["vsat_cleared", "vsat_not_cleared", "interview_selected", "interview_rejected", "counselling_done", "offer_released", "offer_cancelled", "enrolled"];

type App = Record<string, unknown> | null;
type Lead = Record<string, unknown> | null;
type Quote = { base: number; discount: number; net: number; within24h: boolean; windowEndsAt: string | null; couponCode?: string | null; couponDiscount?: number; earlyReg?: boolean; earlyRegDiscount?: number; autoDiscount?: number } | null;

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

// #11: pay + date-selection + form fill run in parallel, so they collapse into one
// "Apply" step; then Give VSAT (flipped by the Wheebox result callback), then the rest.
const MILESTONES = [
  { key: "started", label: "Application started" },
  { key: "apply", label: "Pay · Select date · Fill form" },
  { key: "exam", label: "Give VSAT" },
  { key: "result", label: "VSAT result" },
  { key: "interview", label: "Interview" },
  { key: "counselling", label: "Counselling & offer" },
  { key: "enrolled", label: "Enroll" },
];

// Campus is asked AFTER VSAT is cleared (not in the /vsat form). Same options as the form.
const CAMPUSES = ["Ajeenkya DY Patil University — Pune", "Sushant University — Gurugram", "No preference"];

function activeIndex(appl: string | undefined): number {
  if (appl === "enrolled") return 6;
  if (appl === "offer_released" || appl === "counselling_done" || appl === "offer_cancelled") return 5;
  if (appl === "interview_selected" || appl === "interview_rejected") return 4;
  if (appl === "vsat_cleared" || appl === "vsat_not_cleared") return 3;
  if (appl === "slot_selected") return 2;
  return 1; // applicant → Apply phase (pay / date / form)
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
  const totalH = Math.floor(ms / 3_600_000), d = Math.floor(totalH / 24), h = totalH % 24;
  const m = Math.floor((ms % 3_600_000) / 60_000), s = Math.floor((ms % 60_000) / 1000);
  return `${d > 0 ? `${d}d ` : ""}${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
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
const linkBox = "flex items-center gap-3 rounded-2xl border border-[#e9e4f2] bg-white p-3.5 shadow-[0_10px_30px_-22px_rgba(43,19,92,0.38)] transition hover:border-[#8a18ff]";

const firstName = (s: string) => (s || "").trim().split(/\s+/)[0] || "";

export function VsatDashboard({ isAdmin = false, initialApp = null, initialLead = null }: { isAdmin?: boolean; initialApp?: App; initialLead?: Lead } = {}) {
  const [supabase] = useState(() => createClient());
  const [app, setApp] = useState<App>(initialApp);
  const [lead, setLead] = useState<Lead>(initialLead);
  const [quote, setQuote] = useState<Quote>(null);
  const [coupon, setCoupon] = useState("");
  const [appliedCode, setAppliedCode] = useState<string | undefined>(undefined);
  const [couponMsg, setCouponMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // Prefilled from the server? Then render populated immediately; load() still runs to
  // refresh and fetch the (best-effort) quote, but it no longer blocks first paint.
  const [loading, setLoading] = useState(initialApp === null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const [fillOpen, setFillOpen] = useState(false);
  // When the applicant taps "Continue/Fill the form", the form mounts further down the page —
  // scroll to it so it's clear the form opened (previously it just appeared below the fold).
  const formRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (fillOpen) formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }); }, [fillOpen]);
  const [perfAtt, setPerfAtt] = useState(1);
  // Server says this applicant closed attempt 1 in a terminal-fail state and may re-sit (₹500).
  const [secondEligible, setSecondEligible] = useState(false);
  const [examFlags, setExamFlags] = useState<{ mock: boolean; exam: boolean }>({ mock: false, exam: true });
  const [journeyOpen, setJourneyOpen] = useState(false); // mobile: journey timeline collapsed by default
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
  // Clears the admin simulation (browser-only flag — no DB payment exists) so you drop
  // back to the real unpaid state and can pay for real.
  function resetSimulation() {
    try { localStorage.removeItem("vsat_admin_sim_paid"); } catch { /* ignore */ }
    setSimPaid(false);
    setNote("Simulated payment cleared — back to unpaid. You can now pay for real.");
  }

  const load = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setLoading(false); return; }
    const opts = { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accessToken: session.access_token }) };
    // Fire both calls together — the quote only feeds the early-bird banner / pay amount,
    // so it must not block the main dashboard data. This roughly halves the load wait
    // (noticeable on the form→dashboard hand-off).
    const [meR, qR] = await Promise.allSettled([
      fetch("/api/vsat/me", opts),
      fetch("/api/payments/vsat-quote", opts),
    ]);
    try {
      if (meR.status === "fulfilled") { const j = await meR.value.json(); if (j.ok) { setApp(j.app); setLead(j.lead); setSecondEligible(j.secondAttemptEligible === true); setExamFlags(j.examFlags ?? { mock: false, exam: true }); } }
    } catch { /* ignore */ }
    try {
      if (qR.status === "fulfilled") { const qj = await qR.value.json(); if (qj.ok) setQuote({ base: qj.base, discount: qj.discount, net: qj.net, within24h: qj.within24h, windowEndsAt: qj.windowEndsAt, earlyReg: qj.earlyReg, earlyRegDiscount: qj.earlyRegDiscount, autoDiscount: qj.autoDiscount }); }
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
      window.history.replaceState({}, "", "/apply/dashboard");
      void load();
    })();
  }, [supabase, load]);

  async function startPayment() {
    setBusy(true); setErr("");
    track("vsat_pay_click");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/payments/vsat-create-order", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accessToken: session?.access_token, code: appliedCode }) });
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

  // Second attempt: pay ₹500, then re-sit the VSAT. Eligibility is enforced server-side.
  async function startSecondAttempt() {
    setBusy(true); setErr("");
    track("vsat_pay2_click");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/payments/vsat-second-attempt-order", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accessToken: session?.access_token }) });
      const j = await res.json();
      if (!j.ok) {
        setBusy(false);
        return setErr(j.error === "already_paid" ? "Your second attempt is already paid." : j.error === "not_eligible_for_retry" ? "A second attempt isn't available right now." : j.error === "attempt1_not_paid" ? "Finish your first attempt payment first." : "Could not start payment.");
      }
      const cashfree = await loadCashfree(j.mode || "sandbox");
      cashfree.checkout({ paymentSessionId: j.paymentSessionId, redirectTarget: "_self" });
      // browser now navigates to Cashfree; on return the effect above confirms.
    } catch (e) {
      setBusy(false);
      setErr(String((e as Error)?.message || "Payment could not start."));
    }
  }

  async function applyCoupon() {
    const code = coupon.trim();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    try {
      const q = await fetch("/api/payments/vsat-quote", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accessToken: session.access_token, code }) });
      const qj = await q.json();
      if (!qj.ok) { setCouponMsg({ ok: false, text: "Couldn't check that code." }); return; }
      setQuote({ base: qj.base, discount: qj.discount, net: qj.net, within24h: qj.within24h, windowEndsAt: qj.windowEndsAt, couponCode: qj.coupon?.code ?? null, couponDiscount: qj.couponDiscount, earlyReg: qj.earlyReg, earlyRegDiscount: qj.earlyRegDiscount, autoDiscount: qj.autoDiscount });
      const c = qj.coupon;
      if (!code) { setAppliedCode(undefined); setCouponMsg(null); return; }
      if (c?.accepted) {
        setAppliedCode(c.code);
        setCouponMsg({ ok: true, text: c.extraOff > 0 ? `Coupon applied — ₹${c.extraOff} extra off` : "Valid, but your early-bird discount is already higher." });
      } else {
        setAppliedCode(undefined);
        const map: Record<string, string> = { not_found: "Invalid code.", expired: "This code has expired.", inactive: "This code isn't active.", exhausted: "This code has been fully used.", not_started: "This code isn't active yet." };
        setCouponMsg({ ok: false, text: map[c?.error] || "Invalid code." });
      }
    } catch { setCouponMsg({ ok: false, text: "Couldn't check that code." }); }
  }

  async function downloadApplicationPdf() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    window.open(`/api/vsat/application-pdf?token=${encodeURIComponent(session.access_token)}`, "_blank", "noopener");
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

  // Applicant-side stage save (campus choice post-VSAT-cleared) — /api/vsat/stage
  // whitelists campus_applied; payment fields stay server-only.
  const saveStage = useCallback(async (updates: Record<string, unknown>) => {
    setBusy(true); setErr("");
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch("/api/vsat/stage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accessToken: session?.access_token, updates }) });
    const j = await res.json(); setBusy(false);
    if (!j.ok) return setErr(j.error || "Couldn't save. Try again.");
    await load();
  }, [supabase, load]);

  // live 24h countdown, shown for everyone while the early-bird window is open
  // (hook must run before any early return)
  const countdown = useCountdown(quote?.within24h ? quote?.windowEndsAt ?? null : null);
  // #3 live countdown to the booked exam slot (null until a date is picked / after it passes)
  const examLeft = useCountdown(app ? ((app as Record<string, string>).vsat_slot_datetime_1 || null) : null);

  const BackBar = (
    <div className="mb-4 flex items-center justify-between">
      <Image src="/vedam-logo.png" alt="Vedam School of Technology" width={200} height={70} className="h-8 w-auto" priority />
      <Link href="/apply" className="inline-flex items-center gap-2 rounded-[10px] border border-[#e9e4f2] bg-white px-3.5 py-2 text-sm font-semibold text-[#1b1030] transition hover:border-[#8a18ff]">← Back</Link>
    </div>
  );

  if (loading) return <div className="min-h-screen bg-[#f6f4fa]"><div className="mx-auto max-w-[1200px] px-4 py-5">{BackBar}<div className="py-10 text-[#6c6485]">Loading your dashboard…</div></div></div>;
  if (!app) return <div className="min-h-screen bg-[#f6f4fa]"><div className="mx-auto max-w-[1200px] px-4 py-5">{BackBar}<div className="py-10 text-[#1b1030]">No VSAT application found. <a href="/apply" className="font-semibold text-[#8a18ff] underline">Start one →</a></div></div></div>;

  const a = app as Record<string, string>;
  const ao = app as Record<string, unknown>;
  const l = (lead as Record<string, string>) ?? {};
  const pay = a.payment_stage_1, appl = a.application_stage_1;
  // Admins/staff bypass payment so they can walk the full exam demo without paying.
  const paid = pay === "payment_approved" || (isAdmin && simPaid);
  // #4: the Attempt 1/2 pills (left rail) pick which attempt's journey + results show;
  // the live action panel below always stays on the current attempt.
  const attempt2Unlocked = !!a.payment_stage_2 && a.payment_stage_2 !== "payment_not_initiated";
  const viewAppl = a[`application_stage_${perfAtt}`] || (perfAtt === 1 ? appl : "");
  const idx = activeIndex(viewAppl);
  const pct = Math.round((idx / (MILESTONES.length - 1)) * 100);
  const payAmount = quote?.net ?? 1000;
  const showDiscount = !!quote && quote.discount > 0 && !paid;

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
  const letterLink = "mt-3 inline-block text-sm font-semibold text-[#7312e0] underline underline-offset-2 hover:text-[#8a18ff]";
  const inExamPhase = paid && !RESULT_STAGES.includes(appl);
  const vps = ao.vps_score != null ? Number(ao.vps_score) : null;
  const hasResults = vps != null || RESULT_STAGES.includes(appl);

  // personalisation
  const name = firstName(l.registered_name || "");
  const appId = l.public_id || a.application_no || a.application_id || "—";
  const campus = (a.campus_applied as string) || l.campus_preference || (a.campus_preference as string) || (a.campus as string) || "";
  const stream = (a.stream as string) || "";

  // quick links — offer letter appears only once an offer is live, drops if cancelled.
  // Mock test is "coming soon" (locked for everyone) until the Wheebox callback is live.
  const DOCS = "/vedam-one/docs";
  // brochures served from the public Supabase 'vsat-docs' bucket — one link per campus
  // (campus isn't chosen at signup, so both are offered)
  const SB = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const bHref = (f: string) => (SB ? `${SB}/storage/v1/object/public/vsat-docs/${f}` : undefined);
  const formSubmitted = !!((a.form_data as { _meta?: { submitted?: boolean } } | undefined)?._meta?.submitted);
  const quickLinks: { label: string; icon: string; open: boolean; href?: string; soon?: boolean; onClick?: () => void }[] = [
    // NOTE: the brochure objects in the vsat-docs bucket are stored with a doubled
    // ".pdf.pdf" extension (uploaded manually that way). Point at the real object
    // names so the links resolve. If they're ever re-uploaded with clean names via
    // the admin Documents panel, drop the extra ".pdf" here.
    { label: "Pune campus brochure", icon: "📘", open: true, href: bHref("adypu-pune-brochure.pdf.pdf") },
    { label: "Gurugram campus brochure", icon: "📘", open: true, href: bHref("sushant-gurugram-brochure.pdf.pdf") },
    { label: "Sample papers", icon: "📄", open: paid, href: `${DOCS}/vsat-sample-paper.pdf` },
    { label: "Prep kit", icon: "📚", open: paid, href: `${DOCS}/vsat-prep-kit.pdf` },
    { label: "Mock test", icon: "📝", open: false, soon: true },
  ];
  if (formSubmitted) quickLinks.push({ label: "Application PDF", icon: "🧾", open: true, onClick: downloadApplicationPdf });
  if (offerActive) quickLinks.push({ label: "Offer letter", icon: "📜", open: true });

  // ── performance rows per attempt (student-facing; raw marks stay admin-only) ──
  const buildRows = (att: number) => {
    const applN = att === 1 ? appl : (a[`application_stage_${att}`] || "");
    const vpsRaw = a[`vps_score_${att}`];
    const vpsN = vpsRaw != null && vpsRaw !== "" ? Number(vpsRaw) : att === 1 ? vps : null;
    const schRaw = a[`scholarship_pct_${att}`] ?? (att === 1 ? (ao.scholarship_percentage as string | number | null) : null);
    const has = vpsN != null || RESULT_STAGES.includes(applN);
    const rows: { icon: string; title: string; desc: string; value: ReactNode }[] = [];
    if (!has) return { has, rows };
    rows.push({
      icon: "🎯", title: `VSAT · ${applN === "vsat_not_cleared" ? "not cleared" : "cleared"}`, desc: "VSAT Performance Score",
      value: vpsN != null ? <span className="tabular-nums">{vpsN}<small className="text-xs font-semibold text-[#6c6485]">/10</small></span> : <span className="text-[#a79fbd]">—</span>,
    });
    if (["interview_selected", "interview_rejected", "counselling_done", "offer_released", "offer_cancelled", "enrolled"].includes(applN)) {
      const sel = applN !== "interview_rejected";
      rows.push({ icon: "🗣️", title: "Interview", desc: "Admissions panel", value: <span className={sel ? pillGood : "inline-flex items-center rounded-md bg-[#fdeaea] px-2.5 py-1 text-xs font-bold text-[#d14343]"}>{sel ? "Selected" : "Not selected"}</span> });
    }
    if (schRaw != null && schRaw !== "") rows.push({ icon: "🎓", title: "Counselling", desc: "Scholarship offered", value: <span className="tabular-nums">{String(schRaw)}%</span> });
    return { has, rows };
  };
  const perf = buildRows(perfAtt);

  return (
    <div className="min-h-screen bg-[#f6f4fa] text-[#1b1030]">
      <div className="mx-auto max-w-[1200px] px-4 py-5">
        {BackBar}

        {/* ── personalised hero (the single gradient moment) ── */}
        <section className="relative hidden overflow-hidden rounded-[20px] p-6 text-white lg:block" style={{ background: HERO_GRAD }}>
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

        {/* mobile-only compact progress (variation C) — desktop keeps the gradient hero above */}
        <div className="lg:hidden">
          <div className="rounded-2xl border border-[#e9e4f2] bg-white p-4 shadow-[0_10px_30px_-22px_rgba(43,19,92,0.38)]">
            <h1 className="font-display text-[17px] font-extrabold leading-tight">{name ? `${name}, ` : ""}you&apos;re on track 🎯</h1>
            <p className="mt-1 text-[12.5px] font-semibold tabular-nums text-[#6c6485]">{appId} · Step {idx + 1} of {MILESTONES.length} · {pct}%</p>
            <div className="mt-2.5 h-[7px] w-full overflow-hidden rounded-full bg-[#e8e2f3]"><div className="h-full rounded-full" style={{ width: `${pct}%`, background: HERO_GRAD }} /></div>
          </div>
        </div>

        <div className="mt-5 grid items-start gap-[18px] lg:grid-cols-[252px_minmax(0,1fr)_252px]">
          {/* LEFT · journey rail + quick entries (payments / communications pages) */}
          <div className="order-2 flex flex-col gap-[18px] lg:order-1">
          <aside className={card}>
            <p className="text-[11px] font-bold uppercase tracking-[0.13em] text-[#a79fbd]">Your journey</p>
            <p className="mt-1 font-display text-sm font-bold tabular-nums">{appId}</p>
            <div className="mb-4 mt-3 flex gap-2">
              {(attempt2Unlocked ? [1, 2] : [1]).map((n) => (
                <button key={n} onClick={() => setPerfAtt(n)}
                  className={`rounded-full border px-3 py-1 text-xs font-bold transition ${perfAtt === n ? "border-[#8a18ff] bg-[#8a18ff] text-white" : "border-[#e9e4f2] text-[#6c6485] hover:border-[#8a18ff]"}`}>
                  Attempt {n}
                </button>
              ))}
            </div>
            {/* mobile: collapse the journey to the current step (variation C); desktop shows it all */}
            {!journeyOpen && (
              <div className="lg:hidden">
                <div className="flex items-center gap-3">
                  <span className="grid h-[25px] w-[25px] shrink-0 place-items-center rounded-full border-[1.5px] border-[#8a18ff] bg-[#8a18ff] font-display text-[11px] font-bold text-white shadow-[0_0_0_4px_#f2ebfd]">{idx + 1}</span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#a79fbd]">You&apos;re here · Step {idx + 1} of {MILESTONES.length}</div>
                    <div className="font-display text-[13.5px] font-bold">{MILESTONES[idx].label}</div>
                  </div>
                </div>
                <button onClick={() => setJourneyOpen(true)} className="mt-3 w-full rounded-lg border border-[#e9e4f2] py-2 text-xs font-bold text-[#8a18ff] transition hover:border-[#8a18ff]">View all {MILESTONES.length} steps ⌄</button>
              </div>
            )}
            <ol className={`${journeyOpen ? "block" : "hidden"} lg:block`}>
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
            {journeyOpen && (
              <button onClick={() => setJourneyOpen(false)} className="mt-1 w-full rounded-lg py-1.5 text-xs font-bold text-[#a79fbd] lg:hidden">Show less ⌃</button>
            )}
          </aside>
          <nav className="flex flex-col gap-2.5">
            <Link href="/apply/dashboard/payments" className={linkBox}>
              <span className={iconTint}>🧾</span>
              <span className="min-w-0 flex-1 font-display text-[13.5px] font-bold">My payments</span>
              <span className="text-[#a79fbd]">→</span>
            </Link>
            <Link href="/apply/dashboard/communications" className={linkBox}>
              <span className={iconTint}>✉️</span>
              <span className="min-w-0 flex-1 font-display text-[13.5px] font-bold">My communications</span>
              <span className="text-[#a79fbd]">→</span>
            </Link>
          </nav>
          <HelpBox />
          </div>

          {/* MIDDLE · action box + form-progress / performance slot */}
          <main className="order-1 min-w-0 lg:order-2">
            {isAdmin && simPaid && (
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
                <span>⚡ Admin: a <b>simulated</b> payment is active (not a real payment).</span>
                <button onClick={resetSimulation} className="rounded-lg border border-amber-400 bg-white px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-100">Reset simulation → pay for real</button>
              </div>
            )}
            {note && <div className="mb-4 rounded-xl border border-[#8a18ff]/25 bg-[#f6f0ff] p-3 text-sm font-medium text-[#7312e0]">{note}</div>}
            {countdown && !paid && (
              <div className="mb-4 flex items-center gap-2 rounded-xl border border-[#f3d79a] bg-[#fff6e6] px-3.5 py-2.5 text-[13px] font-semibold text-[#b26a00]">
                ⏳ <span><b className="tabular-nums text-sm">{countdown}</b> left on your early-bird window{showDiscount ? ` — pay now to save ₹${quote?.discount}.` : "."}</span>
              </div>
            )}
            {/* #3 exam countdown — appears once a date is booked and still upcoming */}
            {examLeft && !formSubmitted && (
              <div className="mb-4 rounded-xl border border-[#f3c89a] bg-[#fff6e6] px-3.5 py-3">
                <p className="flex items-start gap-2 text-[13px] font-semibold text-[#b26a00]">
                  ⏱️ <span>Your VSAT is in <b className="tabular-nums text-sm">{examLeft}</b> — finish your application form now, or you can&apos;t sit the test.</span>
                </p>
                <button onClick={() => setFillOpen(true)}
                  className="mt-2.5 inline-flex items-center gap-1 rounded-lg bg-[#b26a00] px-4 py-2 text-[13px] font-bold text-white transition hover:bg-[#8a5200]">
                  {a.form_status === "in_progress" ? "Continue the form" : "Fill the form"} →
                </button>
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
                {quote?.earlyReg && !paid && (
                  <p className="mt-2 flex items-start gap-1.5 rounded-xl border border-[#cdeedd] bg-[#eafaf1] px-3 py-2 text-[13px] font-semibold text-[#1f7a4d]">
                    🎓 <span>
                      {quote.autoDiscount && quote.autoDiscount > 0
                        ? `VSAT early registrant — ₹${quote.autoDiscount} early-bird + ₹${quote.earlyRegDiscount} early-registration = ₹${quote.discount} off`
                        : `VSAT early-registration bonus — ₹${quote.discount} off your form fee`}
                    </span>
                  </p>
                )}
                {/* manual coupon — codes are never shown here; the student types one in if they have it */}
                <div className="mt-3">
                  <div className="flex gap-2">
                    <input value={coupon} onChange={(e) => setCoupon(e.target.value.toUpperCase())} placeholder="Have a coupon code?"
                      className="min-w-0 flex-1 rounded-xl border border-[#e3ddf0] bg-white px-3 py-2 text-sm font-semibold uppercase tracking-wide placeholder:font-normal placeholder:normal-case placeholder:tracking-normal placeholder:text-[#a79fbd] focus:border-[#8a18ff] focus:outline-none" />
                    <button onClick={applyCoupon} type="button" className="shrink-0 rounded-xl border border-[#8a18ff]/35 bg-[#f6f0ff] px-4 py-2 text-sm font-bold text-[#7312e0] transition hover:bg-[#efe6ff]">Apply</button>
                  </div>
                  {couponMsg && <p className={`mt-1.5 text-xs font-semibold ${couponMsg.ok ? "text-[#1f9d57]" : "text-[#d14343]"}`}>{couponMsg.text}</p>}
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
                <VsatExamBlock app={app as Record<string, unknown>} onChange={load} isAdmin={isAdmin} mockEnabled={examFlags.mock} examEnabled={examFlags.exam} />
              </div>
            ) : enrolled ? (
              <div className={`${card} mb-4 border-[#1f9d57]/30 bg-[#f1fbf5]`}>
                <h2 className="font-display text-[19px] font-extrabold text-[#1f9d57]">You&apos;re enrolled 🎉</h2>
                <p className="mt-2 text-sm text-[#2b135c]/70">Welcome to Vedam! Our team will reach out with your joining details.</p>
                {offerActive && <a href="/api/vsat/offer-letter" className={letterLink}>Download your Acceptance Letter (PDF)</a>}
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
                <a href="/api/vsat/offer-letter" className={letterLink}>Download your Acceptance Letter (PDF)</a>
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
            ) : appl === "vsat_cleared" && !campus ? (
              // #1: campus is chosen here (post-VSAT-cleared), not in the /vsat form
              <div className={`${leadCard} mb-4`}>
                <h2 className="font-display text-[19px] font-extrabold">You&apos;ve cleared VSAT 🎉 — choose your campus</h2>
                <p className="mt-1.5 text-sm text-[#6c6485]">Select your preferred campus to move ahead to the interview.</p>
                <div className="mt-4 space-y-2">
                  {CAMPUSES.map((c) => (
                    <button key={c} onClick={() => saveStage({ campus_applied: c })} disabled={busy} className="block w-full rounded-xl border border-[#e9e4f2] bg-white px-4 py-3 text-left text-sm font-semibold transition hover:border-[#8a18ff] disabled:opacity-50">{c}</button>
                  ))}
                </div>
              </div>
            ) : appl === "interview_selected" ? (
              // #1: "Join interview" only clickable once a campus is selected
              <div className={`${leadCard} mb-4`}>
                {/* heading + time + Join button by state; the link opens from 10 minutes before the start until the end (vsat_my_interview) */}
                <InterviewCard campus={campus || null} campuses={CAMPUSES} onPickCampus={(c) => saveStage({ campus_applied: c })} picking={busy} />
              </div>
            ) : hasResults ? (
              <div className={`${card} mb-4 border-[#1f9d57]/30 bg-[#f1fbf5]`}>
                <h2 className="font-display text-[19px] font-extrabold text-[#1f9d57]">
                  {appl === "vsat_cleared" ? "You've cleared VSAT 🎉" : appl === "counselling_done" ? "Counselling done" : "Offer released"}
                </h2>
                <p className="mt-2 text-sm text-[#2b135c]/70">You&apos;re progressing through the admissions funnel. Watch your email/WhatsApp for the next step.</p>
              </div>
            ) : null}

            {/* Second attempt: shown whenever the server says attempt 1 closed in a terminal-fail
                state (VSAT/PI/counselling, not-cleared or no-show) and attempt 2 isn't paid yet. */}
            {secondEligible && (
              <div className={`${card} mb-4 border-[#f3d79a] bg-[#fff6e6]`}>
                <h2 className="font-display text-[19px] font-extrabold text-[#b26a00]">Take VSAT again</h2>
                <p className="mt-2 text-sm text-[#b26a00]">You can take a second attempt — pay a one-time ₹500 fee, pick a new exam date and go through the journey again. Your first attempt stays on record.</p>
                <button onClick={startSecondAttempt} disabled={busy} className={`${btn} mt-4`}>{busy ? "Starting…" : "Start 2nd attempt · pay ₹500"}</button>
                {a.payment_stage_2 === "payment_initiated" && <p className="mt-3 text-xs text-[#b26a00]">Second-attempt payment initiated — click to complete it.</p>}
                {a.payment_stage_2 === "payment_failed" && <p className="mt-3 text-xs text-[#d14343]">Last payment failed. You can try again.</p>}
              </div>
            )}

            {/* secondary slot: application form in exam phase → performance summary after results */}
            {inExamPhase ? (
              a.form_status === "completed" ? (
                <div className={card}><p className="flex items-center gap-2 text-sm font-semibold text-[#1f9d57]"><span className={pillGood}>✓ Submitted</span> Application form</p></div>
              ) : fillOpen || a.form_status === "in_progress" ? (
                <div ref={formRef} style={{ scrollMarginTop: 16 }}><VsatFormFill onDone={() => { setFillOpen(false); void load(); }} /></div>
              ) : (
                <div className={card}>
                  <div className="flex flex-wrap items-center justify-between gap-2.5">
                    <h3 className="font-display text-[15.5px] font-bold">Application form</h3>
                  </div>
                  <p className="mt-1.5 text-sm text-[#6c6485]">Basic details, academics, parents, documents, consent. Required before you can take VSAT.</p>
                  <button onClick={() => setFillOpen(true)} disabled={busy} className={`${btnGhost} mt-4`}>Start form →</button>
                </div>
              )
            ) : hasResults ? (
              <div className={card}>
                <h3 className="font-display text-[15.5px] font-bold">Your performance <span className="font-semibold text-[#a79fbd]">· Attempt {perfAtt}</span></h3>
                <div className="mt-3">
                  {perf.has ? (
                    <div className="flex flex-col gap-2.5">
                      {perf.rows.map((r, i) => (
                        <div key={i} className="flex items-center gap-3 rounded-xl border border-[#e9e4f2] p-3">
                          <span className={iconTint}>{r.icon}</span>
                          <div className="min-w-0 flex-1"><div className="font-display text-[13.5px] font-bold">{r.title}</div><div className="text-xs text-[#6c6485]">{r.desc}</div></div>
                          <div className="font-display text-[15px] font-extrabold">{r.value}</div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-xl border border-dashed border-[#e9e4f2] px-3.5 py-6 text-center text-[13px] text-[#a79fbd]">No Attempt {perfAtt} results yet.{perfAtt === 2 ? " If a re-attempt is granted, it will appear here." : ""}</div>
                  )}
                </div>
              </div>
            ) : null}

            {err && <p className="mt-4 text-xs text-[#d14343]">{err}</p>}
          </main>

          {/* RIGHT · quick links */}
          <aside className={`${card} order-3`}>
            <p className="text-[11px] font-bold uppercase tracking-[0.13em] text-[#a79fbd]">Quick links</p>
            <div className="mt-3 flex flex-col gap-2.5">
              {quickLinks.map((q) => {
                const cls = `flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left text-[13px] font-semibold transition ${q.open ? "border-[#e9e4f2] bg-white text-[#1b1030] hover:border-[#8a18ff]" : "cursor-not-allowed border-[#e9e4f2] bg-[#f4f0fa] text-[#a79fbd]"}`;
                const inner = (
                  <>
                    <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg text-sm ${q.open ? "bg-[#f2ebfd]" : "bg-[#f7f4fb]"}`}>{q.icon}</span>
                    <span className="min-w-0 flex-1">{q.label}</span>
                    {q.soon ? <span className="rounded-md bg-[#f2ebfd] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#8a18ff]">Soon</span> : !q.open && <span className="text-xs">🔒</span>}
                  </>
                );
                if (q.open && q.onClick) return <button key={q.label} onClick={q.onClick} className={cls}>{inner}</button>;
                if (q.open && q.href) return <a key={q.label} href={q.href} target="_blank" rel="noopener" className={cls}>{inner}</a>;
                return <button key={q.label} disabled={!q.open} className={cls}>{inner}</button>;
              })}
            </div>
            {!paid && <p className="mt-2.5 text-[11.5px] text-[#a79fbd]">Sample papers, prep kit &amp; syllabus unlock after you pay the VSAT fee. The brochure is free; the mock test is coming soon.</p>}
            {paid && !offerActive && <p className="mt-2.5 text-[11.5px] text-[#a79fbd]">Your offer letter will appear here once admission is offered.</p>}
          </aside>
        </div>
      </div>
    </div>
  );
}

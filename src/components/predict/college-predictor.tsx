"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useProductGate } from "@/components/funnel/use-product-gate";
import { marksToRank } from "@/lib/cp/marks-to-rank";
import { CP_STATES, CP_CATEGORIES, CP_GENDERS, CP_STREAMS, CP_YEARS, stateNameToId } from "@/lib/cp/options";

type Row = { institute_id: number; institute_name: string; program_name: string; opening_rank: number; closing_rank: number; sub_category: string; round: number };
type Form = { mode: "rank" | "marks"; rank: string; marks: string; category: string; gender: string; stream: string; year: string; stateId: string };
type Grouped = { institute: string; institute_id: number; rows: Row[] };

const blank: Form = { mode: "rank", rank: "", marks: "", category: "OPEN", gender: "Gender Neutral", stream: "PCM", year: "2026", stateId: "" };
let _cpSidFallback = "";
function sid() { try { let s = localStorage.getItem("cp_sid"); if (!s) { s = crypto.randomUUID(); localStorage.setItem("cp_sid", s); } return s; } catch { return (_cpSidFallback ||= (crypto.randomUUID?.() ?? String(Math.random()).slice(2))); } }

/* ---------- exact Figma tokens ---------- */
const SUBMIT_GRAD = "linear-gradient(93.15deg, #7629FC 5.87%, #8A18FF 88.28%)";
/* Clearly-blue gradient (cyan-blue → blue, no violet) for the dark round-wise modal. */
const BLUE_GRAD = "linear-gradient(93.15deg, #0BA5EC 0%, #2E6BFF 100%)";

/* ===================== FORM PAGE (new Figma frame) =====================
   Everything below is measured off the design frame (1920 × ~900) and driven by
   two scale variables so the whole page always lands inside one screen:
     --u  hero scale   --v  form-card scale   (1px === 1px of the design frame)  */

const u = (n: number) => `calc(${n} * var(--u))`;
const v = (n: number) => `calc(${n} * var(--v))`;

/* Two glows, each anchored to a diagonal corner of the hero (bottom-left and
   top-right), so they always land in those corners whatever the viewport height
   and leave the centre clear. Plain stacked gradients (no mix-blend-mode, which
   drops out on some GPUs). Both corners share one ramp for equal intensity. */
const CORNER_RAMP = "radial-gradient(50% 50% at 50% 50%, rgb(134,128,248) 0%, rgb(108,104,216) 18%, rgb(80,82,172) 33%, rgb(53,60,120) 47%, rgb(31,41,80) 59%, rgb(14,24,42) 71%, rgba(0,0,0,0) 83%)";
const HERO_GLOWS: { cls: string; st: React.CSSProperties }[] = [
  { cls: "cp-g1", st: { left: -320, bottom: -320, width: 640, height: 600, background: CORNER_RAMP } },
  { cls: "cp-g2", st: { right: -300, top: -300, width: 640, height: 600, background: CORNER_RAMP } },
];

function HeroGlows() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {HERO_GLOWS.map((g) => <div key={g.cls} className={`absolute ${g.cls}`} style={{ ...g.st, filter: "blur(40px)" }} />)}
    </div>
  );
}

/** Results-page background — two compact blue glows contained to ~12% of the
    screen each: top-right by the gauge, and bottom-left anchored to the content
    so it sits at the table's bottom-left corner. Drifts a touch faster so the
    motion stays visible. It sits behind the content; its "bottom" tracks the
    results container, so on a full table the lower-left glow lands at the
    table's bottom-left corner (the footer is a separate section below). */
function ResultsGlows() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
      <div className="cp-rg1 absolute" style={{ right: -300, top: -320, width: 760, height: 720, filter: "blur(40px)", background: CORNER_RAMP }} />
      <div className="cp-rg2 absolute" style={{ left: -300, bottom: -280, width: 720, height: 800, filter: "blur(40px)", background: CORNER_RAMP }} />
    </div>
  );
}

const SEAL = "M12.00 1.90 A2.95 2.95 0 0 1 17.05 3.25 A2.95 2.95 0 0 1 20.75 6.95 A2.95 2.95 0 0 1 22.10 12.00 A2.95 2.95 0 0 1 20.75 17.05 A2.95 2.95 0 0 1 17.05 20.75 A2.95 2.95 0 0 1 12.00 22.10 A2.95 2.95 0 0 1 6.95 20.75 A2.95 2.95 0 0 1 3.25 17.05 A2.95 2.95 0 0 1 1.90 12.00 A2.95 2.95 0 0 1 3.25 6.95 A2.95 2.95 0 0 1 6.95 3.25 A2.95 2.95 0 0 1 12.00 1.90 Z";

/** Scalloped green seal + white check, as drawn in the design. */
function Tick() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="shrink-0" style={{ width: u(35), height: u(35) }}>
      <path d={SEAL} fill="#18F34F" />
      <path d="m7.6 12.2 2.9 2.9 5.9-5.9" fill="none" stroke="#fff" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Dark gauge card (results page) — thick blue→violet speedometer arc with a
    grey track, vertical tick groups flanking the rank, as in the Figma design. */
function Gauge({ label }: { label: string | number | undefined }) {
  // Keep the rank clear of the flanking ticks: inner ticks sit at x=96 / x=204
  // (108px gap). Any unusually long label auto-condenses to fit that gap.
  const s = String(label ?? "");
  const long = s.replace(/\s/g, "").length > 4;
  return (
    <div className="w-full flex-none rounded-[20px] border-[0.5px] border-[#7629fc] bg-[#101010] px-4 pb-4 pt-5 text-center lg:w-[360px]">
      <h3 className="font-[family-name:var(--font-inter)] text-[16px] font-medium tracking-[-0.04em] text-white sm:text-[17px]">Predicted College on your Rank</h3>
      <svg className="mx-auto mt-1.5 block w-full max-w-[320px]" viewBox="0 0 300 166" aria-hidden>
        <defs><linearGradient id="cp-gauge" x1="0" y1="1" x2="0.9" y2="0"><stop offset="0" stopColor="#4A82E2" /><stop offset="1" stopColor="#7650DF" /></linearGradient></defs>
        <path d="M50 122 A100 100 0 0 1 250 122" fill="none" stroke="#2A2A2A" strokeWidth="20" strokeLinecap="round" />
        <path d="M50 122 A100 100 0 0 1 188.8 27.6" fill="none" stroke="url(#cp-gauge)" strokeWidth="20" strokeLinecap="round" />
        <g stroke="#6a6a6a" strokeWidth="2.4" strokeLinecap="round">
          <line x1="64" y1="120" x2="64" y2="140" /><line x1="76" y1="123" x2="76" y2="139" /><line x1="86" y1="126" x2="86" y2="138" /><line x1="96" y1="128" x2="96" y2="138" />
          <line x1="236" y1="120" x2="236" y2="140" /><line x1="224" y1="123" x2="224" y2="139" /><line x1="214" y1="126" x2="214" y2="138" /><line x1="204" y1="128" x2="204" y2="138" />
        </g>
        <text x="150" y="139" textAnchor="middle" fill="#fff" fontFamily="var(--font-inter), sans-serif" fontWeight="700" fontSize="24" textLength={long ? 104 : undefined} lengthAdjust={long ? "spacingAndGlyphs" : undefined}>{label}</text>
      </svg>
    </div>
  );
}

const FEATURES: { lines: [string, string]; bold?: boolean; bg: string; icon: React.ReactNode }[] = [
  {
    lines: ["Developed", "by Experts"], bg: "linear-gradient(115deg,#24496F 0%,#3E93B4 45%,#BDEBFA 100%)",
    icon: <><path d="M3 3v18h18" /><path d="M7 15l4-5 3 3 5-7" /></>,
  },
  {
    lines: ["College &", "Branch Prediction"], bg: "linear-gradient(135deg,#3F2089 0%,#A782F2 100%)",
    icon: <><circle cx="18" cy="5" r="2.6" /><circle cx="6" cy="12" r="2.6" /><circle cx="18" cy="19" r="2.6" /><path d="M8.3 10.8 15.7 6.4M8.3 13.2l7.4 4.4" /></>,
  },
  {
    lines: ["80,000+", "Users"], bold: true, bg: "linear-gradient(135deg,#55096A 0%,#D47FE4 100%)",
    icon: <><circle cx="9" cy="8" r="3" /><path d="M3 20c0-3 3-5 6-5s6 2 6 5M16 5a3 3 0 0 1 0 6M18 20c0-2-1-3.4-2.5-4.2" /></>,
  },
];

/** "Developed by experts from" — company logo + the brand-coloured wordmark. */
function BuiltBy() {
  return (
    <div className="flex flex-wrap items-center" style={{ marginTop: u(36), columnGap: u(14), rowGap: u(8) }}>
      <span className="font-[family-name:var(--font-inter)] font-light tracking-[-0.02em] text-white/[0.72]" style={{ fontSize: u(16) }}>Developed by experts from</span>
      <span className="inline-flex items-center" style={{ gap: u(8) }}>
        <img src="/cs-logo-google.webp" alt="" style={{ width: u(22), height: u(22), borderRadius: u(5) }} />
        <span style={{ fontFamily: "'Product Sans','Google Sans','Inter',Arial,sans-serif", fontWeight: 600, fontSize: u(19) }}>
          <span style={{ color: "#4285F4" }}>G</span><span style={{ color: "#EA4335" }}>o</span><span style={{ color: "#FBBC05" }}>o</span><span style={{ color: "#4285F4" }}>g</span><span style={{ color: "#34A853" }}>l</span><span style={{ color: "#EA4335" }}>e</span>
        </span>
      </span>
      <span className="inline-flex items-center" style={{ gap: u(8) }}>
        <img src="/cs-logo-microsoft.webp" alt="" style={{ width: u(22), height: u(22), borderRadius: u(5) }} />
        <span style={{ fontFamily: "'Segoe UI',system-ui,sans-serif", fontWeight: 600, color: "#E9E9EF", fontSize: u(19) }}>Microsoft</span>
      </span>
    </div>
  );
}

export function CollegePredictor() {
  const [supabase] = useState(() => createClient());
  const [f, setF] = useState<Form>(blank);
  const [authed, setAuthed] = useState(false);
  const [results, setResults] = useState<Grouped[] | null>(null);
  const [rankRange, setRankRange] = useState<[number, number] | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [modal, setModal] = useState<{ name: string; program: string; rounds: { round: number; opening_rank: number; closing_rank: number }[] } | null>(null);

  const set = (patch: Partial<Form>) => setF((x) => ({ ...x, ...patch }));
  const { gate, Modals } = useProductGate();
  const log = (event: string, payload: Record<string, unknown> = {}) => { try { supabase.rpc("log_cp_event", { p_event: event, p_session: sid(), p_payload: payload }); } catch { /* */ } };

  async function runPrediction(form: Form, resumed = false) {
    setErr(null);
    const hasInput = form.mode === "rank" ? !!form.rank : !!form.marks;
    if (!hasInput || !form.stateId || !form.category || !form.gender) { setErr("Please fill your rank/marks, category, seat pool and domicile state."); return; }
    const { rank, range } = form.mode === "marks"
      ? (() => { const m = marksToRank(parseFloat(form.marks)); return { rank: m.rank, range: [m.minRank, m.maxRank] as [number, number] }; })()
      : (() => { const r = parseInt(form.rank); return { rank: r, range: [r, r] as [number, number] }; })();
    if (!rank || rank < 1) { setErr("Enter a valid rank or marks."); return; }
    setLoading(true);
    const { data, error } = await supabase.rpc("predict_colleges", { p_rank: rank, p_gender: form.gender, p_category: form.category, p_state_id: parseInt(form.stateId) });
    setLoading(false);
    if (error) { setErr("Something went wrong. Please try again."); return; }
    const rows = (data as Row[]) ?? [];
    const order: string[] = []; const map: Record<string, Grouped> = {};
    for (const r of rows) { if (!map[r.institute_name]) { map[r.institute_name] = { institute: r.institute_name, institute_id: r.institute_id, rows: [] }; order.push(r.institute_name); } map[r.institute_name].rows.push(r); }
    setResults(order.map((n) => map[n])); setRankRange(range);
    log(resumed ? "results_shown_after_signup" : "results_shown", { rank, count: rows.length });
    try { await supabase.rpc("save_cp_prediction", { p_rank: rank, p_marks: form.mode === "marks" ? parseFloat(form.marks) : null, p_category: form.category, p_gender: form.gender, p_stream: form.stream, p_state_id: parseInt(form.stateId), p_year: form.year, p_count: rows.length }); } catch { /* */ }
  }

  useEffect(() => {
    (async () => {
      log("viewed");
      const { data: { session } } = await supabase.auth.getSession();
      const isAuth = !!session?.user; setAuthed(isAuth);
      if (isAuth) {
        const { data: p } = await supabase.from("profiles").select("state").eq("id", session!.user.id).maybeSingle();
        const sidState = stateNameToId(p?.state); if (sidState) setF((x) => ({ ...x, stateId: String(sidState) }));
        try {
          const pend = localStorage.getItem("cp_pending");
          if (pend) { const pf = JSON.parse(pend) as Form; setF(pf); localStorage.removeItem("cp_pending"); setTimeout(() => runPrediction(pf, true), 60); }
        } catch { /* storage blocked or bad json - skip resume */ }
      }
    })();
    // eslint-disable-next-line
  }, []);

  async function onPredict() {
    const hasInput = f.mode === "rank" ? !!f.rank : !!f.marks;
    if (!hasInput || !f.stateId || !f.category || !f.gender) { setErr("Please fill your rank/marks, category, seat pool and domicile state."); return; }
    log("predict_clicked", { mode: f.mode, category: f.category, gender: f.gender, stateId: f.stateId });
    try { localStorage.setItem("cp_pending", JSON.stringify(f)); } catch { /* storage blocked - resume-after-auth skipped */ }   // so the prediction runs on return
    gate({ kind: "predict" }, () => runPrediction(f), "Create your free account to see your predicted colleges.");
  }

  async function openRounds(g: Grouped, r: Row) {
    const { data } = await supabase.rpc("predict_rounds", { p_institute_id: g.institute_id, p_program: r.program_name, p_category: f.category, p_gender: f.gender });
    setModal({ name: g.institute, program: r.program_name, rounds: (data as { round: number; opening_rank: number; closing_rank: number }[]) ?? [] });
  }

  function share() {
    // UTM-tagged link. Single-word values (no spaces/underscores) so the shared
    // URL has no "+" / %20 and reads as a clean link.
    const url = "https://one.vedam.org/predict?utm_source=CollegePredictor&utm_medium=WhatsApp&utm_campaign=CPResults";
    const text = `🎓 Predict your JEE Main 2026 college & branch for FREE with Vedam's College Predictor — ${url}`;
    try { navigator.clipboard.writeText(url); } catch { /* */ }
    log("share_whatsapp");
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
  }

  const inter = "font-[family-name:var(--font-inter)]";
  const fieldCls = `${inter} w-full bg-[#F2F2F2] text-black outline-none placeholder:text-[#BFBFBF] focus:ring-2 focus:ring-[#7629FC]/40`;
  const fieldSt: React.CSSProperties = { height: v(42), borderRadius: v(7), padding: `0 ${v(14)}`, fontSize: v(17), letterSpacing: "-0.02em" };
  const labelCls = `${inter} block font-semibold text-black`;
  const labelSt: React.CSSProperties = { fontSize: v(20), lineHeight: v(24), letterSpacing: "-0.045em", marginBottom: v(10) };
  // dark results table cells
  const thd = `${inter} whitespace-nowrap border-b border-r border-white/[0.12] px-[18px] py-3.5 text-left text-[15px] font-normal tracking-[-0.03em] text-white last:border-r-0 lg:text-[16px]`;
  const tdd = `${inter} border-b border-r border-white/[0.08] px-[18px] py-3 align-middle text-[13px] tracking-[-0.02em] text-[#eaeaf2] last:border-r-0 lg:text-[14px]`;
  const rankLabel = rankRange && rankRange[0] !== rankRange[1] ? `${rankRange[0]} – ${rankRange[1]}` : rankRange?.[0];

  return (
    <>
      {!results ? (
        /* ================= FORM PAGE (Figma frame 1) ================= */
        <div className={`cp-hero relative isolate overflow-hidden bg-black ${inter} lg:min-h-[calc(100dvh-76px)]`}>
          <HeroGlows />
          <div className="relative flex flex-col gap-10 px-6 pb-14 pt-8 lg:h-full lg:flex-row lg:items-start lg:gap-10 lg:px-0 lg:pb-14 lg:pl-[clamp(32px,6.25vw,120px)] lg:pr-[clamp(32px,8.7vw,167px)] lg:pt-[calc(40*var(--u))]">
            {/* ---- left: hero ---- */}
            <div className="lg:flex-1" style={{ paddingTop: u(39) }}>
              <p className="font-light text-white" style={{ fontSize: u(20), lineHeight: 1, letterSpacing: "-0.012em" }}>Most Accurate</p>
              <h1 style={{ marginTop: u(7) }}>
                <span className="block font-semibold text-white" style={{ fontSize: u(80), lineHeight: u(90), letterSpacing: "-0.068em" }}>JEE MAIN</span>
                <span className="block font-[family-name:var(--font-playfair)] italic text-white" style={{ fontWeight: 500, fontSize: u(80), lineHeight: u(90), letterSpacing: "-0.029em" }}>College Predictor</span>
              </h1>

              <ul className="flex flex-col" style={{ marginTop: u(83), gap: u(17) }}>
                {["Predict your college & branch from your JEE Main 2026 rank", "No hidden charges 100% Free"].map((t) => (
                  <li key={t} className="flex items-center" style={{ gap: u(23), minHeight: u(35) }}>
                    <Tick />
                    <span style={{ fontSize: u(24), lineHeight: 1.15, letterSpacing: "-0.034em", color: "#18F34F" }}>{t}</span>
                  </li>
                ))}
              </ul>

              <BuiltBy />

              <div className="flex flex-wrap" style={{ marginTop: u(64), gap: u(25) }}>
                {FEATURES.map((p) => (
                  <div key={p.lines[0]} className="flex items-center border border-white/[0.22] backdrop-blur-[6px]"
                    style={{ gap: u(11), height: u(94), padding: `0 ${u(26)} 0 ${u(17)}`, borderRadius: u(14), background: "rgba(255,255,255,0.045)" }}>
                    <span className="grid shrink-0 place-items-center rounded-full" style={{ width: u(42), height: u(42), background: p.bg }}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: u(21), height: u(21) }}>{p.icon}</svg>
                    </span>
                    <span className="text-white" style={{ fontSize: u(22), lineHeight: u(28), letterSpacing: "-0.02em" }}>
                      <span className="block" style={p.bold ? { fontWeight: 700, fontSize: u(26) } : undefined}>{p.lines[0]}</span>
                      <span className="block">{p.lines[1]}</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* ---- right: form card ---- */}
            <div className="w-full bg-white shadow-[0_40px_120px_-40px_rgba(80,90,200,0.55)] lg:w-[clamp(400px,30.5vw,585px)] lg:flex-none"
              style={{ borderRadius: v(20), padding: `${v(25)} ${v(32)} ${v(32)}` }}>
              <h2 className="font-bold text-black" style={{ fontSize: v(36), lineHeight: 1, letterSpacing: "-0.025em" }}>Enter your details</h2>

              <div style={{ marginTop: v(35) }}>
                <div className="flex items-end justify-between" style={{ gap: v(12), marginBottom: v(10) }}>
                  <label className={labelCls} style={{ ...labelSt, marginBottom: 0 }}>{f.mode === "rank" ? "JEE Main Rank" : "JEE Main Marks (0–300)"}</label>
                  <div className="inline-flex shrink-0 rounded-full bg-[#F2F2F2]" style={{ padding: v(4) }}>
                    {(["rank", "marks"] as const).map((m) => (
                      <button key={m} onClick={() => set({ mode: m })}
                        className={["rounded-full font-bold capitalize transition", f.mode === m ? "text-white" : "text-[#8a8a8a] hover:text-[#5a5a5a]"].join(" ")}
                        style={{ padding: `${v(6)} ${v(16)}`, fontSize: v(14), ...(f.mode === m ? { background: SUBMIT_GRAD } : {}) }}>{m}</button>
                    ))}
                  </div>
                </div>
                {f.mode === "rank"
                  ? <input value={f.rank} onChange={(e) => set({ rank: e.target.value.replace(/\D/g, "") })} inputMode="numeric" placeholder="Enter Rank" className={fieldCls} style={fieldSt} />
                  : <input value={f.marks} onChange={(e) => set({ marks: e.target.value.replace(/[^\d.]/g, "") })} inputMode="decimal" placeholder="Enter Marks" className={fieldCls} style={fieldSt} />}
              </div>

              <div style={{ marginTop: v(26) }}>
                <label className={labelCls} style={labelSt}>Seat Pool</label>
                <select value={f.gender} onChange={(e) => set({ gender: e.target.value })} className={fieldCls} style={fieldSt}>{CP_GENDERS.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}</select>
              </div>
              <div style={{ marginTop: v(26) }}>
                <label className={labelCls} style={labelSt}>Category</label>
                <select value={f.category} onChange={(e) => set({ category: e.target.value })} className={fieldCls} style={fieldSt}>{CP_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}</select>
              </div>
              <div style={{ marginTop: v(26) }}>
                <label className={labelCls} style={labelSt}>12th Passout Year</label>
                <select value={f.year} onChange={(e) => set({ year: e.target.value })} className={fieldCls} style={fieldSt}>{CP_YEARS.map((y) => <option key={y} value={y}>{y}</option>)}</select>
              </div>
              <div style={{ marginTop: v(26) }}>
                <label className={labelCls} style={labelSt}>Preferred Stream</label>
                <select value={f.stream} onChange={(e) => set({ stream: e.target.value })} className={fieldCls} style={fieldSt}>{CP_STREAMS.map((s) => <option key={s} value={s}>{s}</option>)}</select>
              </div>
              <div style={{ marginTop: v(26) }}>
                <label className={labelCls} style={labelSt}>Domicile State</label>
                <select value={f.stateId} onChange={(e) => set({ stateId: e.target.value })} className={fieldCls} style={fieldSt}>
                  <option value="">Select State…</option>
                  {CP_STATES.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>

              <button onClick={onPredict} disabled={loading}
                className="flex w-full items-center justify-center font-medium text-white transition hover:opacity-95 disabled:opacity-60"
                style={{ marginTop: v(20), height: v(42), borderRadius: v(7), background: SUBMIT_GRAD, fontSize: v(20), letterSpacing: "-0.02em", gap: v(8) }}>
                {loading ? "Predicting…" : <>Submit <span aria-hidden>→</span></>}
              </button>
              {err
                ? <p className="font-medium text-[#d1004b]" style={{ marginTop: v(8), fontSize: v(13) }}>{err}</p>
                : !authed && <p className="text-center text-[#8a8a8a]" style={{ marginTop: v(8), fontSize: v(12) }}>You&apos;ll create a free account to view your predicted colleges.</p>}
            </div>
          </div>
        </div>
      ) : (
        /* ================= RESULTS PAGE (Figma frame 2 — dark) ================= */
        <div className={`relative isolate min-h-screen overflow-hidden bg-black ${inter}`}>
          <ResultsGlows />
          <div className="relative z-10 mx-auto max-w-[1766px] px-6 pb-16 pt-10 sm:px-10 lg:px-[60px]">
            {/* ---- header: title + meta + new-search (left); share pill + gauge (right) ---- */}
            <div className="flex flex-col gap-8 lg:flex-row lg:items-start lg:justify-between lg:gap-10">
              <div className="min-w-0">
                <h1 className="font-semibold tracking-[-0.04em] text-white text-[34px] leading-[1] sm:text-[44px] lg:text-[56px]">
                  College <span className="font-[family-name:var(--font-playfair)] italic">Predictor</span>
                </h1>
                <p className="mt-5 text-[16px] font-normal tracking-[-0.03em] text-[#cfcfe0] sm:text-[18px]">Category : <span className="font-semibold text-white">{f.category}</span></p>
                <p className="mt-2.5 text-[16px] font-normal tracking-[-0.03em] text-[#cfcfe0] sm:text-[18px]">JEE Main 2026 Rank : <span className="font-semibold text-white">{rankLabel}</span></p>
                <button onClick={() => { setResults(null); setErr(null); }} className="mt-5 flex items-center gap-2 text-[15px] font-semibold text-[#C9BDF2] transition hover:text-white">← New search</button>
                <p className="mt-3 text-[13px] font-medium text-white/50">{results.reduce((a, g) => a + g.rows.length, 0)} programs · {results.length} institutes</p>
              </div>

              <div className="flex flex-col items-start gap-6 sm:flex-row sm:items-center lg:gap-[26px]">
                <button onClick={share} className="inline-flex flex-none items-center gap-2.5 whitespace-nowrap rounded-[30px] border border-white bg-[#34c759] py-[7px] pl-4 pr-2 text-[16px] font-medium tracking-[-0.03em] text-white shadow-[0_4px_4px_rgba(0,0,0,0.25)] transition hover:brightness-110 sm:text-[17px]">
                  Share this FREE Predictor Tool
                  <svg viewBox="0 0 24 24" className="h-[27px] w-[27px] flex-none" fill="#fff"><path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.76.46 3.45 1.32 4.95L2 22l5.25-1.38c1.45.79 3.08 1.21 4.79 1.21 5.46 0 9.91-4.45 9.91-9.91C21.95 6.45 17.5 2 12.04 2zm5.8 14.03c-.24.68-1.4 1.3-1.93 1.38-.49.07-1.12.1-1.8-.11-.42-.13-.95-.31-1.63-.6-2.87-1.24-4.75-4.13-4.89-4.32-.14-.19-1.17-1.55-1.17-2.96 0-1.41.74-2.1 1-2.39.26-.29.57-.36.76-.36.19 0 .38 0 .55.01.18.01.41-.07.64.49.24.56.82 1.94.89 2.08.07.14.12.31.02.5-.09.19-.14.31-.28.48-.14.17-.3.37-.42.5-.14.14-.29.29-.12.57.17.28.74 1.22 1.59 1.98 1.1.98 2.02 1.28 2.3 1.42.28.14.45.12.61-.07.17-.19.71-.83.9-1.11.19-.29.38-.24.64-.14.26.09 1.64.77 1.92.91.28.14.47.21.54.33.07.11.07.68-.17 1.36z" /></svg>
                </button>
                <Gauge label={rankLabel} />
              </div>
            </div>

            {/* ---- dark results table ---- */}
            {results.length === 0 ? (
              <div className="mt-9 rounded-[15px] border border-dashed border-white/20 p-12 text-center">
                <p className="text-[22px] font-semibold text-white">No matches for this rank</p>
                <p className="mt-2 text-[15px] text-white/60">Try a different rank, category or seat pool.</p>
              </div>
            ) : (
              <div className="mt-8 overflow-hidden rounded-[15px] border-[0.5px] border-[#00cfe5] bg-black">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[820px] table-fixed border-collapse">
                    <colgroup>
                      <col className="w-[17%]" /><col className="w-[33%]" /><col className="w-[13%]" /><col className="w-[13%]" /><col className="w-[9%]" /><col className="w-[15%]" />
                    </colgroup>
                    <thead>
                      <tr>
                        <th className={thd}>Institute</th>
                        <th className={thd}>Program</th>
                        <th className={`${thd} text-right`}>Opening Rank</th>
                        <th className={`${thd} text-right`}>Closing Rank</th>
                        <th className={`${thd} text-center`}>Quota</th>
                        <th className={thd} />
                      </tr>
                    </thead>
                    <tbody>
                      {results.flatMap((g) => g.rows.map((r, i) => (
                        <tr key={`${g.institute}-${i}`} className="transition hover:bg-white/[0.03]">
                          <td className={`${tdd} bg-[#0a0a0a] font-semibold text-white`}>{i === 0 ? g.institute : ""}</td>
                          <td className={tdd}>{r.program_name}</td>
                          <td className={`${tdd} text-right tabular-nums`}>{r.opening_rank}</td>
                          <td className={`${tdd} text-right font-bold tabular-nums text-white`}>{r.closing_rank}</td>
                          <td className={`${tdd} text-center`}>
                            <span className="inline-block rounded-full border border-[#7629fc]/50 bg-[#7629fc]/[0.18] px-2.5 py-0.5 text-[11px] font-bold text-[#b79cff]">{r.sub_category}</span>
                          </td>
                          <td className={`${tdd} text-right`}>
                            <button onClick={() => openRounds(g, r)} className="whitespace-nowrap bg-gradient-to-r from-[#00cfe5] to-[#c200db] bg-clip-text text-[14px] tracking-[-0.03em] text-transparent transition hover:opacity-80">Round wise details</button>
                          </td>
                        </tr>
                      )))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {modal && (
        <div onClick={() => setModal(null)} className="fixed inset-0 z-50 grid place-items-center bg-[rgba(10,5,25,.7)] p-4 backdrop-blur-sm">
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-lg rounded-[20px] border-[0.5px] border-[#7629fc]/60 bg-[#101010] p-6">
            <div className={`${inter} mb-1 text-[13px] font-semibold uppercase tracking-wide text-[#b79cff]`}>{modal.name}</div>
            <div className={`${inter} text-[19px] font-bold tracking-[-0.03em] text-white`}>{modal.program}</div>
            <div className="mt-5 overflow-hidden rounded-xl border border-white/10">
              <div className={`${inter} grid grid-cols-3 px-4 py-2.5 text-[11px] font-bold uppercase tracking-wide text-white`} style={{ background: BLUE_GRAD }}>
                <span>Round</span><span className="text-right">Opening</span><span className="text-right">Closing</span>
              </div>
              {modal.rounds.length === 0 ? (
                <div className={`${inter} px-4 py-6 text-center text-[14px] text-white/50`}>No round-wise data for this program.</div>
              ) : modal.rounds.map((r, i) => (
                <div key={i} className={`${inter} grid grid-cols-3 items-center border-t border-white/[0.08] px-4 py-2.5 text-[14px] odd:bg-white/[0.03]`}>
                  <span className="font-semibold text-white">Round {r.round}</span>
                  <span className="text-right tabular-nums text-[#cfcfe0]">{r.opening_rank}</span>
                  <span className="text-right font-bold tabular-nums text-white">{r.closing_rank}</span>
                </div>
              ))}
            </div>
            <button onClick={() => setModal(null)} className={`${inter} mt-5 w-full rounded-md py-2.5 text-[15px] font-bold text-white`} style={{ background: BLUE_GRAD }}>Close</button>
          </div>
        </div>
      )}
      <Modals />
    </>
  );
}

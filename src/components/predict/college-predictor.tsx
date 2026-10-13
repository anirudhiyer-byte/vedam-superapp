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
function sid() { let s = localStorage.getItem("cp_sid"); if (!s) { s = crypto.randomUUID(); localStorage.setItem("cp_sid", s); } return s; }

/* ---------- exact Figma tokens ---------- */
const GLOW_B = "radial-gradient(50% 50% at 50% 50%, rgba(194,0,219,0.7) 0%, rgba(118,41,252,0) 72.6%)";
const GLOW_C = "radial-gradient(50% 50% at 50% 50%, #C200DB 0%, rgba(138,24,255,0) 72.6%)";
const SUBMIT_GRAD = "linear-gradient(93.15deg, #7629FC 5.87%, #8A18FF 88.28%)";
const BAND_GRAD = "linear-gradient(81.25deg, #00CFE5 -2.23%, #5E29FC 39.52%, #7629FC 80.82%)";
const GAUGE_GRAD = "linear-gradient(133.19deg, #00CFE5 -4.9%, #C200DB 96.23%)";
const BLUR = "blur(7.08387px)";

/**
 * Figma background ellipses, reproduced 1:1 (size / offset / opacity / blur /
 * transform matrix) inside a 1920-wide reference box that stays centred, so the
 * composition matches the frame on desktop and scales gracefully below it.
 */
function Glows() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute left-1/2 top-0 h-full w-[1920px] -translate-x-1/2">
        {/* Ellipse 35 */}
        <div className="absolute" style={{ width: 2928.71, height: 1191.35, left: -35, top: -332, background: GLOW_C, opacity: 0.7, filter: BLUR, transform: "matrix(0.83, -0.55, 0.27, 0.96, 0, 0)" }} />
        {/* Ellipse 37 */}
        <div className="absolute" style={{ width: 3431.75, height: 1518.91, left: -2579, top: -23, background: GLOW_B, opacity: 0.7, filter: BLUR, transform: "matrix(-0.92, -0.4, 0.66, -0.75, 0, 0)" }} />
      </div>
    </div>
  );
}

/* ===================== FORM PAGE (new Figma frame) =====================
   Everything below is measured off the design frame (1920 × ~900) and driven by
   two scale variables so the whole page always lands inside one screen:
     --u  hero scale   --v  form-card scale   (1px === 1px of the design frame)  */

const u = (n: number) => `calc(${n} * var(--u))`;
const v = (n: number) => `calc(${n} * var(--v))`;

/* Background glows, matched to the design frame. Every stop is sampled off the
   frame, so the layers stack with plain compositing — no mix-blend-mode, which
   silently drops out on some GPUs and left the page flat black. Tops are in
   section space (design y − 76px of sticky header). */
const HERO_GLOWS: { cls: string; st: React.CSSProperties }[] = [
  {
    cls: "cp-g1",
    st: {
      left: -780, top: 330, width: 1680, height: 1460,
      background: "radial-gradient(50% 50% at 50% 50%, rgb(96,92,214) 0%, rgb(78,78,172) 20%, rgb(57,61,132) 34%, rgb(34,43,86) 48%, rgb(18,28,51) 58%, rgb(7,16,26) 68%, rgba(0,0,0,0) 78%)",
    },
  },
  {
    cls: "cp-g2",
    st: {
      left: 1500, top: -640, width: 1020, height: 1620,
      background: "radial-gradient(50% 50% at 50% 50%, rgb(84,98,200) 0%, rgb(64,78,158) 16%, rgb(42,56,111) 32%, rgb(27,43,76) 47%, rgb(14,30,49) 62%, rgb(4,14,22) 77%, rgba(0,0,0,0) 90%)",
    },
  },
  {
    cls: "cp-g3",
    st: {
      left: 1010, top: -196, width: 280, height: 840,
      background: "radial-gradient(50% 50% at 50% 50%, rgb(6,16,25) 0%, rgb(3,10,14) 48%, rgba(0,0,0,0) 80%)",
    },
  },
];

function HeroGlows() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute left-1/2 top-0 h-full w-[1920px] -translate-x-1/2">
        {HERO_GLOWS.map((g) => <div key={g.cls} className={`absolute ${g.cls}`} style={{ ...g.st, filter: "blur(40px)" }} />)}
      </div>
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

/** Figma gauge ticks (Line 213–219): tallest nearest the centre, shrinking outwards. */
function Ticks({ flip }: { flip?: boolean }) {
  const hs = [48, 43, 37, 34, 27, 21];
  return (
    <div aria-hidden className={["flex items-center gap-[9px]", flip ? "flex-row-reverse" : ""].join(" ")}>
      {hs.map((h, i) => <span key={i} className="w-px shrink-0 bg-[#686868]" style={{ height: h }} />)}
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
  const [copied, setCopied] = useState(false);
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
        const pend = localStorage.getItem("cp_pending");
        if (pend) { try { const pf = JSON.parse(pend) as Form; setF(pf); localStorage.removeItem("cp_pending"); setTimeout(() => runPrediction(pf, true), 60); } catch { /* */ } }
      }
    })();
    // eslint-disable-next-line
  }, []);

  async function onPredict() {
    const hasInput = f.mode === "rank" ? !!f.rank : !!f.marks;
    if (!hasInput || !f.stateId || !f.category || !f.gender) { setErr("Please fill your rank/marks, category, seat pool and domicile state."); return; }
    log("predict_clicked", { mode: f.mode, category: f.category, gender: f.gender, stateId: f.stateId });
    localStorage.setItem("cp_pending", JSON.stringify(f));   // so the prediction runs on return
    gate({ kind: "predict" }, () => runPrediction(f), "Create your free account to see your predicted colleges.");
  }

  async function openRounds(g: Grouped, r: Row) {
    const { data } = await supabase.rpc("predict_rounds", { p_institute_id: g.institute_id, p_program: r.program_name, p_category: f.category, p_gender: f.gender });
    setModal({ name: g.institute, program: r.program_name, rounds: (data as { round: number; opening_rank: number; closing_rank: number }[]) ?? [] });
  }

  function share() {
    try {
      navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* */ }
  }

  const inter = "font-[family-name:var(--font-inter)]";
  const fieldCls = `${inter} w-full bg-[#F2F2F2] text-black outline-none placeholder:text-[#BFBFBF] focus:ring-2 focus:ring-[#7629FC]/40`;
  const fieldSt: React.CSSProperties = { height: v(42), borderRadius: v(7), padding: `0 ${v(14)}`, fontSize: v(17), letterSpacing: "-0.02em" };
  const labelCls = `${inter} block font-semibold text-black`;
  const labelSt: React.CSSProperties = { fontSize: v(20), lineHeight: v(24), letterSpacing: "-0.045em", marginBottom: v(10) };
  const th = `${inter} whitespace-nowrap border-r border-[#DDDDDD] px-5 py-4 text-left text-[16px] font-normal tracking-[-0.04em] text-[#7629FC] last:border-r-0 lg:text-[22px]`;
  const td = `${inter} border-r border-[#DDDDDD] px-5 py-4 align-middle text-[14px] tracking-[-0.02em] text-[#1a1a1a] last:border-r-0 lg:text-[15px]`;
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
        /* ================= RESULTS PAGE (Figma frame 2) ================= */
        <div className="relative isolate">
          {/* top band: #1E1E1E + glows + title */}
          <section className="relative overflow-hidden bg-[#1E1E1E]">
            <Glows />
            <div className="relative mx-auto flex max-w-[1280px] flex-wrap items-end justify-between gap-6 px-6 pb-8 pt-12 sm:px-10">
              <h1 className={`${inter} font-semibold tracking-[-0.04em] text-white text-[40px] leading-[1.05] sm:text-[56px] lg:text-[80px]`}>College Predictor</h1>
              <div className="text-right">
                <button onClick={() => { setResults(null); setErr(null); }} className={`${inter} text-[14px] font-semibold text-[#C9BDF2] transition hover:text-white`}>← New search</button>
                <p className={`${inter} mt-2 text-[13px] font-medium text-white/60`}>{results.reduce((a, g) => a + g.rows.length, 0)} programs · {results.length} institutes</p>
              </div>
            </div>
          </section>

          {/* gradient band (Rectangle 61, cropped by 63) — carries the meta + gauge */}
          <section className="relative" style={{ background: BAND_GRAD }}>
            <div className="mx-auto flex max-w-[1280px] flex-wrap items-center justify-between gap-8 px-6 py-9 sm:px-10">
              <div>
                <p className={`${inter} text-[22px] font-normal tracking-[-0.04em] text-white sm:text-[26px] lg:text-[30px] lg:leading-[30px]`}>Category : {f.category}</p>
                <p className={`${inter} mt-3 text-[22px] font-normal tracking-[-0.04em] text-white sm:text-[26px] lg:text-[30px] lg:leading-[30px]`}>JEE Main 2026 Rank : {rankLabel}</p>
                <button onClick={share} className={`${inter} mt-5 inline-flex items-center gap-3 rounded-[30px] px-4 py-1.5 text-[17px] font-medium tracking-[-0.04em] text-white shadow-[0_4px_4px_rgba(0,0,0,0.25)] transition hover:brightness-110 sm:text-[20px]`} style={{ background: "rgba(52,199,89,0.9)" }}>
                  {copied ? "Link copied!" : "Share this FREE Predictor Tool"}
                  <svg viewBox="0 0 24 24" className="h-[22px] w-[22px]" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7M16 6l-4-4-4 4M12 2v14" /></svg>
                </button>
              </div>

              {/* gauge (Frame 1261156041) */}
              <div className="w-full max-w-[420px] rounded-[21px] px-4 py-4">
                <p className={`${inter} text-center text-[18px] font-medium tracking-[-0.04em] text-white sm:text-[21px]`}>Predicted College on your Rank</p>
                <div className="mt-4 flex items-center justify-center gap-3">
                  <Ticks flip />
                  <span className={`${inter} rounded-[21px] px-5 py-2.5 text-[18px] font-medium tracking-[-0.04em] text-white sm:text-[21px]`} style={{ background: GAUGE_GRAD }}>{rankLabel}</span>
                  <Ticks />
                </div>
              </div>
            </div>
          </section>

          {/* table area: #141414 */}
          <section className="bg-[#141414] pb-16 pt-10">
            <div className="mx-auto max-w-[1280px] px-6 sm:px-10">
              {results.length === 0 ? (
                <div className="rounded-[20px] border border-dashed border-white/20 p-12 text-center">
                  <p className={`${inter} text-[22px] font-semibold text-white`}>No matches for this rank</p>
                  <p className={`${inter} mt-2 text-[15px] text-white/60`}>Try a different rank, category or seat pool.</p>
                </div>
              ) : (
                <div className="overflow-hidden rounded-[20px] bg-[#FEFEFE]">
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[980px] border-collapse">
                      <thead>
                        <tr className="border-b border-[#DDDDDD]">
                          <th className={th}>Institute</th>
                          <th className={th}>Program</th>
                          <th className={`${th} text-right`}>Opening Rank</th>
                          <th className={`${th} text-right`}>Closing Rank</th>
                          <th className={`${th} text-center`}>Quota</th>
                          <th className={th} />
                        </tr>
                      </thead>
                      <tbody>
                        {results.flatMap((g) => g.rows.map((r, i) => (
                          <tr key={`${g.institute}-${i}`} className="border-b border-[#DDDDDD] last:border-b-0 hover:bg-[#FAF8FF]">
                            <td className={`${td} font-semibold text-[#1a1a1a]`}>{i === 0 ? g.institute : ""}</td>
                            <td className={`${td} min-w-[320px]`}>{r.program_name}</td>
                            <td className={`${td} text-right tabular-nums`}>{r.opening_rank}</td>
                            <td className={`${td} text-right font-bold tabular-nums`}>{r.closing_rank}</td>
                            <td className={`${td} text-center`}>
                              <span className="rounded-full bg-[#F2F2F2] px-2.5 py-1 text-[11px] font-bold text-[#7629FC]">{r.sub_category}</span>
                            </td>
                            <td className={`${td} text-right`}>
                              <button onClick={() => openRounds(g, r)} className={`${inter} whitespace-nowrap rounded-md px-4 py-2 text-[15px] font-normal tracking-[-0.04em] text-white transition hover:opacity-95 lg:text-[17px]`} style={{ background: SUBMIT_GRAD }}>Round wise details</button>
                            </td>
                          </tr>
                        )))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div className="mt-8 overflow-hidden rounded-[20px] p-7 text-center" style={{ background: SUBMIT_GRAD }}>
                <p className={`${inter} text-[22px] font-extrabold tracking-[-0.03em] text-white`}>Marks don&apos;t get you jobs. Skills do.</p>
                <p className={`${inter} mt-1.5 text-[15px] font-light text-white/85`}>Start coding from day one with Vedam&apos;s 4-year CS &amp; AI program. Up to 100% scholarships.</p>
                <a href="/apply" className={`${inter} mt-5 inline-block rounded-md bg-white px-6 py-2.5 text-[15px] font-bold text-[#7629FC]`}>Apply via VSAT</a>
              </div>
            </div>
          </section>
        </div>
      )}

      {modal && (
        <div onClick={() => setModal(null)} className="fixed inset-0 z-50 grid place-items-center bg-[rgba(10,5,25,.7)] p-4 backdrop-blur-sm">
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-lg rounded-[20px] bg-white p-6">
            <div className={`${inter} mb-1 text-[13px] font-semibold uppercase tracking-wide text-[#7629FC]`}>{modal.name}</div>
            <div className={`${inter} text-[19px] font-bold tracking-[-0.03em] text-black`}>{modal.program}</div>
            <div className="mt-5 overflow-hidden rounded-xl border border-[#DDDDDD]">
              <div className={`${inter} grid grid-cols-3 px-4 py-2.5 text-[11px] font-bold uppercase tracking-wide text-white`} style={{ background: SUBMIT_GRAD }}>
                <span>Round</span><span className="text-right">Opening</span><span className="text-right">Closing</span>
              </div>
              {modal.rounds.length === 0 ? (
                <div className={`${inter} px-4 py-6 text-center text-[14px] text-[#8a8a8a]`}>No round-wise data for this program.</div>
              ) : modal.rounds.map((r, i) => (
                <div key={i} className={`${inter} grid grid-cols-3 items-center border-t border-[#DDDDDD] px-4 py-2.5 text-[14px] odd:bg-[#FAF8FF]`}>
                  <span className="font-semibold text-black">Round {r.round}</span>
                  <span className="text-right tabular-nums text-[#1a1a1a]">{r.opening_rank}</span>
                  <span className="text-right font-bold tabular-nums text-black">{r.closing_rank}</span>
                </div>
              ))}
            </div>
            <button onClick={() => setModal(null)} className={`${inter} mt-5 w-full rounded-md py-2.5 text-[15px] font-bold text-white`} style={{ background: SUBMIT_GRAD }}>Close</button>
          </div>
        </div>
      )}
      <Modals />
    </>
  );
}

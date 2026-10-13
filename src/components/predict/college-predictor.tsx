"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useProductGate } from "@/components/funnel/use-product-gate";
import { marksToRank } from "@/lib/cp/marks-to-rank";
import { CP_STATES, CP_CATEGORIES, CP_GENDERS, CP_STREAMS, CP_YEARS, stateNameToId } from "@/lib/cp/options";

type Row = { institute_id: number; institute_name: string; program_name: string; opening_rank: number; closing_rank: number; sub_category: string; round: number };
type Form = { mode: "rank" | "marks"; rank: string; marks: string; category: string; gender: string; stream: string; year: string; stateId: string };
type Grouped = { institute: string; institute_id: number; rows: Row[] };

const blank: Form = { mode: "marks", rank: "", marks: "", category: "OPEN", gender: "Gender Neutral", stream: "PCM", year: "2026", stateId: "" };
function sid() { let s = localStorage.getItem("cp_sid"); if (!s) { s = crypto.randomUUID(); localStorage.setItem("cp_sid", s); } return s; }

/** Figma: radial purple glow used behind the hero (Ellipse 35/36/37). */
const GLOW = "radial-gradient(50% 50% at 50% 50%, #C200DB 0%, rgba(0,0,0,0) 72.6%)";
const SUBMIT_GRAD = "linear-gradient(93.15deg, #7629FC 5.87%, #8A18FF 88.28%)";

function Tick() {
  return (
    <span aria-hidden className="mt-1 grid h-6 w-6 shrink-0 place-items-center rounded-full" style={{ background: "radial-gradient(closest-side, rgba(24,243,79,0.55), rgba(0,0,0,0))" }}>
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
    </span>
  );
}

const FEATURES: { label: string; bg: string; icon: React.ReactNode }[] = [
  {
    label: "Developed by Experts", bg: "rgba(0,207,229,0.2)",
    icon: <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="#6DEAF8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 8-5 4 5 4M15 8l5 4-5 4" /></svg>,
  },
  {
    label: "College & Branch Prediction", bg: "rgba(118,41,252,0.5)",
    icon: <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="#C9B0FF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18M7 15l4-5 3 3 5-7" /></svg>,
  },
  {
    label: "80,000+ Users", bg: "#C200DB",
    icon: <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="#FFD6FF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="8" r="3" /><path d="M3 20c0-3 3-5 6-5s6 2 6 5M16 5a3 3 0 0 1 0 6" /></svg>,
  },
];

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

  // Figma form card tokens
  const fieldCls = "w-full rounded-md bg-[#F2F2F2] px-3.5 py-3 text-[15px] tracking-[-0.02em] text-black outline-none placeholder:text-[#BFBFBF] focus:ring-2 focus:ring-[#7629FC]/40";
  const labelCls = "mb-2 block text-[17px] font-semibold tracking-[-0.04em] text-black";
  const th = "whitespace-nowrap border-r border-[#DDDDDD] px-5 py-4 text-left text-[15px] font-normal tracking-[-0.04em] text-[#7629FC] last:border-r-0 lg:text-[19px]";
  const td = "border-r border-[#DDDDDD] px-5 py-4 align-middle text-[14px] tracking-[-0.02em] text-[#1a1a1a] last:border-r-0 lg:text-[15px]";

  return (
    <div className="relative isolate overflow-hidden">
      {/* ambient purple glow (Figma Ellipse 35/36/37) */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-[520px] left-[25%] h-[1000px] w-[1600px] -rotate-12 opacity-70 blur-[7px]" style={{ background: GLOW }} />
        <div className="absolute -top-[460px] -left-[25%] h-[1000px] w-[1500px] rotate-12 opacity-60 blur-[7px]" style={{ background: GLOW }} />
      </div>

      <div className="mx-auto max-w-[1280px] px-6 py-12 sm:px-10 lg:py-16">
        {!results ? (
          <div className="grid items-start gap-12 lg:grid-cols-[1fr_minmax(0,540px)] lg:gap-14">
            {/* ---------- LEFT: hero ---------- */}
            <div className="lg:pt-6">
              <p className="font-[family-name:var(--font-inter)] text-[18px] font-extralight leading-[30px] text-white sm:text-[20px] sm:leading-[35px]">Most Accurate</p>
              <h1 className="mt-2 font-[family-name:var(--font-inter)] font-semibold tracking-[-0.06em] text-white text-[44px] leading-[50px] sm:text-[60px] sm:leading-[68px] lg:text-[80px] lg:leading-[90px]">
                JEE MAIN<br />College Predictor
              </h1>

              <ul className="mt-8 space-y-4">
                {["Predict your college & branch from your JEE Main 2026 rank", "No hidden charges · 100% Free"].map((t) => (
                  <li key={t} className="flex items-start gap-3">
                    <Tick />
                    <span className="text-[17px] font-light leading-[1.45] tracking-[-0.04em] text-[#18F34F] sm:text-[20px] lg:text-[23px]">{t}</span>
                  </li>
                ))}
              </ul>

              {/* built by experts from Google & Microsoft */}
              <div className="mt-7 flex flex-wrap items-center gap-x-3 gap-y-2">
                <span className="text-[14px] font-light tracking-[-0.02em] text-white/70 sm:text-[15px]">Built by experts from</span>
                <img src="/landing/logo-google.webp" alt="Google" className="h-[22px] w-auto sm:h-[25px]" />
                <img src="/landing/logo-microsoft.webp" alt="Microsoft" className="h-[19px] w-auto sm:h-[21px]" />
              </div>

              <div className="mt-9 flex flex-wrap gap-4">
                {FEATURES.map((p) => (
                  <div key={p.label} className="flex items-center gap-3.5 rounded-[15px] px-5 py-4" style={{ background: "rgba(62,62,62,0.2)" }}>
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full" style={{ background: p.bg }}>{p.icon}</span>
                    <span className="max-w-[160px] text-[15px] font-light leading-[1.2] tracking-[-0.04em] text-white sm:text-[17px]">{p.label}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* ---------- RIGHT: form card ---------- */}
            <div className="rounded-[20px] bg-white p-6 shadow-[0_30px_80px_-30px_rgba(194,0,219,0.45)] sm:p-8">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-[26px] font-bold tracking-[-0.03em] text-black sm:text-[30px]">Enter your details</h2>
                <div className="inline-flex rounded-full bg-[#F2F2F2] p-1">
                  {(["rank", "marks"] as const).map((m) => (
                    <button key={m} onClick={() => set({ mode: m })}
                      className={["rounded-full px-3.5 py-1.5 text-[12px] font-bold capitalize transition", f.mode === m ? "text-white" : "text-[#8a8a8a]"].join(" ")}
                      style={f.mode === m ? { background: SUBMIT_GRAD } : undefined}>{m}</button>
                  ))}
                </div>
              </div>

              <div className="mt-6 flex flex-col gap-5">
                <div>
                  <label className={labelCls}>{f.mode === "rank" ? "JEE Main Rank" : "JEE Main Marks (0–300)"}</label>
                  {f.mode === "rank"
                    ? <input value={f.rank} onChange={(e) => set({ rank: e.target.value.replace(/\D/g, "") })} inputMode="numeric" placeholder="Enter Rank" className={fieldCls} />
                    : <input value={f.marks} onChange={(e) => set({ marks: e.target.value.replace(/[^\d.]/g, "") })} inputMode="decimal" placeholder="Enter Marks" className={fieldCls} />}
                </div>
                <div>
                  <label className={labelCls}>Seat Pool</label>
                  <select value={f.gender} onChange={(e) => set({ gender: e.target.value })} className={fieldCls}>{CP_GENDERS.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}</select>
                </div>
                <div>
                  <label className={labelCls}>Category</label>
                  <select value={f.category} onChange={(e) => set({ category: e.target.value })} className={fieldCls}>{CP_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}</select>
                </div>
                <div>
                  <label className={labelCls}>12th Passout Year</label>
                  <select value={f.year} onChange={(e) => set({ year: e.target.value })} className={fieldCls}>{CP_YEARS.map((y) => <option key={y} value={y}>{y}</option>)}</select>
                </div>
                <div>
                  <label className={labelCls}>Preferred Stream</label>
                  <select value={f.stream} onChange={(e) => set({ stream: e.target.value })} className={fieldCls}>{CP_STREAMS.map((s) => <option key={s} value={s}>{s}</option>)}</select>
                </div>
                <div>
                  <label className={labelCls}>Domicile State{authed && f.stateId ? <span className="ml-2 text-[13px] font-normal text-[#8a8a8a]">· autofilled, editable</span> : ""}</label>
                  <select value={f.stateId} onChange={(e) => set({ stateId: e.target.value })} className={fieldCls}>
                    <option value="">Select State…</option>
                    {CP_STATES.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
              </div>

              {err && <p className="mt-4 text-[14px] font-medium text-[#d1004b]">{err}</p>}

              <button onClick={onPredict} disabled={loading}
                className="mt-7 flex w-full items-center justify-center gap-2 rounded-md py-3 text-[18px] font-medium tracking-[-0.04em] text-white transition hover:opacity-95 disabled:opacity-60"
                style={{ background: SUBMIT_GRAD }}>
                {loading ? "Predicting…" : <>Submit <span aria-hidden>→</span></>}
              </button>
              {!authed && <p className="mt-3 text-center text-[13px] text-[#8a8a8a]">You&apos;ll create a free account to view your predicted colleges.</p>}
            </div>
          </div>
        ) : (
          /* ---------- RESULTS ---------- */
          <div>
            <div className="flex flex-wrap items-start justify-between gap-6">
              <div>
                <h1 className="font-semibold leading-[1.05] tracking-[-0.04em] text-white text-[40px] sm:text-[56px] lg:text-[72px]">College Predictor</h1>
                <p className="mt-5 text-[20px] font-normal tracking-[-0.04em] text-white sm:text-[25px] lg:text-[28px]">Category : {f.category}</p>
                <p className="mt-1.5 text-[20px] font-normal tracking-[-0.04em] text-white sm:text-[25px] lg:text-[28px]">
                  JEE Main 2026 Rank : {rankRange && rankRange[0] !== rankRange[1] ? `${rankRange[0]} – ${rankRange[1]}` : rankRange?.[0]}
                </p>
                <button onClick={share} className="mt-6 inline-flex items-center gap-2.5 rounded-full px-5 py-2 text-[16px] font-medium tracking-[-0.04em] text-white shadow-[0_4px_4px_rgba(0,0,0,0.25)] transition hover:brightness-110 sm:text-[18px]" style={{ background: "rgba(52,199,89,0.9)" }}>
                  {copied ? "Link copied!" : "Share this FREE Predictor Tool"}
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7M16 6l-4-4-4 4M12 2v14" /></svg>
                </button>
              </div>
              <div className="text-right">
                <button onClick={() => { setResults(null); setErr(null); }} className="text-[14px] font-semibold text-[#C9BDF2] transition hover:text-white">← New search</button>
                <p className="mt-2 text-[13px] font-medium text-white/60">{results.reduce((a, g) => a + g.rows.length, 0)} programs · {results.length} institutes</p>
              </div>
            </div>

            {results.length === 0 ? (
              <div className="mt-10 rounded-[20px] border border-dashed border-white/20 p-12 text-center">
                <p className="text-[22px] font-semibold text-white">No matches for this rank</p>
                <p className="mt-2 text-[15px] text-white/60">Try a different rank, category or seat pool.</p>
              </div>
            ) : (
              <div className="mt-10 overflow-hidden rounded-[20px] bg-[#FEFEFE]">
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
                            <button onClick={() => openRounds(g, r)} className="whitespace-nowrap rounded-md px-3.5 py-2 text-[13px] font-medium text-white transition hover:opacity-95" style={{ background: SUBMIT_GRAD }}>Round wise details</button>
                          </td>
                        </tr>
                      )))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="mt-8 overflow-hidden rounded-[20px] p-7 text-center" style={{ background: SUBMIT_GRAD }}>
              <p className="text-[22px] font-extrabold tracking-[-0.03em] text-white">Marks don&apos;t get you jobs. Skills do.</p>
              <p className="mt-1.5 text-[15px] font-light text-white/85">Start coding from day one with Vedam&apos;s 4-year CS &amp; AI program. Up to 100% scholarships.</p>
              <a href="/apply" className="mt-5 inline-block rounded-md bg-white px-6 py-2.5 text-[15px] font-bold text-[#7629FC]">Apply via VSAT</a>
            </div>
          </div>
        )}
      </div>

      {modal && (
        <div onClick={() => setModal(null)} className="fixed inset-0 z-50 grid place-items-center bg-[rgba(10,5,25,.7)] p-4 backdrop-blur-sm">
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-lg rounded-[20px] bg-white p-6">
            <div className="mb-1 text-[13px] font-semibold uppercase tracking-wide text-[#7629FC]">{modal.name}</div>
            <div className="text-[19px] font-bold tracking-[-0.03em] text-black">{modal.program}</div>
            <div className="mt-5 overflow-hidden rounded-xl border border-[#DDDDDD]">
              <div className="grid grid-cols-3 px-4 py-2.5 text-[11px] font-bold uppercase tracking-wide text-white" style={{ background: SUBMIT_GRAD }}>
                <span>Round</span><span className="text-right">Opening</span><span className="text-right">Closing</span>
              </div>
              {modal.rounds.length === 0 ? (
                <div className="px-4 py-6 text-center text-[14px] text-[#8a8a8a]">No round-wise data for this program.</div>
              ) : modal.rounds.map((r, i) => (
                <div key={i} className="grid grid-cols-3 items-center border-t border-[#DDDDDD] px-4 py-2.5 text-[14px] odd:bg-[#FAF8FF]">
                  <span className="font-semibold text-black">Round {r.round}</span>
                  <span className="text-right tabular-nums text-[#1a1a1a]">{r.opening_rank}</span>
                  <span className="text-right font-bold tabular-nums text-black">{r.closing_rank}</span>
                </div>
              ))}
            </div>
            <button onClick={() => setModal(null)} className="mt-5 w-full rounded-md py-2.5 text-[15px] font-bold text-white" style={{ background: SUBMIT_GRAD }}>Close</button>
          </div>
        </div>
      )}
      <Modals />
    </div>
  );
}

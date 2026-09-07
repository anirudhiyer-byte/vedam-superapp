"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { marksToRank } from "@/lib/cp/marks-to-rank";
import { CP_STATES, CP_CATEGORIES, CP_GENDERS, CP_STREAMS, CP_YEARS, stateNameToId } from "@/lib/cp/options";

type Row = { institute_id: number; institute_name: string; program_name: string; opening_rank: number; closing_rank: number; sub_category: string; round: number };
type Form = { mode: "rank" | "marks"; rank: string; marks: string; category: string; gender: string; stream: string; year: string; stateId: string };
type Grouped = { institute: string; institute_id: number; rows: Row[] };

const blank: Form = { mode: "marks", rank: "", marks: "", category: "OPEN", gender: "Gender-Neutral", stream: "PCM", year: "2026", stateId: "" };
function sid() { let s = localStorage.getItem("cp_sid"); if (!s) { s = crypto.randomUUID(); localStorage.setItem("cp_sid", s); } return s; }

export function CollegePredictor() {
  const [supabase] = useState(() => createClient());
  const router = useRouter();
  const [f, setF] = useState<Form>(blank);
  const [authed, setAuthed] = useState(false);
  const [results, setResults] = useState<Grouped[] | null>(null);
  const [rankRange, setRankRange] = useState<[number, number] | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [modal, setModal] = useState<{ name: string; program: string; rounds: { round: number; opening_rank: number; closing_rank: number }[] } | null>(null);

  const set = (patch: Partial<Form>) => setF((x) => ({ ...x, ...patch }));
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
    if (!authed) { localStorage.setItem("cp_pending", JSON.stringify(f)); log("redirected_to_signup"); router.push("/register?next=/predict"); return; }
    runPrediction(f);
  }

  async function openRounds(g: Grouped, r: Row) {
    const { data } = await supabase.rpc("predict_rounds", { p_institute_id: g.institute_id, p_program: r.program_name, p_category: f.category, p_gender: f.gender });
    setModal({ name: g.institute, program: r.program_name, rounds: (data as { round: number; opening_rank: number; closing_rank: number }[]) ?? [] });
  }

  const field = "w-full rounded-xl border border-border-strong bg-background px-3.5 py-3 text-sm text-foreground outline-none focus:border-[color:rgb(var(--accent))]";
  const label = "mb-1.5 block font-body text-xs font-bold text-foreground";

  return (
    <div className="mx-auto max-w-5xl px-6 py-10 sm:px-10">
      <div className="text-center">
        <span className="inline-flex items-center gap-2 font-mono text-xs font-semibold uppercase tracking-wide text-accent"><span className="h-1.5 w-1.5 rounded-full bg-brand-gradient" /> Most accurate · 100% free</span>
        <h1 className="mt-3 font-display text-4xl font-extrabold tracking-tight text-heading sm:text-5xl">JEE Main 2026 <span className="bg-brand-gradient bg-clip-text text-transparent">College Predictor</span></h1>
        <p className="mt-2 font-body text-sm text-muted">Predict your college &amp; branch from your JEE Main 2026 rank — built by experts from Google &amp; Microsoft. No hidden charges.</p>
      </div>

      {!results ? (
        <div className="mx-auto mt-8 max-w-2xl rounded-3xl border border-border bg-surface p-6 shadow-[0_24px_60px_-30px_rgba(43,19,92,.35)] sm:p-8">
          <div className="mb-5 flex items-center justify-between">
            <h2 className="font-display text-lg font-bold text-heading">Start your prediction</h2>
            <div className="inline-flex rounded-full border border-border p-1">
              <button onClick={() => set({ mode: "rank" })} className={["rounded-full px-4 py-1.5 font-mono text-xs font-bold", f.mode === "rank" ? "bg-brand-gradient text-white" : "text-muted"].join(" ")}>Rank</button>
              <button onClick={() => set({ mode: "marks" })} className={["rounded-full px-4 py-1.5 font-mono text-xs font-bold", f.mode === "marks" ? "bg-brand-gradient text-white" : "text-muted"].join(" ")}>Marks</button>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className={label}>{f.mode === "rank" ? "JEE Main 2026 Rank" : "JEE Main 2026 Marks (0–300)"}</label>
              {f.mode === "rank"
                ? <input value={f.rank} onChange={(e) => set({ rank: e.target.value.replace(/\D/g, "") })} inputMode="numeric" placeholder="e.g. 15000" className={field} />
                : <input value={f.marks} onChange={(e) => set({ marks: e.target.value.replace(/[^\d.]/g, "") })} inputMode="decimal" placeholder="Enter marks (0–300)" className={field} />}
            </div>
            <div><label className={label}>Seat Pool</label><select value={f.gender} onChange={(e) => set({ gender: e.target.value })} className={field}>{CP_GENDERS.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}</select></div>
            <div><label className={label}>Category</label><select value={f.category} onChange={(e) => set({ category: e.target.value })} className={field}>{CP_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}</select></div>
            <div><label className={label}>12th Passout Year</label><select value={f.year} onChange={(e) => set({ year: e.target.value })} className={field}>{CP_YEARS.map((y) => <option key={y} value={y}>{y}</option>)}</select></div>
            <div><label className={label}>Preferred Stream</label><select value={f.stream} onChange={(e) => set({ stream: e.target.value })} className={field}>{CP_STREAMS.map((s) => <option key={s} value={s}>{s}</option>)}</select></div>
            <div className="sm:col-span-2"><label className={label}>Domicile State{authed && f.stateId ? <span className="ml-2 font-normal text-muted">· autofilled, editable</span> : ""}</label>
              <select value={f.stateId} onChange={(e) => set({ stateId: e.target.value })} className={field}><option value="">Select state…</option>{CP_STATES.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
          </div>
          {err && <p className="mt-3 font-body text-sm text-red-500">{err}</p>}
          <button onClick={onPredict} disabled={loading} className="mt-6 w-full rounded-xl bg-brand-gradient px-6 py-4 font-display text-base font-bold text-white disabled:opacity-60">{loading ? "Predicting…" : "Predict my colleges →"}</button>
          {!authed && <p className="mt-3 text-center font-body text-xs text-muted">You&apos;ll create a free account to view your predicted colleges.</p>}
        </div>
      ) : (
        <div className="mt-8">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div>
              <button onClick={() => { setResults(null); setErr(null); }} className="font-mono text-xs font-semibold text-accent">← New search</button>
              <p className="mt-1 font-body text-sm text-muted">Category: <b className="text-heading">{f.category}</b> · JEE Main 2026 Rank: <b className="text-heading">{rankRange && rankRange[0] !== rankRange[1] ? `${rankRange[0]} – ${rankRange[1]}` : rankRange?.[0]}</b></p>
            </div>
            <span className="font-mono text-xs font-semibold text-muted">{results.reduce((a, g) => a + g.rows.length, 0)} programs · {results.length} institutes</span>
          </div>
          {results.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border-strong bg-surface p-10 text-center"><p className="font-display text-lg font-bold text-heading">No matches for this rank</p><p className="mt-1 font-body text-sm text-muted">Try a different rank, category or seat pool.</p></div>
          ) : results.map((g) => (
            <div key={g.institute} className="mb-4 overflow-hidden rounded-2xl border border-border bg-surface">
              <div className="border-b border-border bg-surface-warm/50 px-5 py-3 font-display text-base font-extrabold text-heading">{g.institute}</div>
              <div className="divide-y divide-border">
                {g.rows.map((r, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                    <span className="min-w-[220px] flex-1 font-body font-semibold text-foreground">{r.program_name}</span>
                    <span className="font-mono text-xs text-muted">Opening <b className="text-foreground">{r.opening_rank}</b></span>
                    <span className="font-mono text-xs text-muted">Closing <b className="text-foreground">{r.closing_rank}</b></span>
                    <span className="rounded-full bg-surface-warm px-2.5 py-1 font-mono text-[10px] font-bold text-muted">{r.sub_category}</span>
                    <button onClick={() => openRounds(g, r)} className="ml-auto rounded-lg border border-border-strong px-3 py-1.5 font-mono text-[11px] font-semibold text-accent hover:bg-surface-warm">Round-wise details</button>
                  </div>
                ))}
              </div>
            </div>
          ))}
          <div className="mt-6 overflow-hidden rounded-2xl bg-brand-gradient p-6 text-center text-white">
            <p className="font-display text-xl font-extrabold">Marks don&apos;t get you jobs. Skills do.</p>
            <p className="mt-1 font-body text-sm text-white/85">Start coding from day one with Vedam&apos;s 4-year CS &amp; AI program. Up to 100% scholarships.</p>
            <a href="/events" className="mt-4 inline-block rounded-xl bg-white px-6 py-2.5 font-display text-sm font-bold text-heading">Apply via VSAT</a>
          </div>
        </div>
      )}

      {modal && (
        <div onClick={() => setModal(null)} className="fixed inset-0 z-50 grid place-items-center bg-[rgba(20,10,45,.55)] p-4 backdrop-blur-sm">
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-lg rounded-2xl bg-surface p-6 shadow-xl">
            <div className="mb-1 font-mono text-xs text-muted">{modal.name}</div>
            <div className="font-display text-lg font-extrabold text-heading">{modal.program}</div>
            <div className="mt-4 overflow-hidden rounded-xl border border-border">
              <div className="grid grid-cols-3 bg-brand-gradient px-4 py-2 font-mono text-[11px] font-bold text-white"><span>Round</span><span className="text-right">Opening</span><span className="text-right">Closing</span></div>
              {modal.rounds.map((r, i) => <div key={i} className="grid grid-cols-3 border-t border-border px-4 py-2 font-body text-sm"><span>{r.round}</span><span className="text-right">{r.opening_rank}</span><span className="text-right font-semibold text-heading">{r.closing_rank}</span></div>)}
            </div>
            <button onClick={() => setModal(null)} className="mt-4 w-full rounded-xl border border-border px-4 py-2.5 font-body text-sm font-semibold text-foreground">Close</button>
          </div>
        </div>
      )}
    </div>
  );
}

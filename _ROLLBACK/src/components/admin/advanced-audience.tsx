"use client";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

const SOURCES = [
  { key: "vedam_one_profiles", label: "All users (rollup) — cross-product" },
  { key: "vedam_one", label: "Activity ledger (every action)" },
  { key: "bootcamp_participation", label: "Bootcamp participants" },
  { key: "bootcamp_dropoffs", label: "Bootcamp drop-offs" },
  { key: "codesprint_participation", label: "CodeSprint (per module)" },
  { key: "vsat_registrations", label: "VSAT early registrations" },
];
const OPS = ["=", "<>", ">", "<", ">=", "<=", "ilike", "contains", "is null", "is not null"];
type Cond = { col: string; op: string; value: string; join: "AND" | "OR" };
type Rec = { user_id: string; email: string | null; phone: string | null; full_name: string | null };

/** Advanced audience: pick a source table -> per-column AND/OR include/exclude
 *  conditions -> resolve the matching recipients. Sits ALONGSIDE the simple filter. */
export function AdvancedAudience({ onResolved }: { onResolved: (recips: Rec[]) => void }) {
  const [supabase] = useState(() => createClient());
  const [source, setSource] = useState("vedam_one_profiles");
  const [cols, setCols] = useState<string[]>([]);
  const [conds, setConds] = useState<Cond[]>([{ col: "", op: "=", value: "", join: "AND" }]);
  const [recips, setRecips] = useState<Rec[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const inp = "rounded-lg border border-border-strong bg-background px-2.5 py-1.5 text-sm text-foreground outline-none";

  useEffect(() => {
    (async () => {
      const { data } = await supabase.rpc("source_columns", { p_source: source });
      setCols(((data as { column_name: string }[]) ?? []).map((c) => c.column_name));
      setRecips(null); onResolved([]);
    })();
    // eslint-disable-next-line
  }, [source, supabase]);

  async function resolve() {
    setBusy(true); setErr("");
    const conditions = conds.filter((c) => c.col).map((c) => ({ col: c.col, op: c.op, value: c.value, join: c.join }));
    const { data, error } = await supabase.rpc("campaign_audience", { p_source: source, p_conditions: conditions });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    const r = (data as Rec[]) ?? [];
    setRecips(r); onResolved(r);
  }

  return (
    <div className="rounded-2xl border border-accent/30 bg-surface p-4">
      <div className="mb-1 flex items-center gap-2"><span className="rounded-full bg-brand-gradient px-2 py-0.5 text-[10px] font-bold uppercase text-white">Advanced</span><p className="font-body text-sm font-semibold text-heading">Dynamic audience (any table · AND/OR · include/exclude)</p></div>
      <p className="mb-3 font-body text-xs text-muted">For power-filtering. The simple filter above still works — use whichever fits.</p>

      <label className="mb-3 block text-xs font-semibold text-muted">Source
        <select value={source} onChange={(e) => setSource(e.target.value)} className={inp + " mt-1 w-full max-w-md"}>{SOURCES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select>
      </label>

      <div className="space-y-2">
        {conds.map((c, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            {i > 0 && <select value={c.join} onChange={(e) => setConds((x) => x.map((y, j) => j === i ? { ...y, join: e.target.value as "AND" | "OR" } : y))} className={inp + " w-20"}><option>AND</option><option>OR</option></select>}
            <select value={c.col} onChange={(e) => setConds((x) => x.map((y, j) => j === i ? { ...y, col: e.target.value } : y))} className={inp + " w-52"}><option value="">column…</option>{cols.map((k) => <option key={k} value={k}>{k}</option>)}</select>
            <select value={c.op} onChange={(e) => setConds((x) => x.map((y, j) => j === i ? { ...y, op: e.target.value } : y))} className={inp}>{OPS.map((o) => <option key={o}>{o}</option>)}</select>
            {!c.op.includes("null") && <input value={c.value} onChange={(e) => setConds((x) => x.map((y, j) => j === i ? { ...y, value: e.target.value } : y))} placeholder="value (use <> to exclude)" className={inp + " w-40"} />}
            <button onClick={() => setConds((x) => x.filter((_, j) => j !== i))} className="text-muted hover:text-foreground">✕</button>
          </div>
        ))}
      </div>
      <button onClick={() => setConds((x) => [...x, { col: "", op: "=", value: "", join: "AND" }])} className="mt-2 text-xs font-semibold text-accent">+ add condition</button>

      <div className="mt-3 flex items-center gap-3">
        <button onClick={resolve} disabled={busy} className="rounded-lg bg-brand-gradient px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">{busy ? "Resolving…" : "Resolve audience"}</button>
        {recips && <span className="font-mono text-xs text-muted">{recips.length} recipient{recips.length === 1 ? "" : "s"} matched</span>}
        {err && <span className="font-body text-xs text-red-500">{err}</span>}
      </div>
      {recips && recips.length > 0 && <p className="mt-2 font-body text-[11px] text-muted">These will be used as the send audience below (opted-out users already excluded).</p>}
    </div>
  );
}

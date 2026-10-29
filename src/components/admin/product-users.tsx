"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { CommsBroadcast } from "@/components/admin/comms-broadcast";

/** Product Users — NPF-style per-product user manager (admin).
 *  Each product tab pulls an admin-gated RPC that returns the product's own
 *  columns + the full unified profile (vedam_one_profiles) under `profile`.
 *  Product columns show by default; profile columns are added from "Columns". */

type Row = Record<string, unknown> & { user_id: string; profile?: Record<string, unknown> | null };
type ColType = "name" | "id" | "text" | "num" | "enum" | "date" | "status" | "pct" | "tags";
type Col = { key: string; label: string; type: ColType; group: "product" | "profile"; def?: boolean };

const PROFILE_COLS: Col[] = [
  { key: "public_id", label: "Vedam ID", type: "id", group: "profile" },
  { key: "state", label: "State", type: "enum", group: "profile" },
  { key: "city", label: "City", type: "text", group: "profile" },
  { key: "total_points", label: "Total Points", type: "num", group: "profile" },
  { key: "first_product", label: "First Product", type: "enum", group: "profile" },
  { key: "products_used", label: "Products Used", type: "tags", group: "profile" },
  { key: "signup_at", label: "Joined Vedam", type: "date", group: "profile" },
  { key: "days_since_signup", label: "Days Since Signup", type: "num", group: "profile" },
  { key: "last_activity_at", label: "Last Active (Vedam)", type: "date", group: "profile" },
  { key: "is_dormant", label: "Dormant", type: "status", group: "profile" },
  { key: "utm_source", label: "UTM Source", type: "enum", group: "profile" },
  { key: "utm_campaign", label: "UTM Campaign", type: "text", group: "profile" },
  { key: "bc_attended_count", label: "Bootcamps Attended", type: "num", group: "profile" },
  { key: "cs_completion_rate", label: "CodeSprint %", type: "num", group: "profile" },
  { key: "cp_last_rank", label: "CP Last Rank", type: "num", group: "profile" },
  { key: "vsat_early_registered", label: "VSAT Early Reg", type: "status", group: "profile" },
];

const P = (key: string, label: string, type: ColType, def = true): Col => ({ key, label, type, group: "product", def });

const PRODUCTS: { key: string; label: string; rpc: string; base: string; cols: Col[] }[] = [
  { key: "vsat", label: "VSAT", rpc: "pu_vsat", base: "vsat_registrations", cols: [
    P("full_name", "Registered Name", "name"), P("public_id", "Vedam ID", "id"),
    P("email", "Email", "text"), P("phone", "Mobile", "text"),
    P("campus_preference", "Campus Pref", "enum"), P("year_passing_10th", "10th Passing", "enum"),
    P("registered", "Status", "status"), P("registered_at", "Registered On", "date"),
    P("gender", "Gender", "enum", false), P("utm_source", "UTM Source", "enum", false),
  ]},
  { key: "codesprint", label: "CodeSprint", rpc: "pu_codesprint", base: "vedam_one_profiles.cs_*", cols: [
    P("full_name", "Name", "name"), P("email", "Email", "text"), P("phone", "Mobile", "text"),
    P("cs_current_module", "Module", "enum"), P("cs_completion_rate", "% Complete", "pct"),
    P("cs_certs_count", "Certificates", "num"), P("cs_registered_at", "Registered On", "date"),
    P("cs_last_used_at", "Last Active", "date"),
    P("cs_modules_completed", "Modules Done", "num", false), P("cs_avg_quiz_score", "Avg Quiz", "num", false),
  ]},
  { key: "cp", label: "College Predictor", rpc: "pu_college_predictor", base: "cp_predictions (latest)", cols: [
    P("full_name", "Name", "name"), P("email", "Email", "text"), P("phone", "Mobile", "text"),
    P("rank", "Predicted Rank", "num"), P("marks", "Marks", "num"),
    P("category", "Category", "enum"), P("stream", "Stream", "enum"),
    P("result_count", "Colleges", "num"), P("used_on", "Used On", "date"),
    P("passout_year", "Passout Year", "enum", false),
  ]},
  { key: "pyq", label: "PYQ", rpc: "pu_pyq", base: "pyq_attempts (aggregate)", cols: [
    P("full_name", "Name", "name"), P("email", "Email", "text"), P("phone", "Mobile", "text"),
    P("attempts_started", "Started", "num"), P("attempts_submitted", "Submitted", "num"),
    P("papers_attempted", "Papers", "num"), P("avg_accuracy", "Avg Accuracy", "pct"),
    P("last_exam", "Last Exam", "enum"), P("last_used", "Last Attempt", "date"),
    P("first_used", "First Attempt", "date", false),
  ]},
];

const getVal = (r: Row, c: Col): unknown => c.group === "profile" ? (r.profile as Record<string, unknown> | null)?.[c.key] : r[c.key];
const istDate = (v: unknown) => v ? new Date(String(v)).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "2-digit", timeZone: "Asia/Kolkata" }) : "—";
const str = (v: unknown) => Array.isArray(v) ? v.join(", ") : v == null ? "" : String(v);

function Pill({ kind, text }: { kind: "good" | "warn" | "bad" | "flat"; text: string }) {
  const m = { good: "bg-emerald-500/15 text-emerald-400", warn: "bg-amber-500/15 text-amber-400", bad: "bg-rose-500/15 text-rose-400", flat: "bg-white/10 text-white/60" }[kind];
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${m}`}>{text}</span>;
}
function statusCell(c: Col, v: unknown) {
  if (c.key === "registered") return v ? <Pill kind="good" text="Registered" /> : <Pill kind="flat" text="Not registered" />;
  if (c.key === "is_dormant") return v ? <Pill kind="bad" text="Dormant" /> : <Pill kind="good" text="Active" />;
  if (c.key === "vsat_early_registered") return v ? <Pill kind="good" text="Early reg" /> : <Pill kind="flat" text="—" />;
  return <Pill kind="flat" text={str(v) || "—"} />;
}

export function ProductUsers() {
  const [supabase] = useState(() => createClient());
  const [tab, setTab] = useState(PRODUCTS[0].key);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [visible, setVisible] = useState<Record<string, Set<string>>>(() =>
    Object.fromEntries(PRODUCTS.map((p) => [p.key, new Set(p.cols.filter((c) => c.def !== false).map((c) => c.key))])));
  const [showCols, setShowCols] = useState(false);
  const [colSearch, setColSearch] = useState("");
  const [comm, setComm] = useState<null | "email" | "whatsapp">(null);
  const [textF, setTextF] = useState<Record<string, string>>({});
  const [numF, setNumF] = useState<Record<string, { op: string; value: string }>>({});
  const [enumF, setEnumF] = useState<Record<string, string[]>>({});

  const product = PRODUCTS.find((p) => p.key === tab)!;
  const allCols = useMemo(() => [...product.cols, ...PROFILE_COLS], [product]);
  const shownCols = allCols.filter((c) => visible[tab].has(c.key));

  useEffect(() => {
    let on = true;
    setLoading(true); setSelected(new Set()); setTextF({}); setNumF({}); setEnumF({});
    (async () => {
      const { data } = await supabase.rpc(product.rpc);
      if (on) { setRows((data as Row[]) ?? []); setLoading(false); }
    })();
    return () => { on = false; };
  }, [supabase, product.rpc, tab]);

  const enumOptions = useMemo(() => {
    const o: Record<string, string[]> = {};
    shownCols.filter((c) => c.type === "enum").forEach((c) => {
      o[c.key] = Array.from(new Set(rows.map((r) => str(getVal(r, c))))).filter(Boolean).sort();
    });
    return o;
  }, [rows, shownCols]);

  const filtered = useMemo(() => rows.filter((r) => {
    if (q.trim()) { const hay = [r.full_name, r.email, r.phone, r.public_id].map((x) => String(x ?? "").toLowerCase()).join(" "); if (!hay.includes(q.trim().toLowerCase())) return false; }
    for (const c of shownCols) {
      if (c.type === "enum") { const sel = enumF[c.key]; if (sel?.length && !sel.includes(str(getVal(r, c)))) return false; }
      else if (c.type === "num" || c.type === "pct") { const f = numF[c.key]; if (f?.value) { const n = Number(getVal(r, c)); const v = Number(f.value); const ok = f.op === ">=" ? n >= v : f.op === "<=" ? n <= v : f.op === ">" ? n > v : f.op === "<" ? n < v : n === v; if (!ok) return false; } }
      else if (c.type === "text" || c.type === "name" || c.type === "id") { const t = textF[c.key]; if (t && !str(getVal(r, c)).toLowerCase().includes(t.toLowerCase())) return false; }
    }
    return true;
  }), [rows, q, shownCols, enumF, numF, textF]);

  const targets = selected.size ? filtered.filter((r) => selected.has(r.user_id)) : filtered;
  const allSel = filtered.length > 0 && filtered.every((r) => selected.has(r.user_id));
  const toggleAll = () => setSelected((prev) => { const n = new Set(prev); allSel ? filtered.forEach((r) => n.delete(r.user_id)) : filtered.forEach((r) => n.add(r.user_id)); return n; });
  const toggleRow = (id: string) => setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const recipients = targets.map((r) => ({ user_id: r.user_id, email: (r.email as string) ?? null, phone: (r.phone as string) ?? null, full_name: (r.full_name as string) ?? null }));

  function toggleCol(key: string) { setVisible((v) => { const s = new Set(v[tab]); s.has(key) ? s.delete(key) : s.add(key); return { ...v, [tab]: s }; }); }
  function resetCols() { setVisible((v) => ({ ...v, [tab]: new Set(product.cols.filter((c) => c.def !== false).map((c) => c.key)) })); }

  function exportCsv() {
    const cols = shownCols;
    const head = cols.map((c) => c.label);
    const lines = [head, ...targets.map((r) => cols.map((c) => c.type === "date" ? istDate(getVal(r, c)) : str(getVal(r, c))))];
    const csv = lines.map((row) => row.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `product-users-${tab}.csv`; a.click(); URL.revokeObjectURL(a.href);
  }

  function renderCell(r: Row, c: Col) {
    const v = getVal(r, c);
    if (c.type === "status") return statusCell(c, v);
    if (c.type === "date") return <span className="text-muted">{istDate(v)}</span>;
    if (c.type === "id") return <span className="font-mono text-xs text-muted">{str(v) || "—"}</span>;
    if (c.type === "tags") return <span className="flex flex-wrap gap-1">{(Array.isArray(v) ? v : []).map((t, i) => <span key={i} className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-white/70">{String(t)}</span>)}</span>;
    if (c.type === "pct") { const n = v == null ? null : Number(v); return <span className="inline-flex items-center gap-2"><span className="h-1.5 w-16 overflow-hidden rounded-full bg-white/10"><span className="block h-full rounded-full bg-[color:rgb(var(--accent))]" style={{ width: `${Math.max(3, n ?? 0)}%` }} /></span><span className="text-xs tabular-nums">{n == null ? "—" : n + "%"}</span></span>; }
    if (c.type === "num") return <span className="tabular-nums">{v == null ? "—" : str(v)}</span>;
    if (c.key === "full_name") return <span className="font-semibold text-foreground">{str(v) || "—"}</span>;
    return <span>{str(v) || "—"}</span>;
  }

  const btn = "rounded-lg border border-border px-3 py-2 text-sm font-semibold text-foreground hover:bg-surface-warm disabled:opacity-50";

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-8">
      {/* header */}
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-wide text-muted">Admin · Vedam One</div>
          <h1 className="font-display text-xl font-bold text-heading">Product Users</h1>
        </div>
        <div className="flex items-center gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email, Vedam ID…"
            className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-[color:rgb(var(--accent))]" />
          <button onClick={() => setShowCols((s) => !s)} className={btn}>▥ Columns</button>
          <button onClick={exportCsv} disabled={!targets.length} className="rounded-lg bg-brand-gradient px-3.5 py-2 text-sm font-semibold text-white disabled:opacity-50">⭳ Export CSV</button>
        </div>
      </div>

      {/* product tabs */}
      <div className="mb-4 flex gap-1 overflow-x-auto border-b border-border">
        {PRODUCTS.map((p) => (
          <button key={p.key} onClick={() => setTab(p.key)}
            className={["whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-semibold", p.key === tab ? "border-[color:rgb(var(--accent))] text-accent" : "border-transparent text-muted hover:text-foreground"].join(" ")}>
            {p.label}{p.key === tab ? ` · ${rows.length}` : ""}
          </button>
        ))}
      </div>

      {/* selection bar */}
      {selected.size > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-3 rounded-xl bg-[color:rgb(var(--accent))] px-4 py-2.5 text-white">
          <b>{selected.size}</b> selected
          <span className="flex-1" />
          <button onClick={exportCsv} className="rounded-lg border border-white/50 bg-white/10 px-3 py-1.5 text-sm font-semibold hover:bg-white/20">⭳ Export CSV</button>
          <button onClick={() => setComm("email")} className="rounded-lg bg-white px-3 py-1.5 text-sm font-semibold text-[color:rgb(var(--accent))] hover:bg-white/90">➤ Send Communication</button>
          <button onClick={() => setSelected(new Set())} className="rounded-lg border border-white/50 bg-white/10 px-3 py-1.5 text-sm font-semibold hover:bg-white/20">Clear</button>
        </div>
      )}

      {/* table */}
      {loading ? (
        <div className="h-72 animate-pulse rounded-2xl border border-border bg-surface" />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="bg-surface-warm">
              <tr>
                <th className="px-3 py-2.5"><input type="checkbox" checked={allSel} onChange={toggleAll} className="h-4 w-4 accent-[color:rgb(var(--accent))]" /></th>
                {shownCols.map((c) => (
                  <th key={c.key} className={["whitespace-nowrap px-3 py-2.5 font-body text-xs font-semibold", c.group === "profile" ? "text-accent" : "text-foreground"].join(" ")}>{c.label}</th>
                ))}
              </tr>
              <tr className="border-t border-border">
                <th className="px-3 py-1.5" />
                {shownCols.map((c) => (
                  <th key={c.key} className="px-2 py-1.5 align-top">
                    {c.type === "enum" ? (
                      <select multiple={false} value={(enumF[c.key] || [])[0] || ""} onChange={(e) => setEnumF((f) => ({ ...f, [c.key]: e.target.value ? [e.target.value] : [] }))}
                        className="w-full min-w-[80px] rounded border border-border bg-background px-1 py-1 font-mono text-[11px] text-foreground outline-none">
                        <option value="">All</option>
                        {(enumOptions[c.key] || []).map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    ) : (c.type === "num" || c.type === "pct") ? (
                      <div className="flex gap-1">
                        <select value={(numF[c.key]?.op) || ">="} onChange={(e) => setNumF((f) => ({ ...f, [c.key]: { op: e.target.value, value: f[c.key]?.value || "" } }))} className="rounded border border-border bg-background px-1 py-1 font-mono text-[11px] text-foreground outline-none">
                          <option value=">=">≥</option><option value="<=">≤</option><option value=">">&gt;</option><option value="<">&lt;</option><option value="=">=</option>
                        </select>
                        <input value={numF[c.key]?.value || ""} onChange={(e) => setNumF((f) => ({ ...f, [c.key]: { op: f[c.key]?.op || ">=", value: e.target.value } }))} inputMode="numeric" placeholder="#" className="w-full min-w-[44px] rounded border border-border bg-background px-2 py-1 font-mono text-[11px] text-foreground outline-none" />
                      </div>
                    ) : (c.type === "text" || c.type === "name" || c.type === "id") ? (
                      <input value={textF[c.key] || ""} onChange={(e) => setTextF((f) => ({ ...f, [c.key]: e.target.value }))} placeholder="filter" className="w-full min-w-[70px] rounded border border-border bg-background px-2 py-1 font-mono text-[11px] text-foreground outline-none" />
                    ) : null}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={shownCols.length + 1} className="px-3 py-10 text-center text-muted">No users match.</td></tr>
              ) : filtered.map((r) => (
                <tr key={r.user_id} className={["border-t border-border", selected.has(r.user_id) ? "bg-surface-warm/50" : ""].join(" ")}>
                  <td className="px-3 py-2"><input type="checkbox" checked={selected.has(r.user_id)} onChange={() => toggleRow(r.user_id)} className="h-4 w-4 accent-[color:rgb(var(--accent))]" /></td>
                  {shownCols.map((c) => (
                    <td key={c.key} className={["whitespace-nowrap px-3 py-2", c.group === "profile" ? "bg-[color:rgb(var(--accent))]/5" : "", c.key === "full_name" ? "text-foreground" : "text-muted"].join(" ")}>{renderCell(r, c)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-3 font-mono text-xs text-muted">{filtered.length} user{filtered.length === 1 ? "" : "s"} · base: {product.base} + vedam_one_profiles · actions apply to {selected.size ? `${selected.size} selected` : `${filtered.length} shown`}</p>

      {/* Customize columns panel */}
      {showCols && (
        <>
          <div className="fixed inset-0 z-40 bg-black/50" onClick={() => setShowCols(false)} />
          <div className="fixed right-0 top-0 z-50 flex h-full w-[min(420px,100%)] flex-col border-l border-border bg-surface">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <div><h2 className="font-display text-base font-bold text-heading">Customize columns</h2><p className="text-xs text-muted">Product columns show by default.</p></div>
              <button onClick={() => setShowCols(false)} className="rounded border border-border px-2 py-1 text-muted">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4">
              <input value={colSearch} onChange={(e) => setColSearch(e.target.value)} placeholder="Search columns…" className="mb-3 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none" />
              <div className="mb-2 mt-1 font-mono text-[10px] uppercase tracking-wide text-muted">Product columns · {product.base}</div>
              {product.cols.filter((c) => c.label.toLowerCase().includes(colSearch.toLowerCase())).map((c) => (
                <label key={c.key} className="flex items-center gap-3 rounded px-2 py-1.5 hover:bg-surface-warm">
                  <input type="checkbox" checked={visible[tab].has(c.key)} onChange={() => toggleCol(c.key)} className="h-4 w-4 accent-[color:rgb(var(--accent))]" />
                  <span className="text-sm text-foreground">{c.label}</span>
                </label>
              ))}
              <div className="mb-2 mt-4 font-mono text-[10px] uppercase tracking-wide text-muted">Profile columns · vedam_one_profiles</div>
              {PROFILE_COLS.filter((c) => c.label.toLowerCase().includes(colSearch.toLowerCase())).map((c) => (
                <label key={c.key} className="flex items-center gap-3 rounded px-2 py-1.5 hover:bg-surface-warm">
                  <input type="checkbox" checked={visible[tab].has(c.key)} onChange={() => toggleCol(c.key)} className="h-4 w-4 accent-[color:rgb(var(--accent))]" />
                  <span className="text-sm text-foreground">{c.label}</span>
                </label>
              ))}
            </div>
            <div className="flex gap-2 border-t border-border px-5 py-4">
              <button onClick={resetCols} className={btn}>Reset to default</button>
              <button onClick={() => setShowCols(false)} className="flex-1 rounded-lg bg-brand-gradient px-3 py-2 text-sm font-semibold text-white">Apply</button>
            </div>
          </div>
        </>
      )}

      {/* Send Communication modal — reuses the existing CommsBroadcast */}
      {comm && (
        <>
          <div className="fixed inset-0 z-40 bg-black/50" onClick={() => setComm(null)} />
          <div className="fixed left-1/2 top-8 z-50 w-[min(760px,94%)] -translate-x-1/2 overflow-hidden rounded-2xl border border-border bg-surface">
            <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
              <h2 className="font-display text-base font-bold text-heading">Send Communication · <span className="text-accent">{recipients.length} recipient{recipients.length === 1 ? "" : "s"}</span></h2>
              <button onClick={() => setComm(null)} className="rounded border border-border px-2 py-1 text-muted">✕</button>
            </div>
            <div className="flex gap-1 px-5 pt-3">
              <button onClick={() => setComm("email")} className={["rounded-t-lg border border-b-0 px-4 py-2 text-sm font-semibold", comm === "email" ? "border-border bg-background text-accent" : "border-transparent text-muted"].join(" ")}>✉ Email</button>
              <button onClick={() => setComm("whatsapp")} className={["rounded-t-lg border border-b-0 px-4 py-2 text-sm font-semibold", comm === "whatsapp" ? "border-border bg-background text-accent" : "border-transparent text-muted"].join(" ")}>⬤ WhatsApp</button>
            </div>
            <div className="max-h-[72vh] overflow-y-auto border-t border-border px-1 py-1">
              <CommsBroadcast channel={comm} product="all" overrideRecipients={recipients} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

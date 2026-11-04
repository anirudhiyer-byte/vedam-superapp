"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import { CommsBroadcast } from "@/components/admin/comms-broadcast";
import { DarkSelect } from "@/components/admin/dark-select";

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
    P("paid", "Paid", "status"), P("paid_at", "Paid On", "date"),
    P("gender", "Gender", "enum", false), P("utm_source", "UTM Source", "enum", false),
  ]},
  { key: "codesprint", label: "CodeSprint", rpc: "pu_codesprint", base: "vedam_one_profiles.cs_*", cols: [
    P("full_name", "Name", "name"), P("email", "Email", "text"), P("phone", "Mobile", "text"),
    P("cs_stage", "Stage", "enum"),
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
  { key: "bootcamp", label: "Bootcamp", rpc: "pu_bootcamp", base: "bootcamp_participation (aggregate)", cols: [
    P("full_name", "Name", "name"), P("email", "Email", "text"), P("phone", "Mobile", "text"),
    P("bc_registered", "Registered", "num"), P("bc_attended", "Attended", "num"),
    P("bc_avg_watch", "Avg Watch %", "pct"), P("bc_last_event", "Last Event", "text"),
    P("bc_winner", "Winner", "status"),
    P("bc_total_minutes", "Total Minutes", "num", false), P("bc_points", "Points Earned", "num", false),
    P("bc_github_count", "GitHub Shared", "num", false), P("bc_linkedin_count", "LinkedIn Shared", "num", false),
    P("bc_last_registered", "Last Registered On", "date", false), P("bc_first_registered", "First Registered On", "date", false),
    P("bc_dropped_off", "Dropped Off", "status", false), P("bc_utm_source", "UTM Source", "enum", false),
  ]},
  { key: "all", label: "All Users", rpc: "pu_all_users", base: "vedam_one_profiles + all products", cols: [
    P("full_name", "Name", "name"), P("email", "Email", "text"), P("phone", "Mobile", "text"),
    P("vsat_registered", "VSAT Status", "status"), P("cp_rank", "CP Rank", "num"),
    P("pyq_papers_attempted", "PYQ Papers", "num"), P("cs_current_module", "CS Module", "enum"),
    P("vsat_campus_preference", "VSAT Campus", "enum", false), P("vsat_year_passing_10th", "VSAT 10th Year", "enum", false),
    P("vsat_gender", "VSAT Gender", "enum", false), P("vsat_registered_at", "VSAT Registered On", "date", false),
    P("vsat_utm_source", "VSAT UTM Source", "enum", false),
    P("cp_marks", "CP Marks", "num", false), P("cp_category", "CP Category", "enum", false),
    P("cp_stream", "CP Stream", "enum", false), P("cp_result_count", "CP Colleges", "num", false),
    P("cp_passout_year", "CP Passout Year", "enum", false), P("cp_used_on", "CP Used On", "date", false),
    P("cs_certs_count", "CS Certificates", "num", false), P("cs_modules_completed", "CS Modules Done", "num", false),
    P("cs_registered_at", "CS Registered On", "date", false), P("cs_last_used_at", "CS Last Active", "date", false),
    P("cs_avg_quiz_score", "CS Avg Quiz", "num", false),
    P("pyq_attempts_started", "PYQ Started", "num", false), P("pyq_attempts_submitted", "PYQ Submitted", "num", false),
    P("pyq_avg_accuracy", "PYQ Avg Accuracy", "pct", false), P("pyq_last_exam", "PYQ Last Exam", "enum", false),
    P("pyq_last_used", "PYQ Last Attempt", "date", false), P("pyq_first_used", "PYQ First Attempt", "date", false),
    P("bc_registered", "BC Registered", "num", false), P("bc_attended", "BC Attended", "num", false),
    P("bc_avg_watch", "BC Avg Watch %", "pct", false), P("bc_winner", "BC Winner", "status", false),
  ]},
];

const getVal = (r: Row, c: Col): unknown => c.group === "profile" ? (r.profile as Record<string, unknown> | null)?.[c.key] : r[c.key];
const istDate = (v: unknown) => v ? new Date(String(v)).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "2-digit", timeZone: "Asia/Kolkata" }) : "—";
const str = (v: unknown) => Array.isArray(v) ? v.join(", ") : v == null ? "" : String(v);
const initials = (name: unknown) => String(name ?? "").trim().split(/\s+/).slice(0, 2).map((s) => s[0] || "").join("").toUpperCase() || "–";
// status columns are booleans (or null); treat common truthy spellings the same way
const truthy = (v: unknown) => v === true || (typeof v === "number" && v > 0) || ["true", "yes", "y", "1"].includes(String(v ?? "").toLowerCase());
// calendar day in IST as YYYY-MM-DD, so date filters compare by the day the admin sees
const istYmd = (v: unknown) => v ? new Date(String(v)).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }) : "";
const STATUS_LABELS: Record<string, [string, string]> = {
  registered: ["Registered", "Not registered"], vsat_registered: ["Registered", "Not registered"],
  paid: ["Paid", "Not paid"], is_dormant: ["Dormant", "Active"], vsat_early_registered: ["Early reg", "No"],
  bc_winner: ["Winner", "No"], bc_dropped_off: ["Dropped off", "No"],
};
const statusLabels = (key: string): [string, string] => STATUS_LABELS[key] || ["Yes", "No"];
// product columns that only exist where their source table exists (see migration 0052)
const OPTIONAL_KEYS = new Set(["paid", "paid_at"]);

/* ── crisp line icons (no emoji) ───────────────────────────── */
const Svg = (p: { children: ReactNode; className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={p.className || "h-4 w-4"}>{p.children}</svg>
);
const IconSearch = () => <Svg><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></Svg>;
const IconColumns = () => <Svg><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 3v18M15 3v18" /></Svg>;
const IconDownload = () => <Svg><path d="M12 15V3M8 7l4-4 4 4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" /></Svg>;
const IconSend = () => <Svg><path d="m22 2-7 20-4-9-9-4z" /><path d="M22 2 11 13" /></Svg>;
const IconMail = () => <Svg><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></Svg>;
const IconChat = () => <Svg><path d="M21 11.5a8.5 8.5 0 0 1-12.6 7.5L3 21l2-5.4A8.5 8.5 0 1 1 21 11.5z" /></Svg>;
const IconClose = () => <Svg><path d="M18 6 6 18M6 6l12 12" /></Svg>;
const IconInbox = () => <Svg className="mx-auto h-8 w-8"><path d="M22 12h-6l-2 3h-4l-2-3H2" /><path d="M5.5 5h13l3.5 7v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6z" /></Svg>;

function Pill({ kind, text }: { kind: "good" | "warn" | "bad" | "flat"; text: string }) {
  const m = {
    good: "bg-emerald-400/10 text-emerald-300 ring-emerald-400/20",
    warn: "bg-amber-400/10 text-amber-300 ring-amber-400/20",
    bad: "bg-rose-400/10 text-rose-300 ring-rose-400/20",
    flat: "bg-white/5 text-white/50 ring-white/10",
  }[kind];
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium ring-1 ring-inset ${m}`}><span className="h-1.5 w-1.5 rounded-full bg-current" />{text}</span>;
}
function statusCell(c: Col, v: unknown) {
  if (c.key === "is_dormant") return v ? <Pill kind="bad" text="Dormant" /> : <Pill kind="good" text="Active" />;
  if (c.key === "vsat_early_registered") return v ? <Pill kind="good" text="Early reg" /> : <Pill kind="flat" text="—" />;
  if (v == null || typeof v === "boolean") { const [yes, no] = statusLabels(c.key); return truthy(v) ? <Pill kind="good" text={yes} /> : <Pill kind="flat" text={no} />; }
  return <Pill kind="flat" text={str(v) || "—"} />;
}

/** Compact multi-select for a header filter. The list is position:fixed so the
 *  table's scroll container can't clip it. */
function MultiPick({ options, value, onChange, className }: { options: string[]; value: string[]; onChange: (v: string[]) => void; className: string }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    const off = () => setOpen(false);
    document.addEventListener("mousedown", close); document.addEventListener("keydown", esc);
    window.addEventListener("scroll", off, true); window.addEventListener("resize", off);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); window.removeEventListener("scroll", off, true); window.removeEventListener("resize", off); };
  }, [open]);
  const toggle = (o: string) => onChange(value.includes(o) ? value.filter((x) => x !== o) : [...value, o]);
  return (
    <>
      <button ref={btn} type="button"
        onClick={() => { const r = btn.current?.getBoundingClientRect(); if (r) setPos({ left: r.left, top: r.bottom + 4 }); setOpen((o) => !o); }}
        className={className + " flex items-center justify-between gap-1 text-left"}>
        <span className={["truncate", value.length ? "text-white" : "text-white/45"].join(" ")}>{value.length === 0 ? "All" : value.length === 1 ? value[0] : `${value.length} selected`}</span>
        <span className="text-white/40">▾</span>
      </button>
      {open && pos && (
        <div ref={box} style={{ left: pos.left, top: pos.top }} className="fixed z-50 max-h-64 min-w-[180px] overflow-auto rounded-xl border border-white/10 bg-[#16161b] p-1 font-sans text-sm normal-case tracking-normal shadow-[0_16px_40px_-12px_rgba(0,0,0,0.7)]">
          {options.length === 0 && <div className="px-3 py-2 text-white/40">No values</div>}
          {options.map((o) => (
            <label key={o} className="flex cursor-pointer items-center gap-2 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-white/85 hover:bg-white/[0.07]">
              <input type="checkbox" checked={value.includes(o)} onChange={() => toggle(o)} className="h-3.5 w-3.5 accent-[color:rgb(var(--accent))]" />{o}
            </label>
          ))}
          {value.length > 0 && <button type="button" onClick={() => onChange([])} className="mt-1 w-full rounded-lg border-t border-white/10 px-2.5 py-1.5 text-left text-xs text-white/55 hover:text-white">Clear</button>}
        </div>
      )}
    </>
  );
}

export function ProductUsers() {
  const [supabase] = useState(() => createClient());
  const [tab, setTab] = useState(PRODUCTS[0].key);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [qCol, setQCol] = useState("");        // "" = default fields; else search only this column
  const [perPage, setPerPage] = useState(10);  // 0 = show all
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [visible, setVisible] = useState<Record<string, Set<string>>>(() =>
    Object.fromEntries(PRODUCTS.map((p) => [p.key, new Set(p.cols.filter((c) => c.def !== false).map((c) => c.key))])));
  const [showCols, setShowCols] = useState(false);
  const [colSearch, setColSearch] = useState("");
  const [comm, setComm] = useState<null | "email" | "whatsapp">(null);
  const [textF, setTextF] = useState<Record<string, string>>({});
  const [numF, setNumF] = useState<Record<string, { op: string; value: string }>>({});
  const [enumF, setEnumF] = useState<Record<string, string[]>>({});
  const [dateF, setDateF] = useState<Record<string, { from: string; to: string }>>({});
  const [statusF, setStatusF] = useState<Record<string, "" | "yes" | "no">>({});
  const [loadErr, setLoadErr] = useState<string | null>(null);

  const product = PRODUCTS.find((p) => p.key === tab)!;
  // a profile column whose key is already a product column (e.g. public_id on VSAT,
  // cs_completion_rate on CodeSprint) would render twice — the product column wins
  const profileCols = useMemo(() => PROFILE_COLS.filter((pc) => !product.cols.some((c) => c.key === pc.key)), [product]);
  // columns whose source may not exist on every database (VSAT payments): hide them
  // when the RPC didn't return the key at all, rather than showing everyone as "Not paid"
  const allCols = useMemo(() => {
    const missing = (k: string) => OPTIONAL_KEYS.has(k) && rows.length > 0 && !rows.some((r) => k in r);
    return [...product.cols.filter((c) => !missing(c.key)), ...profileCols];
  }, [product, profileCols, rows]);
  const shownCols = allCols.filter((c) => visible[tab].has(c.key));
  const addedProfileCount = [...visible[tab]].filter((k) => profileCols.some((c) => c.key === k)).length;

  useEffect(() => {
    let on = true;
    setLoading(true); setSelected(new Set()); setTextF({}); setNumF({}); setEnumF({}); setDateF({}); setStatusF({});
    setLoadErr(null);
    (async () => {
      // The Supabase API caps each response (~1000 rows), so read the RPC page by page
      // until a page comes back empty. The RPCs order by a unique user_id tie-breaker,
      // so pages don't overlap; the Map is a second guard against duplicates.
      const PAGE = 1000;
      const byId = new Map<string, Row>();
      let err: string | null = null;
      for (let from = 0, guard = 0; guard < 500; guard++) {
        const { data, error } = await supabase.rpc(product.rpc).range(from, from + PAGE - 1);
        if (error) { err = error.message; break; }
        const chunk = (data as Row[]) ?? [];
        if (!chunk.length) break;
        for (const r of chunk) byId.set(r.user_id, r);
        from += chunk.length;
      }
      if (on) { setRows([...byId.values()]); setLoadErr(err); setLoading(false); }
    })();
    return () => { on = false; };
  }, [supabase, product.rpc, tab]);

  const enumOptions = useMemo(() => {
    const o: Record<string, string[]> = {};
    shownCols.filter((c) => c.type === "enum" || c.type === "tags").forEach((c) => {
      const vals = c.type === "tags" ? rows.flatMap((r) => { const v = getVal(r, c); return Array.isArray(v) ? v.map(String) : []; }) : rows.map((r) => str(getVal(r, c)));
      o[c.key] = Array.from(new Set(vals)).filter(Boolean).sort();
    });
    return o;
  }, [rows, shownCols]);

  const anyFilter = q.trim() !== "" || Object.values(textF).some(Boolean) || Object.values(numF).some((f) => f?.value) || Object.values(enumF).some((a) => a?.length)
    || Object.values(dateF).some((d) => d?.from || d?.to) || Object.values(statusF).some(Boolean);
  function clearFilters() { setQ(""); setTextF({}); setNumF({}); setEnumF({}); setDateF({}); setStatusF({}); }

  // split on comma / slash / newline → multiple values match as OR ("anil, arjit")
  const splitTerms = (s: string) => s.split(/[,/\n]/).map((x) => x.trim().toLowerCase()).filter(Boolean);

  const filtered = useMemo(() => {
    const qTerms = splitTerms(q);
    const qColDef = qCol ? allCols.find((c) => c.key === qCol) : null;
    return rows.filter((r) => {
      if (qTerms.length) {
        const hay = qColDef
          ? str(getVal(r, qColDef)).toLowerCase()
          : [r.full_name, r.email, r.phone, r.public_id].map((x) => String(x ?? "").toLowerCase()).join(" ");
        if (!qTerms.some((t) => hay.includes(t))) return false;
      }
      for (const c of shownCols) {
        if (c.type === "enum") { const sel = enumF[c.key]; if (sel?.length && !sel.includes(str(getVal(r, c)))) return false; }
        else if (c.type === "tags") { const sel = enumF[c.key]; if (sel?.length) { const v = getVal(r, c); const have = Array.isArray(v) ? v.map(String) : []; if (!sel.some((s) => have.includes(s))) return false; } }
        else if (c.type === "status") { const s = statusF[c.key]; if (s && (s === "yes") !== truthy(getVal(r, c))) return false; }
        else if (c.type === "date") { const d = dateF[c.key]; if (d?.from || d?.to) { const day = istYmd(getVal(r, c)); if (!day) return false; if (d.from && day < d.from) return false; if (d.to && day > d.to) return false; } }
        else if (c.type === "num" || c.type === "pct") { const f = numF[c.key]; if (f?.value) { const n = Number(getVal(r, c)); const v = Number(f.value); const ok = f.op === ">=" ? n >= v : f.op === "<=" ? n <= v : f.op === ">" ? n > v : f.op === "<" ? n < v : n === v; if (!ok) return false; } }
        else if (c.type === "text" || c.type === "name" || c.type === "id") {
          const terms = splitTerms(textF[c.key] || "");
          if (terms.length) { const hay = str(getVal(r, c)).toLowerCase(); if (!terms.some((t) => hay.includes(t))) return false; }
        }
      }
      return true;
    });
  }, [rows, q, qCol, allCols, shownCols, enumF, numF, textF, dateF, statusF]);

  // paging (selection, export and comms still apply to the whole filtered set)
  const totalPages = perPage ? Math.max(1, Math.ceil(filtered.length / perPage)) : 1;
  const curPage = Math.min(page, totalPages);
  const paged = perPage ? filtered.slice((curPage - 1) * perPage, curPage * perPage) : filtered;
  useEffect(() => { setPage(1); }, [tab, q, qCol, perPage, textF, numF, enumF, dateF, statusF]);

  const targets = selected.size ? filtered.filter((r) => selected.has(r.user_id)) : filtered;
  const allSel = filtered.length > 0 && filtered.every((r) => selected.has(r.user_id));
  const toggleAll = () => setSelected((prev) => { const n = new Set(prev); allSel ? filtered.forEach((r) => n.delete(r.user_id)) : filtered.forEach((r) => n.add(r.user_id)); return n; });
  const toggleRow = (id: string) => setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  // state / city / points come from the joined profile so WhatsApp {{n}} variables mapped to them aren't blank
  const recipients = targets.map((r) => {
    const pf = (r.profile ?? {}) as Record<string, unknown>;
    return {
      user_id: r.user_id, email: (r.email as string) ?? null, phone: (r.phone as string) ?? null, full_name: (r.full_name as string) ?? null,
      state: (pf.state as string) ?? null, city: (pf.city as string) ?? null, points: Number(pf.total_points ?? 0) || 0,
    };
  });

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
    if (c.type === "date") return <span className="tabular-nums text-white/55">{istDate(v)}</span>;
    if (c.type === "id") return <span className="rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-[11px] text-white/55">{str(v) || "—"}</span>;
    if (c.type === "tags") return <span className="flex flex-wrap gap-1">{(Array.isArray(v) ? v : []).map((t, i) => <span key={i} className="rounded-md bg-[color:rgb(var(--accent))]/15 px-1.5 py-0.5 text-[10px] font-medium text-[color:rgb(var(--accent))]">{String(t)}</span>)}</span>;
    if (c.type === "pct") { const n = v == null ? null : Number(v); return <span className="inline-flex items-center gap-2"><span className="h-1.5 w-20 overflow-hidden rounded-full bg-white/10"><span className="block h-full rounded-full bg-[color:rgb(var(--accent))] transition-all" style={{ width: `${Math.max(3, n ?? 0)}%` }} /></span><span className="w-9 text-xs tabular-nums text-white/80">{n == null ? "—" : n + "%"}</span></span>; }
    if (c.type === "num") return <span className="tabular-nums text-white/85">{v == null ? "—" : str(v)}</span>;
    if (c.key === "full_name") return (
      <span className="flex items-center gap-2.5">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-white/10 text-[11px] font-semibold text-white/75">{initials(v)}</span>
        <span className="font-semibold text-white">{str(v) || "—"}</span>
      </span>
    );
    if (c.key === "email") return <span className="text-white/55">{str(v) || "—"}</span>;
    if (c.key === "phone") return <span className="font-mono text-[12px] text-white/55">{str(v) || "—"}</span>;
    return <span className="text-white/75">{str(v) || "—"}</span>;
  }

  // shared field/button shells — one uniform dark style across search, Columns, Export
  const shell = "inline-flex h-10 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.05] px-3.5 text-sm font-medium text-white/85 transition-colors hover:border-white/25 hover:bg-white/[0.08]";
  const stickyBg = "bg-[#0c1226]";
  const fieldInput = "w-full rounded-lg border border-white/10 bg-white/[0.05] px-2 py-1 font-mono text-[11px] text-white outline-none transition-colors focus:border-[color:rgb(var(--accent))] [color-scheme:dark]";

  return (
    <div className="neural-glass relative min-h-screen" style={{ background: "#070a16", color: "#f2f5ff" }}>
      <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(760px 440px at 85% -6%, rgba(139,92,246,.14), transparent 60%), radial-gradient(620px 420px at -6% 108%, rgba(34,211,238,.09), transparent 60%)" }} />
      <div className="relative mx-auto max-w-[1600px] px-6 py-8 font-[family-name:var(--font-inter)] text-white">
      {/* ── header ───────────────────────────────── */}
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-4xl font-bold tracking-tight" style={{ fontFamily: "var(--font-outfit), system-ui, sans-serif", background: "linear-gradient(92deg,#8b5cf6,#c4b5fd 85%)", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent", filter: "drop-shadow(0 0 26px rgba(139,92,246,.25))" }}>Product Users</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex h-10 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.05] px-3 transition-colors focus-within:border-[color:rgb(var(--accent))]">
            <span className="text-white/40"><IconSearch /></span>
            <input value={q} onChange={(e) => setQ(e.target.value)}
              placeholder={qCol ? `Paste ${(allCols.find((c) => c.key === qCol)?.label || "values")}, comma separated` : "Search name, email, Vedam ID"}
              className="w-64 bg-transparent text-sm text-white outline-none placeholder:text-white/35" />
            {q && <button onClick={() => setQ("")} className="text-white/35 hover:text-white/70">✕</button>}
          </div>
          <DarkSelect className="w-44" value={qCol} onChange={setQCol} placeholder="All fields"
            options={[{ value: "", label: "All fields" }, ...allCols.map((c) => ({ value: c.key, label: c.label }))]} />
          <button onClick={() => setShowCols(true)} className={shell}>
            <IconColumns /> Columns
            {addedProfileCount > 0 && <span className="rounded-full bg-[color:rgb(var(--accent))] px-1.5 text-[10px] font-bold text-white">{addedProfileCount}</span>}
          </button>
          <button onClick={exportCsv} disabled={!targets.length} className={shell + " disabled:opacity-40"}>
            <span className="text-[color:rgb(var(--accent))]"><IconDownload /></span> Export CSV
          </button>
        </div>
      </div>

      {/* ── product tabs ─────────────────────────── */}
      <div className="mb-5 inline-flex max-w-full gap-1 overflow-x-auto rounded-xl border border-white/10 bg-white/[0.04] p-1">
        {PRODUCTS.map((p) => (
          <button key={p.key} onClick={() => setTab(p.key)}
            className={["flex items-center gap-2 whitespace-nowrap rounded-lg px-4 py-2 text-sm font-semibold transition-colors", p.key === tab ? "bg-white/[0.1] text-white shadow-sm" : "text-white/45 hover:bg-white/5 hover:text-white/80"].join(" ")}>
            {p.label}
            {p.key === tab && <span className="rounded-full bg-[color:rgb(var(--accent))]/25 px-2 text-[11px] font-bold tabular-nums text-[color:rgb(var(--accent))]">{rows.length}</span>}
          </button>
        ))}
      </div>

      {/* ── stat / filter bar ────────────────────── */}
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <span className="text-white/55"><b className="font-semibold text-white tabular-nums">{filtered.length}</b> of <span className="tabular-nums">{rows.length}</span> users</span>
        <span className="font-mono text-[11px] text-white/35">base: {product.base}</span>
        <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-white/35"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-[color:rgb(var(--accent))]/25 ring-1 ring-inset ring-[color:rgb(var(--accent))]/40" /> profile column</span>
        {loadErr && rows.length > 0 && <span className="rounded-md bg-amber-400/10 px-2 py-0.5 text-xs text-amber-300 ring-1 ring-inset ring-amber-400/25">Only part of the list loaded — refresh to retry ({loadErr})</span>}
        {anyFilter && <button onClick={clearFilters} className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1 text-xs font-medium text-white/60 transition-colors hover:border-white/25 hover:text-white">Clear filters</button>}
      </div>

      {/* ── selection bar ────────────────────────── */}
      {selected.size > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-3 rounded-xl border border-[color:rgb(var(--accent))]/30 bg-[color:rgb(var(--accent))]/[0.1] px-4 py-2.5">
          <span className="inline-flex items-center gap-2 text-sm font-semibold text-white"><span className="grid h-6 min-w-[1.5rem] place-items-center rounded-full bg-[color:rgb(var(--accent))] px-1 text-xs font-bold tabular-nums text-white">{selected.size}</span> selected</span>
          <span className="flex-1" />
          <button onClick={exportCsv} className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/[0.06] px-3 py-1.5 text-sm font-medium text-white/85 transition-colors hover:bg-white/10"><IconDownload /> Export</button>
          <button onClick={() => setComm("email")} className="inline-flex items-center gap-1.5 rounded-lg bg-[color:rgb(var(--accent))] px-3.5 py-1.5 text-sm font-semibold text-white transition-[filter] hover:brightness-110"><IconSend /> Send Communication</button>
          <button onClick={() => setSelected(new Set())} className="rounded-lg border border-white/15 bg-white/[0.06] px-3 py-1.5 text-sm font-medium text-white/70 transition-colors hover:bg-white/10">Clear</button>
        </div>
      )}

      {/* ── table ────────────────────────────────── */}
      {loading ? (
        <div className="space-y-2 rounded-2xl border border-white/10 bg-white/[0.02] p-4">
          {Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-11 animate-pulse rounded-lg bg-white/[0.05]" style={{ opacity: 1 - i * 0.1 }} />)}
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02]">
          <div className="max-h-[70vh] overflow-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead className="sticky top-0 z-10">
                <tr>
                  <th className={`sticky left-0 z-20 px-4 py-3 ${stickyBg}`}><input type="checkbox" checked={allSel} onChange={toggleAll} className="h-4 w-4 accent-[color:rgb(var(--accent))]" /></th>
                  {shownCols.map((c) => (
                    <th key={c.key} className={["whitespace-nowrap px-3 py-3 font-mono text-[10px] font-semibold uppercase tracking-wider", stickyBg, c.group === "profile" ? "text-[color:rgb(var(--accent))]/80" : "text-white/40"].join(" ")}>{c.label}</th>
                  ))}
                </tr>
                <tr>
                  <th className={`sticky left-0 z-20 px-4 py-1.5 ${stickyBg}`} />
                  {shownCols.map((c) => (
                    <th key={c.key} className={`px-2 py-1.5 align-top ${stickyBg}`}>
                      {(c.type === "enum" || c.type === "tags") ? (
                        <MultiPick options={enumOptions[c.key] || []} value={enumF[c.key] || []}
                          onChange={(v) => setEnumF((f) => ({ ...f, [c.key]: v }))} className={fieldInput + " min-w-[96px]"} />
                      ) : c.type === "status" ? (
                        <select value={statusF[c.key] || ""} onChange={(e) => setStatusF((f) => ({ ...f, [c.key]: e.target.value as "" | "yes" | "no" }))} className={fieldInput + " min-w-[96px]"}>
                          <option value="">All</option>
                          <option value="yes">{statusLabels(c.key)[0]}</option>
                          <option value="no">{statusLabels(c.key)[1]}</option>
                        </select>
                      ) : c.type === "date" ? (
                        <div className="flex min-w-[118px] flex-col gap-1">
                          <input type="date" aria-label={`${c.label} from`} title="From" value={dateF[c.key]?.from || ""}
                            onChange={(e) => setDateF((f) => ({ ...f, [c.key]: { from: e.target.value, to: f[c.key]?.to || "" } }))} className={fieldInput} />
                          <input type="date" aria-label={`${c.label} to`} title="To" value={dateF[c.key]?.to || ""} min={dateF[c.key]?.from || undefined}
                            onChange={(e) => setDateF((f) => ({ ...f, [c.key]: { from: f[c.key]?.from || "", to: e.target.value } }))} className={fieldInput} />
                        </div>
                      ) : (c.type === "num" || c.type === "pct") ? (
                        <div className="flex gap-1">
                          <select value={(numF[c.key]?.op) || ">="} onChange={(e) => setNumF((f) => ({ ...f, [c.key]: { op: e.target.value, value: f[c.key]?.value || "" } }))} className={fieldInput + " w-auto"}>
                            <option value=">=">≥</option><option value="<=">≤</option><option value=">">&gt;</option><option value="<">&lt;</option><option value="=">=</option>
                          </select>
                          <input value={numF[c.key]?.value || ""} onChange={(e) => setNumF((f) => ({ ...f, [c.key]: { op: f[c.key]?.op || ">=", value: e.target.value } }))} inputMode="numeric" placeholder="#" className={fieldInput + " min-w-[42px]"} />
                        </div>
                      ) : (c.type === "text" || c.type === "name" || c.type === "id") ? (
                        <input value={textF[c.key] || ""} onChange={(e) => setTextF((f) => ({ ...f, [c.key]: e.target.value }))} placeholder="filter" className={fieldInput + " min-w-[70px]"} />
                      ) : null}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={shownCols.length + 1} className="px-3 py-16 text-center text-white/45">
                    <IconInbox />
                    <p className="mt-3 font-semibold text-white/75">{loadErr ? "Couldn't load users" : "No users match"}</p>
                    <p className="text-sm text-white/40">{loadErr ? loadErr : anyFilter ? "Try clearing the filters." : "This product has no users yet."}</p>
                  </td></tr>
                ) : paged.map((r) => {
                  const on = selected.has(r.user_id);
                  return (
                    <tr key={r.user_id}
                      onClick={(e) => {
                        // ignore clicks on links/buttons and when the user is selecting text
                        if ((e.target as HTMLElement).closest("a,button")) return;
                        if (window.getSelection()?.toString()) return;
                        toggleRow(r.user_id);
                      }}
                      className={["cursor-pointer border-t border-white/[0.06] transition-colors", on ? "bg-[color:rgb(var(--accent))]/10" : "hover:bg-white/[0.035]"].join(" ")}>
                      <td onClick={(e) => e.stopPropagation()} className={["sticky left-0 z-[1] px-4 py-3", on ? "bg-[#161038]" : "bg-[#070a16]"].join(" ")}><input type="checkbox" checked={on} onChange={() => toggleRow(r.user_id)} className="h-4 w-4 cursor-pointer accent-[color:rgb(var(--accent))]" /></td>
                      {shownCols.map((c) => (
                        <td key={c.key} className={["whitespace-nowrap px-3 py-3", c.group === "profile" ? "bg-[color:rgb(var(--accent))]/[0.05]" : ""].join(" ")}>{renderCell(r, c)}</td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── pagination ───────────────────────────── */}
      {!loading && filtered.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <span className="text-sm text-white/55">
            Showing <b className="font-semibold text-white tabular-nums">{perPage ? (curPage - 1) * perPage + 1 : 1}–{perPage ? Math.min(curPage * perPage, filtered.length) : filtered.length}</b> of <span className="tabular-nums">{filtered.length}</span>
          </span>
          <div className="flex items-center gap-2">
            <span className="font-mono text-[11px] uppercase tracking-wider text-white/35">Per page</span>
            <DarkSelect className="w-28" value={String(perPage)} onChange={(v) => setPerPage(Number(v))}
              options={[10, 25, 50, 100, 500, 1000].map((n) => ({ value: String(n), label: String(n) })).concat([{ value: "0", label: "All" }])} />
          </div>
          {perPage > 0 && totalPages > 1 && (
            <div className="ml-auto flex items-center gap-2">
              <button onClick={() => setPage(Math.max(1, curPage - 1))} disabled={curPage <= 1}
                className="rounded-lg border border-white/15 bg-white/[0.06] px-3 py-1.5 text-sm font-medium text-white/80 hover:bg-white/10 disabled:opacity-35">Prev</button>
              <span className="font-mono text-xs tabular-nums text-white/55">Page {curPage} / {totalPages}</span>
              <button onClick={() => setPage(Math.min(totalPages, curPage + 1))} disabled={curPage >= totalPages}
                className="rounded-lg border border-white/15 bg-white/[0.06] px-3 py-1.5 text-sm font-medium text-white/80 hover:bg-white/10 disabled:opacity-35">Next</button>
            </div>
          )}
        </div>
      )}

      <p className="mt-3 font-mono text-[11px] text-white/35">Actions apply to {selected.size ? `${selected.size} selected` : `${filtered.length} filtered`} (all pages) · tip: comma-separate values in any filter · joined to vedam_one_profiles</p>

      {/* ── Customize columns drawer ─────────────── */}
      {showCols && (
        <>
          <div className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm" onClick={() => setShowCols(false)} />
          <div className="fixed right-0 top-0 z-50 flex h-full w-[min(430px,100%)] flex-col border-l border-white/10 bg-[#0d1430] text-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
              <div><h2 className="text-base font-bold text-white">Customize columns</h2><p className="text-xs text-white/45">Product columns show by default.</p></div>
              <button onClick={() => setShowCols(false)} className="grid h-8 w-8 place-items-center rounded-lg border border-white/10 text-white/60 transition-colors hover:text-white"><IconClose /></button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4">
              <input value={colSearch} onChange={(e) => setColSearch(e.target.value)} placeholder="Search columns" className="mb-4 w-full rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2 text-sm text-white outline-none transition-colors focus:border-[color:rgb(var(--accent))] placeholder:text-white/35" />
              <div className="mb-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-white/40"><span className="h-2 w-2 rounded-sm bg-white/40" /> Product · {product.base}</div>
              {product.cols.filter((c) => c.label.toLowerCase().includes(colSearch.toLowerCase())).map((c) => {
                const on = visible[tab].has(c.key);
                return (
                  <label key={c.key} className="flex cursor-pointer items-center gap-3 rounded-xl px-2.5 py-2 transition-colors hover:bg-white/5">
                    <input type="checkbox" checked={on} onChange={() => toggleCol(c.key)} className="h-4 w-4 accent-[color:rgb(var(--accent))]" />
                    <span className={["text-sm", on ? "font-medium text-white" : "text-white/50"].join(" ")}>{c.label}</span>
                  </label>
                );
              })}
              <div className="mb-2 mt-5 flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-[color:rgb(var(--accent))]"><span className="h-2 w-2 rounded-sm bg-[color:rgb(var(--accent))]" /> Profile · vedam_one_profiles</div>
              {profileCols.filter((c) => c.label.toLowerCase().includes(colSearch.toLowerCase())).map((c) => {
                const on = visible[tab].has(c.key);
                return (
                  <label key={c.key} className="flex cursor-pointer items-center gap-3 rounded-xl px-2.5 py-2 transition-colors hover:bg-white/5">
                    <input type="checkbox" checked={on} onChange={() => toggleCol(c.key)} className="h-4 w-4 accent-[color:rgb(var(--accent))]" />
                    <span className={["text-sm", on ? "font-medium text-[color:rgb(var(--accent))]" : "text-white/50"].join(" ")}>{c.label}</span>
                  </label>
                );
              })}
            </div>
            <div className="flex items-center gap-2 border-t border-white/10 px-5 py-4">
              <span className="mr-auto font-mono text-[11px] text-white/40">{shownCols.length} shown</span>
              <button onClick={resetCols} className="rounded-xl border border-white/10 px-3 py-2 text-sm font-medium text-white/85 transition-colors hover:border-white/25">Reset</button>
              <button onClick={() => setShowCols(false)} className="rounded-xl bg-[color:rgb(var(--accent))] px-5 py-2 text-sm font-semibold text-white transition-[filter] hover:brightness-110">Done</button>
            </div>
          </div>
        </>
      )}

      {/* ── Send Communication modal (reuses CommsBroadcast) ── */}
      {comm && (
        <>
          <div className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm" onClick={() => setComm(null)} />
          <div className="fixed left-1/2 top-6 z-50 w-[min(780px,94%)] -translate-x-1/2 overflow-hidden rounded-2xl border border-white/10 bg-[#0d1430] text-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
              <h2 className="flex items-center gap-2.5 text-base font-bold text-white">Send Communication <span className="rounded-full bg-[color:rgb(var(--accent))]/15 px-2.5 py-0.5 text-xs font-semibold text-[color:rgb(var(--accent))]">{recipients.length} recipient{recipients.length === 1 ? "" : "s"}</span></h2>
              <button onClick={() => setComm(null)} className="grid h-8 w-8 place-items-center rounded-lg border border-white/10 text-white/60 transition-colors hover:text-white"><IconClose /></button>
            </div>
            <div className="flex gap-1 px-5 pt-3">
              {(["email", "whatsapp"] as const).map((ch) => (
                <button key={ch} onClick={() => setComm(ch)} className={["inline-flex items-center gap-2 rounded-t-xl border border-b-0 px-4 py-2 text-sm font-semibold transition-colors", comm === ch ? "border-white/10 bg-white/[0.04] text-white" : "border-transparent text-white/45 hover:text-white/80"].join(" ")}>
                  {ch === "email" ? <IconMail /> : <IconChat />}{ch === "email" ? "Email" : "WhatsApp"}
                </button>
              ))}
            </div>
            <div className="max-h-[74vh] overflow-y-auto border-t border-white/10 px-1 py-1">
              <CommsBroadcast channel={comm} product="all" overrideRecipients={recipients} />
            </div>
          </div>
        </>
      )}
      </div>
    </div>
  );
}

"use client";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import { cx, vx } from "@/components/admin/ui/vx";
import { PageHead } from "@/components/admin/ui/page-head";
import { FacetPick, type Opt } from "@/components/admin/vsat-pipeline/facet-pick";
import { DeletePerson } from "@/components/admin/vsat-delete-person";
import { CommsBroadcast } from "@/components/admin/comms-broadcast";
import { RefreshShimmer, useRefreshShimmer } from "@/components/admin/ui/refresh-shimmer";
import {
  DEFAULT_LEAD_COLUMNS, FILTER_OPS, GROUP_ORDER, LEAD_NAME_COL, VALUE_CHOICES, campusLabel, columnLabel,
  describeClause, filterInputType, formatValue, isFilterable, loadCols, opArity, parseSearchValues,
  saveCols, sanitizeColumns, stageLabel, toCsv,
  type FilterClause, type GridColumn, type LeadRow, type LeadsColumnsResult, type LeadsResult, type GridSearch,
} from "@/lib/vsat/leads-grid";

/**
 * VSAT Leads — EVERYONE who filled the first half of the form (a lead_manager row), whether or not
 * they went on to apply/pay. Brought to parity with the VSAT Applications grid (0159): a Columns
 * drawer, per-column advanced Filters, multi-value field-scoped search, row selection and bulk
 * Export CSV / Send Communication. Data comes only from vsat_leads_grid_columns / vsat_leads_grid_list
 * / vsat_leads_grid_export — the database re-checks role, campus scope and column visibility on every call.
 */

const PAGE = 50;
const input = vx.field;
const ghost = cx(vx.btn, vx.secondary);
const STICKY_BG = "bg-[#100d2a]";

/* ── line icons (no emoji) ───────────────────────────── */
const Svg = (p: { children: ReactNode }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">{p.children}</svg>
);
const IconFilter = () => <Svg><path d="M3 4h18l-7 8v6l-4 2v-8z" /></Svg>;
const IconColumns = () => <Svg><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 3v18M15 3v18" /></Svg>;
const IconDownload = () => <Svg><path d="M12 15V3M8 7l4-4 4 4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" /></Svg>;
const IconSend = () => <Svg><path d="m22 2-7 20-4-9-9-4z" /><path d="M22 2 11 13" /></Svg>;
const IconMail = () => <Svg><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></Svg>;
const IconChat = () => <Svg><path d="M21 11.5a8.5 8.5 0 0 1-12.6 7.5L3 21l2-5.4A8.5 8.5 0 1 1 21 11.5z" /></Svg>;
const IconClose = () => <Svg><path d="M18 6 6 18M6 6l12 12" /></Svg>;

export function VsatLeadsPanel() {
  const [supabase] = useState(() => createClient());
  const [isAdmin, setIsAdmin] = useState(false);
  const [catalog, setCatalog] = useState<GridColumn[]>([]);
  const [campuses, setCampuses] = useState<string[]>([]);
  const [leadStages, setLeadStages] = useState<string[]>([]);
  const [applied, setApplied] = useState<string[]>([]);   // ['yes'] | ['no'] | [] (both/none → no filter)
  const [sources, setSources] = useState<string[]>([]);
  const [filterClauses, setFilterClauses] = useState<FilterClause[]>([]);
  const [showFilters, setShowFilters] = useState(false);
  const [searchCol, setSearchCol] = useState("_any");
  const [searchText, setSearchText] = useState("");
  const [search, setSearch] = useState<GridSearch | null>(null);
  const [cols, setCols] = useState<string[]>(DEFAULT_LEAD_COLUMNS);
  const [showCols, setShowCols] = useState(false);
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<LeadsResult | null>(null);
  const [loading, setLoading] = useState(true);
  // Refresh button: blur + sweep of light over the table until the new data is in (the old rows stay on screen meanwhile)
  const shimmer = useRefreshShimmer(loading);
  const [err, setErr] = useState("");
  const [reload, setReload] = useState(0);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<"" | "csv" | "comms">("");
  const [notice, setNotice] = useState("");
  const [comm, setComm] = useState<null | "email" | "whatsapp">(null);
  const [recipients, setRecipients] = useState<{ user_id: string; email: string | null; phone: string | null; full_name: string | null; state: string | null; city: string | null }[]>([]);

  useEffect(() => {
    let on = true;
    void supabase.rpc("is_admin").then(({ data: a }) => { if (on) setIsAdmin(a === true); });
    void supabase.rpc("vsat_leads_grid_columns").then(({ data: d, error }) => {
      if (!on) return;
      if (error || !d) { setErr("Couldn’t load the columns. Refresh and try again."); setLoading(false); return; }
      const res = d as LeadsColumnsResult;
      setCatalog(res.columns);
      setCols(sanitizeColumns(loadCols(), res.columns, DEFAULT_LEAD_COLUMNS));
    });
    return () => { on = false; };
  }, [supabase]);

  // search: wait until typing stops; values under 2 characters are dropped (the database refuses them)
  useEffect(() => {
    const t = setTimeout(() => {
      const values = parseSearchValues(searchText);
      setSearch(values.length ? { column: searchCol, values } : null);
      setOffset(0);
    }, 350);
    return () => clearTimeout(t);
  }, [searchText, searchCol]);

  const byKey = useMemo(() => new Map(catalog.map((c) => [c.key, c])), [catalog]);
  const shownCols = useMemo(() => cols.map((k) => byKey.get(k)).filter((c): c is GridColumn => !!c), [cols, byKey]);

  const filters = useCallback((): Record<string, unknown> => {
    const p: Record<string, unknown> = {};
    if (campuses.length) p.campuses = campuses;
    if (leadStages.length) p.lead_stages = leadStages;
    if (applied.length === 1) p.applied = applied[0];     // both/none → don't filter
    if (sources.length) p.sources = sources;
    if (filterClauses.length) p.filters = filterClauses;
    if (search) p.search = search;
    return p;
  }, [campuses, leadStages, applied, sources, filterClauses, search]);

  const load = useCallback(async () => {
    if (!catalog.length) return;
    setLoading(true); setErr("");
    const p = { ...filters(), columns: cols, limit: PAGE, offset };
    const { data: d, error } = await supabase.rpc("vsat_leads_grid_list", { p });
    if (error) { setErr("Something went wrong loading the leads. Try again."); setData(null); } else setData(d as LeadsResult);
    setSel(new Set());
    setLoading(false);
  }, [supabase, catalog.length, filters, cols, offset]);
  useEffect(() => { void load(); }, [load, reload]);

  const rows = useMemo(() => data?.rows ?? [], [data]);
  const keepRows = shimmer.on && rows.length > 0;
  const facets = data?.facets ?? null;
  const total = data?.total ?? 0;
  const anyFilter = campuses.length > 0 || leadStages.length > 0 || applied.length > 0 || sources.length > 0 || filterClauses.length > 0 || !!search;
  const allOnPage = rows.length > 0 && rows.every((r) => sel.has(r.lead_id));

  const campusOpts: Opt[] = [
    { value: "pune", label: "Pune", count: facets ? facets.campus.pune ?? 0 : null },
    { value: "gurugram", label: "Gurugram", count: facets ? facets.campus.gurugram ?? 0 : null },
  ];
  const stageOpts: Opt[] = useMemo(() => {
    const keys = new Set<string>([...leadStages, ...(facets ? Object.keys(facets.lead_stage) : [])]);
    return [...keys].filter((k) => k !== "none").sort()
      .map((k) => ({ value: k, label: stageLabel(k), count: facets ? facets.lead_stage[k] ?? 0 : null }));
  }, [facets, leadStages]);
  const appliedOpts: Opt[] = [
    { value: "yes", label: "Applied", count: facets ? facets.applied.yes ?? 0 : null },
    { value: "no", label: "Not applied", count: facets ? facets.applied.no ?? 0 : null },
  ];
  const sourceOpts: Opt[] = useMemo(() => {
    const keys = new Set<string>([...sources, ...(facets ? Object.keys(facets.source) : [])]);
    return [...keys].filter((k) => k !== "none").sort()
      .map((k) => ({ value: k, label: k, count: facets ? facets.source[k] ?? 0 : null }));
  }, [facets, sources]);

  const searchable = useMemo(() => catalog.filter((c) => !c.virtual && ["text", "num", "date", "ts"].includes(c.type))
    .sort((a, b) => columnLabel(a.key).localeCompare(columnLabel(b.key))), [catalog]);
  const filterable = useMemo(() => catalog.filter(isFilterable)
    .sort((a, b) => columnLabel(a.key).localeCompare(columnLabel(b.key))), [catalog]);

  function clearFilters() { setCampuses([]); setLeadStages([]); setApplied([]); setSources([]); setFilterClauses([]); setSearchText(""); setOffset(0); }
  function toggle(id: string) { setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; }); }
  function setColumns(next: string[]) { setCols(next); saveCols(next); setOffset(0); }

  // whole filtered set (or the selection) from the database — admin / admissions only, audited there
  async function pull(purpose: "csv" | "comms") {
    setBusy(purpose); setNotice("");
    const p: Record<string, unknown> = { ...filters(), purpose };
    if (sel.size) p.lead_ids = [...sel];
    if (purpose === "csv") p.columns = cols;
    const { data: d, error } = await supabase.rpc("vsat_leads_grid_export", { p });
    setBusy("");
    if (error) { setNotice(/TOO_MANY_ROWS/.test(error.message) ? "Too many leads match (over 5,000) — narrow the filters first." : "Couldn’t load the leads. Try again."); return null; }
    return d as { total: number; rows: LeadRow[] };
  }
  async function exportCsv() {
    const d = await pull("csv");
    if (!d) return;
    const csv = toCsv(d.rows, shownCols.map((c) => ({ key: c.key, type: c.type })));
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `vsat-leads-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(a.href);
    setNotice(`Exported ${d.total} lead${d.total === 1 ? "" : "s"}.`);
  }
  async function openComms() {
    const d = await pull("comms");
    if (!d) return;
    if (d.total === 0) { setNotice("No leads match these filters to message."); return; }
    setRecipients(d.rows.map((r) => ({
      user_id: r.lead_id, email: (r.email as string | null) ?? null, phone: (r.mobile as string | null) ?? null,
      full_name: (r.name as string | null) ?? null, state: null, city: null,
    })));
    setComm("email");
  }

  return (
    <div className="space-y-4 p-4 font-sans text-vx-ink sm:p-8">
      <PageHead title="VSAT Leads" count={`${loading && !data ? "…" : total.toLocaleString("en-IN")} lead${total === 1 ? "" : "s"}${anyFilter ? " match" : ""}`} />

      {/* ── filters ───────────────────────────────── */}
      <div className="flex flex-wrap items-start gap-2">
        <div className="flex h-10 items-stretch overflow-hidden rounded-[11px] border border-vx-line2 bg-black/20 focus-within:border-vx-violet focus-within:ring-2 focus-within:ring-vx-violet/30">
          <select className="border-r border-vx-line bg-transparent px-2 py-2 text-sm text-vx-ink focus:outline-none" value={searchCol}
            onChange={(e) => setSearchCol(e.target.value)} aria-label="Search column">
            <option value="_any">Name, email, mobile</option>
            {searchable.map((c) => <option key={c.key} value={c.key}>{columnLabel(c.key)}</option>)}
          </select>
          <textarea className="w-56 resize-none bg-transparent px-3 py-2 text-sm sm:w-72 text-vx-ink placeholder:text-vx-faint focus:outline-none" rows={1}
            placeholder={searchCol === "_any" ? "Search…" : `Paste ${columnLabel(searchCol).toLowerCase()} values, one per line or comma-separated`}
            value={searchText} onChange={(e) => setSearchText(e.target.value)} maxLength={20000} aria-label="Search values" />
        </div>
        <FacetPick title="Campus" options={campusOpts} value={campuses} onChange={(v) => { setCampuses(v); setOffset(0); }} />
        <FacetPick title="Stage" options={stageOpts} value={leadStages} onChange={(v) => { setLeadStages(v); setOffset(0); }} />
        <FacetPick title="Applied" options={appliedOpts} value={applied} onChange={(v) => { setApplied(v); setOffset(0); }} />
        {sourceOpts.length > 1 && <FacetPick title="Source" options={sourceOpts} value={sources} onChange={(v) => { setSources(v); setOffset(0); }} />}
        <span className="flex-1" />
        <button className={`${ghost} inline-flex items-center gap-2 ${filterClauses.length ? "border-vx-violet/50 text-vx-ink" : ""}`} onClick={() => setShowFilters(true)} disabled={!catalog.length}>
          <IconFilter /> Filters{filterClauses.length > 0 && <span className="rounded-full bg-vx-violet/20 px-1.5 text-[11px] tabular-nums text-vx-violet-t">{filterClauses.length}</span>}
        </button>
        <button className={`${ghost} inline-flex items-center gap-2`} onClick={() => setShowCols(true)} disabled={!catalog.length}>
          <IconColumns /> Columns <span className="rounded-full bg-white/10 px-1.5 text-[11px] tabular-nums">{shownCols.length}</span>
        </button>
        <button className={`${ghost} inline-flex items-center gap-2`} onClick={() => void exportCsv()} disabled={busy !== "" || loading || total === 0}>
          <IconDownload /> {busy === "csv" ? "Exporting…" : sel.size ? `Export ${sel.size}` : "Export CSV"}
        </button>
        <button className={ghost} onClick={() => { shimmer.start(); setReload((n) => n + 1); }}>Refresh</button>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-vx-mut">
        {search && <span className="text-xs text-vx-faint">{search.values.length} search value{search.values.length === 1 ? "" : "s"} on {searchCol === "_any" ? "all fields" : columnLabel(searchCol)}</span>}
        {anyFilter && <button className="text-xs text-vx-mut underline-offset-2 hover:text-vx-ink hover:underline" onClick={clearFilters}>Clear filters</button>}
        {notice && <span className="text-xs text-vx-mut">{notice}</span>}
      </div>

      {filterClauses.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {filterClauses.map((c, i) => (
            <span key={i} className="inline-flex items-center gap-1.5 rounded-full border border-vx-violet/30 bg-vx-violet/10 px-2.5 py-1 text-xs text-vx-ink">
              {describeClause(c, byKey.get(c.column)?.type ?? "text")}
              <button type="button" aria-label="Remove filter" className="text-vx-faint hover:text-vx-ink"
                onClick={() => { setFilterClauses(filterClauses.filter((_, j) => j !== i)); setOffset(0); }}>×</button>
            </span>
          ))}
          <button type="button" className="text-xs text-vx-faint underline-offset-2 hover:text-vx-ink hover:underline" onClick={() => setShowFilters(true)}>Edit</button>
        </div>
      )}

      {/* ── selection bar ─────────────────────────── */}
      {sel.size > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-[14px] border border-vx-violet/35 bg-vx-violet/[0.08] px-4 py-2.5 text-sm">
          <span className="font-semibold">{sel.size} selected</span>
          <span className="flex-1" />
          <button className={`${ghost} inline-flex items-center gap-1.5`} onClick={() => void openComms()} disabled={busy !== ""}><IconSend /> {busy === "comms" ? "Loading…" : "Send Communication"}</button>
          <button className={`${ghost} inline-flex items-center gap-1.5`} onClick={() => void exportCsv()} disabled={busy !== ""}><IconDownload /> Export</button>
          <button className={ghost} onClick={() => setSel(new Set())}>Clear</button>
        </div>
      ) : total > 0 && !loading && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-vx-faint">
          <span>No selection → actions apply to all {total.toLocaleString("en-IN")} matching lead{total === 1 ? "" : "s"}:</span>
          <button className={cx(vx.btn, vx.ghost, vx.sm)} onClick={() => void openComms()} disabled={busy !== ""}><IconSend /> Send Communication</button>
        </div>
      )}

      {err && <p role="alert" className={vx.error}>{err}</p>}

      {/* ── table ─────────────────────────────────── */}
      <RefreshShimmer on={shimmer.on} className="rounded-[18px]">
      <div className="overflow-auto rounded-[18px] border border-vx-line bg-white/[0.015] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 z-10 text-[12.5px] text-vx-faint">
            <tr>
              <th className={`sticky left-0 z-20 w-8 border-b border-vx-line px-3 py-3 ${STICKY_BG}`}>
                <input type="checkbox" className={vx.check} aria-label="Select all on this page" checked={allOnPage}
                  onChange={() => setSel(allOnPage ? new Set() : new Set(rows.map((r) => r.lead_id)))} /></th>
              {shownCols.map((c, i) => (
                <th key={c.key} className={`whitespace-nowrap border-b border-vx-line px-4 py-3 font-medium ${i === 0 ? `sticky left-[44px] z-20 ${STICKY_BG}` : STICKY_BG} ${c.restricted ? "text-vx-orange-t/70" : ""}`}
                  title={c.restricted ? "Admin / admissions only" : c.group}>{columnLabel(c.key)}</th>
              ))}
              {isAdmin && <th className={`whitespace-nowrap border-b border-vx-line px-4 py-3 font-medium text-right ${STICKY_BG}`}>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {loading && !keepRows && <tr><td colSpan={shownCols.length + (isAdmin ? 2 : 1)} className="px-4 py-10 text-center text-vx-faint">Loading…</td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={shownCols.length + (isAdmin ? 2 : 1)} className="px-4 py-10 text-center text-vx-faint">{anyFilter ? "No leads match these filters." : "No leads yet."}</td></tr>}
            {(!loading || keepRows) && rows.map((r) => (
              <tr key={r.lead_id} className={`border-t border-vx-line-soft transition-colors hover:bg-white/[0.03] ${sel.has(r.lead_id) ? "bg-vx-violet/[0.08]" : ""}`}>
                <td className={`sticky left-0 z-[1] px-3 py-3 ${STICKY_BG}`}>
                  <input type="checkbox" className={vx.check} aria-label={`Select ${String(r.name ?? r.lead_id)}`} checked={sel.has(r.lead_id)} onChange={() => toggle(r.lead_id)} /></td>
                {shownCols.map((c, i) => (
                  <td key={c.key} className={`whitespace-nowrap px-4 py-3 ${i === 0 ? `sticky left-[44px] z-[1] ${STICKY_BG}` : ""}`}>
                    <Cell col={c} row={r} />
                  </td>
                ))}
                {isAdmin && (
                  <td className="px-4 py-3 text-right">
                    <DeletePerson kind="lead" id={r.lead_id} name={(r.name as string | null) ?? null} email={(r.email as string | null) ?? null} onDeleted={() => setReload((n) => n + 1)} compact />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      </RefreshShimmer>

      {data && data.total > PAGE && (
        <div className="flex items-center gap-3 text-sm text-vx-mut">
          <button className={cx(vx.btn, vx.ghost, vx.sm)} disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>Previous</button>
          <span>{offset + 1}–{Math.min(offset + PAGE, data.total)} of {data.total.toLocaleString("en-IN")}</span>
          <button className={cx(vx.btn, vx.secondary, vx.sm)} disabled={offset + PAGE >= data.total} onClick={() => setOffset(offset + PAGE)}>Next</button>
        </div>
      )}

      {showCols && <ColumnsDrawer catalog={catalog} cols={cols} onChange={setColumns} onClose={() => setShowCols(false)} />}
      {showFilters && <FilterDrawer filterable={filterable} value={filterClauses} onChange={(v) => { setFilterClauses(v); setOffset(0); }} onClose={() => setShowFilters(false)} />}

      {comm && (
        <>
          <div className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm" onClick={() => setComm(null)} />
          <div className="fixed left-1/2 top-6 z-50 w-[min(780px,94%)] -translate-x-1/2 overflow-hidden rounded-2xl border border-vx-line bg-[#0e0b29] text-vx-ink shadow-2xl">
            <div className="flex items-center justify-between border-b border-vx-line px-5 py-4">
              <h2 className="flex items-center gap-2.5 text-base font-bold">Send Communication
                <span className="rounded-full bg-vx-violet/15 px-2.5 py-0.5 text-xs font-semibold text-vx-violet-t">{recipients.length} recipient{recipients.length === 1 ? "" : "s"}</span></h2>
              <button onClick={() => setComm(null)} aria-label="Close" className="grid h-8 w-8 place-items-center rounded-lg border border-vx-line text-vx-mut hover:text-vx-ink"><IconClose /></button>
            </div>
            <div className="flex gap-1 px-5 pt-3">
              {(["email", "whatsapp"] as const).map((ch) => (
                <button key={ch} onClick={() => setComm(ch)} className={["inline-flex items-center gap-2 rounded-t-xl border border-b-0 px-4 py-2 text-sm font-semibold", comm === ch ? "border-vx-line bg-white/[0.04] text-vx-ink" : "border-transparent text-vx-faint hover:text-vx-ink"].join(" ")}>
                  {ch === "email" ? <IconMail /> : <IconChat />}{ch === "email" ? "Email" : "WhatsApp"}
                </button>
              ))}
            </div>
            <div className="max-h-[74vh] overflow-y-auto border-t border-vx-line px-1 py-1">
              <CommsBroadcast channel={comm} product="all" overrideRecipients={recipients} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** One cell. The name column shows the lead's name; everything else uses the shared formatter. */
function Cell({ col, row }: { col: GridColumn; row: LeadRow }) {
  const v = row[col.key];
  if (col.key === LEAD_NAME_COL) return <span className="font-medium">{v ? String(v) : "—"}</span>;
  if (col.key === "application_submitted") {
    return <span className={cx(vx.badge, v ? vx.tone.green : vx.tone.neutral)}>{v ? "Yes" : "No"}</span>;
  }
  if (col.key === "lead_stage") return <span>{stageLabel(v)}</span>;
  if (col.key === "campus") return <span>{campusLabel(v)}</span>;
  if (/utm|campaign|attribution/.test(col.key)) {
    const s = formatValue(col.type, col.key, v);
    return <span className="font-mono text-[11px] text-vx-mut" title={s === "—" ? undefined : s}>{s}</span>;
  }
  if (col.type === "ts" || col.type === "date") return <span className="text-xs text-vx-mut">{formatValue(col.type, col.key, v)}</span>;
  if (col.type === "bool") { const s = formatValue(col.type, col.key, v); return <span className={s === "Yes" ? "text-vx-green" : s === "No" ? "text-vx-faint" : ""}>{s}</span>; }
  const s = formatValue(col.type, col.key, v);
  return <span className={s.length > 48 ? "block max-w-[320px] truncate" : ""} title={s.length > 48 ? s : undefined}>{s}</span>;
}

/** Pick which columns to show, grouped as the database groups them. "Name" is always on. */
function ColumnsDrawer({ catalog, cols, onChange, onClose }: { catalog: GridColumn[]; cols: string[]; onChange: (c: string[]) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const on = new Set(cols);
  const groups = useMemo(() => {
    const m = new Map<string, GridColumn[]>();
    for (const c of catalog) { if (c.key === LEAD_NAME_COL) continue; const l = m.get(c.group) ?? []; l.push(c); m.set(c.group, l); }
    const order = (g: string) => { const i = GROUP_ORDER.indexOf(g); return i === -1 ? 999 : i; };
    return [...m.entries()].sort((a, b) => order(a[0]) - order(b[0]) || a[0].localeCompare(b[0]))
      .map(([g, list]) => [g, list.sort((a, b) => columnLabel(a.key).localeCompare(columnLabel(b.key)))] as const);
  }, [catalog]);
  const needle = q.trim().toLowerCase();
  const match = (c: GridColumn) => !needle || columnLabel(c.key).toLowerCase().includes(needle) || c.key.includes(needle);
  function toggle(key: string) { onChange(on.has(key) ? cols.filter((k) => k !== key) : [...cols, key]); }
  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed right-0 top-0 z-50 flex h-full w-[min(440px,100%)] flex-col border-l border-vx-line bg-[#0e0b29] text-vx-ink shadow-2xl">
        <div className="flex items-center justify-between border-b border-vx-line px-5 py-4">
          <div><h2 className="text-base font-bold">Columns</h2><p className="text-xs text-vx-faint">Tick what you want to see. Amber = admin / admissions only. Your choice is remembered on this device.</p></div>
          <button onClick={onClose} aria-label="Close" className="grid h-8 w-8 place-items-center rounded-lg border border-vx-line text-vx-mut hover:text-vx-ink"><IconClose /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search columns" aria-label="Search columns" className={`${input} mb-3 w-full`} />
          {groups.map(([g, list]) => {
            const vis = list.filter(match);
            if (!vis.length) return null;
            return (
              <div key={g} className="mb-4">
                <div className="mb-1 flex items-center justify-between font-mono text-[10px] text-vx-faint"><span>{g}</span><span>{list.filter((c) => on.has(c.key)).length}/{list.length}</span></div>
                {vis.map((c) => (
                  <label key={c.key} className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-white/5">
                    <input type="checkbox" checked={on.has(c.key)} onChange={() => toggle(c.key)} className="h-4 w-4 accent-[#8a18ff]" />
                    <span className={`text-sm ${on.has(c.key) ? "font-medium text-vx-ink" : "text-vx-mut"} ${c.restricted ? "text-vx-orange-t/80" : ""}`}>{columnLabel(c.key)}</span>
                    <span className="ml-auto font-mono text-[10px] text-vx-faint">{c.key}</span>
                  </label>
                ))}
              </div>
            );
          })}
        </div>
        <div className="flex items-center gap-2 border-t border-vx-line px-5 py-4">
          <span className="mr-auto font-mono text-[11px] text-vx-faint">{cols.length} shown</span>
          <button onClick={() => onChange(sanitizeColumns(null, catalog, DEFAULT_LEAD_COLUMNS))} className={ghost}>Reset</button>
          <button onClick={onClose} className={cx(vx.btn, vx.primary)}>Done</button>
        </div>
      </div>
    </>
  );
}

/** Fixed-list columns are picked, not typed: is / is not / set / empty only. */
const CHOICE_OPS = ["eq", "ne", "notnull", "isnull"];
const opsFor = (key: string, type: string) => (FILTER_OPS[type] ?? []).filter((o) => !VALUE_CHOICES[key] || CHOICE_OPS.includes(o.op));

/** Advanced filter builder: AND-ed clauses on any filterable column. The database re-checks every column, operator and value. */
function FilterDrawer({ filterable, value, onChange, onClose }:
  { filterable: GridColumn[]; value: FilterClause[]; onChange: (v: FilterClause[]) => void; onClose: () => void }) {
  const [draft, setDraft] = useState<FilterClause[]>(value);
  const [col, setCol] = useState<string>(filterable[0]?.key ?? "");
  const type = useMemo(() => filterable.find((c) => c.key === col)?.type ?? "text", [filterable, col]);
  const ops = opsFor(col, type);
  const [op, setOp] = useState<string>(ops[0]?.op ?? "eq");
  const [v1, setV1] = useState("");
  const [v2, setV2] = useState("");
  const arity = opArity(type, op);
  const inputType = filterInputType(type);

  function pickCol(k: string) {
    setCol(k);
    const t = filterable.find((c) => c.key === k)?.type ?? "text";
    setOp(opsFor(k, t)[0]?.op ?? "eq"); setV1(""); setV2("");
  }
  function add() {
    if (!col) return;
    let clause: FilterClause;
    if (arity === "none") clause = { column: col, op };
    else if (arity === "two") { if (!v1.trim() || !v2.trim()) return; clause = { column: col, op, v: [v1.trim(), v2.trim()] }; }
    else if (arity === "list") { const list = v1.split(/[,\n]/).map((x) => x.trim()).filter(Boolean); if (!list.length) return; clause = { column: col, op, v: list }; }
    else { if (!v1.trim()) return; clause = { column: col, op, v: v1.trim() }; }
    setDraft([...draft, clause]); setV1(""); setV2("");
  }
  const choices = VALUE_CHOICES[col];

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed right-0 top-0 z-50 flex h-full w-[min(460px,100%)] flex-col border-l border-vx-line bg-[#0e0b29] text-vx-ink shadow-2xl">
        <div className="flex items-center justify-between border-b border-vx-line px-5 py-4">
          <div><h2 className="text-base font-bold">Filters</h2><p className="text-xs text-vx-faint">Build conditions on any column. All conditions must match (AND).</p></div>
          <button onClick={onClose} aria-label="Close" className="grid h-8 w-8 place-items-center rounded-lg border border-vx-line text-vx-mut hover:text-vx-ink"><IconClose /></button>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {draft.length > 0 && (
            <div className="space-y-1.5">
              {draft.map((c, i) => (
                <div key={i} className="flex items-center justify-between gap-2 rounded-lg border border-vx-line bg-white/[0.03] px-3 py-2 text-sm">
                  <span>{describeClause(c, filterable.find((f) => f.key === c.column)?.type ?? "text")}</span>
                  <button type="button" aria-label="Remove" className="text-vx-faint hover:text-vx-ink" onClick={() => setDraft(draft.filter((_, j) => j !== i))}>×</button>
                </div>
              ))}
            </div>
          )}
          <div className="space-y-2 rounded-xl border border-vx-line bg-white/[0.02] p-3">
            <select className={`${input} w-full`} value={col} onChange={(e) => pickCol(e.target.value)} aria-label="Filter column">
              {filterable.map((c) => <option key={c.key} value={c.key}>{columnLabel(c.key)}{c.restricted ? " · admin" : ""}</option>)}
            </select>
            <select className={`${input} w-full`} value={op} onChange={(e) => setOp(e.target.value)} aria-label="Filter operator">
              {ops.map((o) => <option key={o.op} value={o.op}>{o.label}</option>)}
            </select>
            {arity !== "none" && (
              choices && (arity === "one") ? (
                <select className={`${input} w-full`} value={v1} onChange={(e) => setV1(e.target.value)} aria-label="Value">
                  <option value="">Choose…</option>
                  {choices.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              ) : arity === "list" ? (
                <textarea className={`${input} w-full`} rows={2} placeholder="One per line or comma-separated" value={v1} onChange={(e) => setV1(e.target.value)} aria-label="Values" />
              ) : arity === "two" ? (
                <div className="flex items-center gap-2">
                  <input type={inputType} className={`${input} w-full`} value={v1} onChange={(e) => setV1(e.target.value)} aria-label="From" />
                  <span className="text-vx-faint">–</span>
                  <input type={inputType} className={`${input} w-full`} value={v2} onChange={(e) => setV2(e.target.value)} aria-label="To" />
                </div>
              ) : (
                <input type={inputType} className={`${input} w-full`} value={v1} onChange={(e) => setV1(e.target.value)} aria-label="Value" />
              )
            )}
            <button type="button" className={cx(vx.btn, vx.secondary, "w-full")} onClick={add}>Add condition</button>
          </div>
        </div>
        <div className="flex items-center gap-2 border-t border-vx-line px-5 py-4">
          <button onClick={() => setDraft([])} className={ghost} disabled={!draft.length}>Clear all</button>
          <span className="flex-1" />
          <button onClick={onClose} className={ghost}>Cancel</button>
          <button onClick={() => { onChange(draft); onClose(); }} className={cx(vx.btn, vx.primary)}>Apply{draft.length ? ` (${draft.length})` : ""}</button>
        </div>
      </div>
    </>
  );
}

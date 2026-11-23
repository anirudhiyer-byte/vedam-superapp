"use client";
import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import { cx, vx } from "@/components/admin/ui/vx";
import { PageHead } from "@/components/admin/ui/page-head";
import {
  NEEDS_ASSIGNMENT, PANEL_STAGES, STAGES, STAGE_LABEL, STATUSES, STATUS_LABEL, canManage, errorText, isStage, isStatus, needsReason,
  type PanelKey, type Stage, type Status, type VsatRoles,
} from "@/lib/vsat/pipeline";
import {
  DEFAULT_COLUMNS, FILTER_OPS, FORM_STAGES, FORM_STAGE_LABEL, GROUP_ORDER, NO_COUNSELLOR, NO_INTERVIEWER, PAYMENT_STAGES, PAYMENT_STAGE_LABEL, VALUE_CHOICES,
  columnLabel, describeClause, filterInputType, formatValue, isFilterable, opArity, panelScope, parseSearchValues, peopleOptions, requestColumns, sanitizeColumns, toCsv,
  type FilterClause, type GridColumn, type GridColumnsResult, type GridResult, type GridRow, type GridSearch,
} from "@/lib/vsat/grid";
import { CommsBroadcast } from "@/components/admin/comms-broadcast";
import { StudentDrawer } from "./student-drawer";
import { FacetPick, type Opt } from "./facet-pick";
import { ExamAnalysisCard, ProctoringBar, VpsEditDialog, type VpsTarget } from "./exam-tools";
import { MeetBadge } from "./interview-tools";
import { RefreshShimmer, useRefreshShimmer } from "@/components/admin/ui/refresh-shimmer";
import { PlanBar, PlanDate, PlanInterviewer, PlanStatus, PlanTime, useInterviewPlan, type PlanMessage } from "./interview-planner";
import { OfferBar, type OfferMessage } from "./offer-tools";
import { TRACKS, type Track, type TrackKey } from "@/lib/vsat/tracks";
import { isMeetState } from "@/lib/vsat/interviews";
import type { Batch } from "./types";

/**
 * One grid for Applications / VSAT Exam / Interview / Counselling (Product Users style, 0097).
 *
 * - Stage / Status / VSAT / Campus are dropdowns; each option shows its count given the other
 *   dropdowns, so the team mixes and matches and reads the numbers off the dropdowns.
 * - "Columns" adds any column of application_manager the database allows this person.
 * - Search: pick a column, paste many values (comma / new line) → one row each.
 * - Export CSV and Send Communication act on the selection, or on the whole filtered set.
 * Data comes only from vsat_grid_list / vsat_grid_export: the database applies role, campus,
 * assignment and column rules on every call. Stage moves use the same engine as before.
 * VSAT Exam panel (0135): results columns by default, paid students by default for managers, the results
 * analysis for the chosen VSAT(s), Select for PI (admins), proctoring verdicts and a VPS edit (admins).
 * Interview panel (0140, 0143): an Interviewer dropdown for managers, and booking from the rows like the old
 * sheet — Interviewer / Date / Time cells on each row, select rows, one Send (interview-planner.tsx).
 * Counselling panel (0144, 0145): the same row booking with Counsellor / Date / Time, and Release offer for
 * students at Counselled (offer-tools.tsx).
 */

const PAGE = 50;
const input = vx.field;
const ghost = cx(vx.btn, vx.secondary);
const TITLE: Record<PanelKey, string> = { apps: "VSAT Applications", exam: "VSAT Exam", intv: "Interview", couns: "Counselling" };
const STICKY_BG = "bg-[#100d2a]";
// Interview panel, managers: these columns become the editable row cells (Interviewer / Date / Time / Invite)
// the grid columns the row cells replace, per track (0143 interviews, 0145 counselling)
const PLANNER_REPLACES: Record<TrackKey, Set<string>> = {
  interview: new Set(["interviewer", "interview_slot"]), counselling: new Set(["counsellor", "counselling_slot"]),
};
const plannerHeads = (t: Track) => [t.Host, "Date (IST)", "Time (IST)", "Invite"];

export const STATUS_TONE: Record<Status, string> = {
  active: "border-vx-green/30 bg-vx-green/10 text-vx-green",
  not_selected: "border-vx-red/30 bg-vx-red/10 text-vx-red",
  absent: "border-vx-orange/30 bg-vx-orange/10 text-vx-orange-t",
  on_hold: "border-vx-teal/30 bg-vx-teal/10 text-vx-teal-t",
};

export function StageBadge({ stage, status }: { stage: Stage; status: Status }) {
  return (
    <span className={cx("inline-flex items-center gap-1 whitespace-nowrap rounded-lg border px-2.5 py-0.5 text-[12.5px] font-medium", STATUS_TONE[status])}>
      {STAGE_LABEL[stage]}{status !== "active" && <span className="opacity-80">· {STATUS_LABEL[status]}</span>}
    </span>
  );
}

const Svg = (p: { children: ReactNode; className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={p.className || "h-4 w-4"}>{p.children}</svg>
);
const IconColumns = () => <Svg><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 3v18M15 3v18" /></Svg>;
const IconFilter = () => <Svg><path d="M22 3H2l8 9.46V19l4 2v-8.54z" /></Svg>;
const IconDownload = () => <Svg><path d="M12 15V3M8 7l4-4 4 4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" /></Svg>;
const IconSend = () => <Svg><path d="m22 2-7 20-4-9-9-4z" /><path d="M22 2 11 13" /></Svg>;
const IconMail = () => <Svg><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></Svg>;
const IconChat = () => <Svg><path d="M21 11.5a8.5 8.5 0 0 1-12.6 7.5L3 21l2-5.4A8.5 8.5 0 1 1 21 11.5z" /></Svg>;
const IconClose = () => <Svg><path d="M18 6 6 18M6 6l12 12" /></Svg>;
const IconPencil = () => <Svg className="h-3.5 w-3.5"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></Svg>;

const colsKey = (panel: PanelKey) => `vsat-grid-cols:v1:${panel}`;
// per-viewer convenience only; storage may be empty or throw (private window), so every touch is guarded
function loadCols(panel: PanelKey): unknown { try { const s = localStorage.getItem(colsKey(panel)); return s ? JSON.parse(s) : null; } catch { return null; } }
function saveCols(panel: PanelKey, cols: string[]) { try { localStorage.setItem(colsKey(panel), JSON.stringify(cols)); } catch { /* ignore */ } }

export function PipelinePanel({ panel, roles }: { panel: PanelKey; roles: VsatRoles }) {
  const [supabase] = useState(() => createClient());
  const scope = useMemo(() => panelScope(panel), [panel]);
  const manager = canManage(roles);
  const examPanel = panel === "exam";

  const [catalog, setCatalog] = useState<GridColumn[]>([]);
  const [vsats, setVsats] = useState<Batch[]>([]);
  const [stages, setStages] = useState<string[]>([]);
  const [statuses, setStatuses] = useState<string[]>([]);
  const [vsatIds, setVsatIds] = useState<string[]>([]);
  const [campuses, setCampuses] = useState<string[]>([]);
  const [formStages, setFormStages] = useState<string[]>([]);
  const [ivIds, setIvIds] = useState<string[]>([]);
  const ivPanel = panel === "intv" && manager;
  const [csIds, setCsIds] = useState<string[]>([]);
  const csPanel = panel === "couns" && manager;   // 0158: Counsellor dropdown on the Counselling panel
  // booking from the rows: interviews (0143) on the Interview panel, counselling (0145) on the Counselling panel
  const planTrack: Track | null = !manager ? null : panel === "intv" ? TRACKS.interview : panel === "couns" ? TRACKS.counselling : null;
  const planOn = !!planTrack;
  const offerPanel = panel === "couns" && manager;   // 0144: release offers from the selection
  // Exam panel: managers start on paid students only (0135); "Clear filters" still shows everyone
  const [payStages, setPayStages] = useState<string[]>(() => (manager && panel === "exam" ? ["payment_approved"] : []));
  const [filterClauses, setFilterClauses] = useState<FilterClause[]>([]);
  const [showFilters, setShowFilters] = useState(false);
  const [searchCol, setSearchCol] = useState("_any");
  const [searchText, setSearchText] = useState("");
  const [search, setSearch] = useState<GridSearch | null>(null);
  const [cols, setCols] = useState<string[]>(DEFAULT_COLUMNS[panel]);
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<GridResult | null>(null);
  const [loading, setLoading] = useState(true);
  // Refresh button: blur + sweep of light over the cards until the new data is in (keeps the old rows on screen meanwhile)
  const shimmer = useRefreshShimmer(loading);
  const [err, setErr] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [showCols, setShowCols] = useState(false);
  const [busy, setBusy] = useState<"" | "csv" | "comms">("");
  const [comm, setComm] = useState<null | "email" | "whatsapp">(null);
  const [recipients, setRecipients] = useState<{ user_id: string; email: string | null; phone: string | null; full_name: string | null; state: string | null; city: string | null }[]>([]);
  const [notice, setNotice] = useState("");
  const [vpsEdit, setVpsEdit] = useState<VpsTarget | null>(null);
  const [planMsg, setPlanMsg] = useState<PlanMessage | null>(null);
  const [offerMsg, setOfferMsg] = useState<OfferMessage | null>(null);

  // catalogue (what this person may show) + VSAT list; saved column choice is checked against the catalogue
  useEffect(() => {
    let on = true;
    void supabase.rpc("vsat_grid_columns").then(({ data: d, error }) => {
      if (!on) return;
      if (error || !d) { setErr(errorText(error?.message)); setLoading(false); return; }
      const res = d as GridColumnsResult;
      setCatalog(res.columns);
      setCols(sanitizeColumns(loadCols(panel), res.columns, DEFAULT_COLUMNS[panel]));
    });
    void supabase.rpc("vsat_batches").then(({ data: d }) => { if (on) setVsats(Array.isArray(d) ? (d as Batch[]) : []); });
    return () => { on = false; };
  }, [supabase, panel]);

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
    if (scope) p.scope = scope;
    if (stages.length) p.stages = stages;
    if (statuses.length) p.statuses = statuses;
    if (vsatIds.length) p.exam_date_ids = vsatIds;
    if (campuses.length) p.campuses = campuses;
    if (formStages.length) p.form_stages = formStages;
    if (manager && payStages.length) p.payment_stages = payStages;
    if (ivPanel && ivIds.length) p.interviewer_ids = ivIds;
    if (csPanel && csIds.length) p.counsellor_ids = csIds;
    if (filterClauses.length) p.filters = filterClauses;
    if (search) p.search = search;
    return p;
  }, [scope, stages, statuses, vsatIds, campuses, formStages, payStages, ivPanel, ivIds, csPanel, csIds, filterClauses, manager, search]);

  const load = useCallback(async () => {
    if (!catalog.length) return;
    setLoading(true); setErr("");
    const p = { ...filters(), columns: requestColumns(cols), limit: PAGE, offset };
    const { data: d, error } = await supabase.rpc("vsat_grid_list", { p });
    if (error) { setErr(errorText(error.message)); setData(null); } else setData(d as GridResult);
    setSel(new Set());
    setLoading(false);
  }, [supabase, catalog.length, filters, cols, offset]);
  useEffect(() => { void load(); }, [load, reload]);
  // Realtime: a contentless ping on the 'vsat_pipeline' channel (migration 0149) means a stage
  // moved or an interview/counselling assignment changed — reload the grid (debounced) so every
  // open admin screen stays live without a refresh. All real data still comes from the RPC.
  useEffect(() => {
    let on = true; let t: ReturnType<typeof setTimeout> | null = null;
    let ch: ReturnType<typeof supabase.channel> | null = null;
    const ping = () => { if (t) clearTimeout(t); t = setTimeout(() => { if (on) setReload((r) => r + 1); }, 800); };
    void (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session || !on) return;
      supabase.realtime.setAuth(session.access_token);
      ch = supabase.channel("vsat_pipeline", { config: { private: true } }).on("broadcast", { event: "change" }, ping).subscribe();
    })();
    return () => { on = false; if (t) clearTimeout(t); if (ch) void supabase.removeChannel(ch); };
  }, [supabase]);

  const rows = useMemo(() => data?.rows ?? [], [data]);
  const facets = data?.facets ?? null;
  // Interview panel, managers: book from the rows (0143)
  const rowIds = useMemo(() => (loading ? [] : rows.map((r) => r.application_id)), [rows, loading]);
  // during a Refresh the old rows stay (blurred) instead of a "Loading…" line
  const keepRows = shimmer.on && rows.length > 0;
  const planner = useInterviewPlan(rowIds, planOn, planTrack ?? TRACKS.interview);
  const tableCols = useMemo(() => (planTrack ? shownCols.filter((c) => !PLANNER_REPLACES[planTrack.key].has(c.key)) : shownCols), [planTrack, shownCols]);
  const selInOrder = useMemo(() => rows.map((r) => r.application_id).filter((id) => sel.has(id)), [rows, sel]);
  const replanRows = planner.replan;
  const afterBooking = useCallback(() => { setReload((n) => n + 1); void replanRows(); }, [replanRows]);
  const colCount = tableCols.length + (manager ? 1 : 0) + (planTrack ? plannerHeads(planTrack).length : 0);
  const anyFilter = stages.length > 0 || statuses.length > 0 || vsatIds.length > 0 || campuses.length > 0 || formStages.length > 0 || payStages.length > 0
    || ivIds.length > 0 || csIds.length > 0 || filterClauses.length > 0 || !!search;
  const allOnPage = rows.length > 0 && rows.every((r) => sel.has(r.application_id));
  // the stage every selected row is at — the bulk move checks the database still agrees
  const selStage = useMemo<Stage | null>(() => {
    const st = new Set(rows.filter((r) => sel.has(r.application_id)).map((r) => r.stage));
    return st.size === 1 ? [...st][0] : null;
  }, [rows, sel]);

  const stageOpts: Opt[] = (scope ?? STAGES).map((s) => ({ value: s, label: STAGE_LABEL[s], count: facets ? facets.stage[s] ?? 0 : null }));
  const statusOpts: Opt[] = STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s], count: facets ? facets.status[s] ?? 0 : null }));
  const vsatOpts: Opt[] = vsats.map((b) => ({ value: b.id, label: b.label, count: facets ? facets.vsat[b.id] ?? 0 : null }));
  const campusOpts: Opt[] = [
    { value: "pune", label: "Pune", count: facets ? facets.campus.pune ?? 0 : null },
    { value: "gurugram", label: "Gurugram", count: facets ? facets.campus.gurugram ?? 0 : null },
  ];
  const formOpts: Opt[] = FORM_STAGES.map((v) => ({ value: v, label: FORM_STAGE_LABEL[v], count: facets ? facets.form_stage?.[v] ?? 0 : null }));
  const payOpts: Opt[] = PAYMENT_STAGES.map((v) => ({ value: v, label: PAYMENT_STAGE_LABEL[v], count: facets ? facets.payment_stage?.[v] ?? 0 : null }));
  // interviewers / counsellors in this panel's scope (names from the database), A–Z, then "No …"; a chosen one stays listed even at 0
  const ivOpts: Opt[] = useMemo(() => peopleOptions(facets?.interviewer_name, facets?.interviewer, ivIds,
    { none: NO_INTERVIEWER, noneLabel: "No interviewer", fallback: "Interviewer", loaded: !!facets }), [facets, ivIds]);
  const csOpts: Opt[] = useMemo(() => peopleOptions(facets?.counsellor_name, facets?.counsellor, csIds,
    { none: NO_COUNSELLOR, noneLabel: "No counsellor", fallback: "Counsellor", loaded: !!facets }), [facets, csIds]);
  const searchable = useMemo(() => catalog.filter((c) => !c.virtual && ["text", "num", "date", "ts"].includes(c.type))
    .sort((a, b) => columnLabel(a.key).localeCompare(columnLabel(b.key))), [catalog]);

  const filterable = useMemo(() => catalog.filter(isFilterable)
    .sort((a, b) => columnLabel(a.key).localeCompare(columnLabel(b.key))), [catalog]);
  function clearFilters() { setStages([]); setStatuses([]); setVsatIds([]); setCampuses([]); setFormStages([]); setPayStages([]); setIvIds([]); setCsIds([]); setFilterClauses([]); setSearchText(""); setOffset(0); }
  function toggle(id: string) { setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; }); }
  function setColumns(next: string[]) { setCols(next); saveCols(panel, next); setOffset(0); }

  // whole filtered set (or the selection) from the database — admin / admissions only, audited there
  async function pull(purpose: "csv" | "comms") {
    setBusy(purpose); setNotice("");
    const p: Record<string, unknown> = { ...filters(), purpose };
    if (sel.size) p.application_ids = [...sel];
    if (purpose === "csv") p.columns = requestColumns(cols);
    const { data: d, error } = await supabase.rpc("vsat_grid_export", { p });
    setBusy("");
    if (error) { setNotice(errorText(error.message)); return null; }
    return d as { total: number; rows: GridRow[] };
  }
  async function exportCsv() {
    const d = await pull("csv");
    if (!d) return;
    const csv = toCsv(d.rows, shownCols.map((c) => ({ key: c.key, type: c.type })));
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `vsat-${panel}-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(a.href);
    setNotice(`Exported ${d.total} student${d.total === 1 ? "" : "s"}.`);
  }
  async function openComms() {
    const d = await pull("comms");
    if (!d) return;
    setRecipients(d.rows.map((r) => ({
      user_id: r.application_id, email: (r.registered_email as string | null) ?? null, phone: (r.registered_mobile as string | null) ?? null,
      full_name: (r.registered_name as string | null) ?? null, state: (r.state as string | null) ?? null, city: (r.city as string | null) ?? null,
    })));
    setComm("email");
  }

  const total = data?.total ?? 0;
  return (
    <div className="space-y-4 p-4 font-sans text-vx-ink sm:p-8">
      <PageHead title={TITLE[panel]} count={`${loading && !data ? "…" : total.toLocaleString("en-IN")} student${total === 1 ? "" : "s"}${anyFilter ? " match" : ""}`} />
      {/* ── filters ───────────────────────────────── */}
      <div className="flex flex-wrap items-start gap-2">
        <div className="flex h-10 items-stretch overflow-hidden rounded-[11px] border border-vx-line2 bg-black/20 focus-within:border-vx-violet focus-within:ring-2 focus-within:ring-vx-violet/30">
          <select className="border-r border-vx-line bg-transparent px-2 py-2 text-sm text-vx-ink focus:outline-none" value={searchCol}
            onChange={(e) => setSearchCol(e.target.value)} aria-label="Search column">
            <option value="_any">{manager ? "Name, email, mobile, app no." : "Name or app no."}</option>
            {searchable.map((c) => <option key={c.key} value={c.key}>{columnLabel(c.key)}</option>)}
          </select>
          <textarea className="w-56 resize-none bg-transparent px-3 py-2 text-sm sm:w-72 text-vx-ink placeholder:text-vx-faint focus:outline-none" rows={1}
            placeholder={searchCol === "_any" ? "Search…" : `Paste ${columnLabel(searchCol).toLowerCase()} values, one per line or comma-separated`}
            value={searchText} onChange={(e) => setSearchText(e.target.value)} maxLength={20000} aria-label="Search values" />
        </div>
        <FacetPick title="Stage" options={stageOpts} value={stages} onChange={(v) => { setStages(v); setOffset(0); }} />
        <FacetPick title="Status" options={statusOpts} value={statuses} onChange={(v) => { setStatuses(v); setOffset(0); }} />
        <FacetPick title="VSAT" options={vsatOpts} value={vsatIds} onChange={(v) => { setVsatIds(v); setOffset(0); }} />
        <FacetPick title="Campus" options={campusOpts} value={campuses} onChange={(v) => { setCampuses(v); setOffset(0); }} />
        <FacetPick title="Form" options={formOpts} value={formStages} onChange={(v) => { setFormStages(v); setOffset(0); }} />
        {manager && <FacetPick title="Payment" options={payOpts} value={payStages} onChange={(v) => { setPayStages(v); setOffset(0); }} />}
        {ivPanel && <FacetPick title="Interviewer" options={ivOpts} value={ivIds} onChange={(v) => { setIvIds(v); setOffset(0); }} />}
        {csPanel && <FacetPick title="Counsellor" options={csOpts} value={csIds} onChange={(v) => { setCsIds(v); setOffset(0); }} />}
        <span className="flex-1" />
        <button className={`${ghost} inline-flex items-center gap-2 ${filterClauses.length ? "border-vx-violet/50 text-vx-ink" : ""}`} onClick={() => setShowFilters(true)} disabled={!catalog.length}>
          <IconFilter /> Filters{filterClauses.length > 0 && <span className="rounded-full bg-vx-violet/20 px-1.5 text-[11px] tabular-nums text-vx-violet-t">{filterClauses.length}</span>}
        </button>
        <button className={`${ghost} inline-flex items-center gap-2`} onClick={() => setShowCols(true)} disabled={!catalog.length}>
          <IconColumns /> Columns <span className="rounded-full bg-white/10 px-1.5 text-[11px] tabular-nums">{shownCols.length}</span>
        </button>
        {manager && (
          <button className={`${ghost} inline-flex items-center gap-2`} onClick={exportCsv} disabled={busy !== "" || loading || total === 0}>
            <IconDownload /> {busy === "csv" ? "Exporting…" : sel.size ? `Export ${sel.size}` : "Export CSV"}
          </button>
        )}
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

      {/* ── VSAT Exam: results analysis for the chosen VSAT(s) ── */}
      {examPanel && manager && vsatIds.length > 0 && (
        <RefreshShimmer on={shimmer.on} className="rounded-[18px]">
          <ExamAnalysisCard vsatIds={vsatIds} vsatLabels={vsatIds.map((id) => vsats.find((b) => b.id === id)?.label ?? "VSAT")}
            canSelect={roles.admin} reloadKey={reload} onApplied={() => setReload((n) => n + 1)} />
        </RefreshShimmer>
      )}
      {examPanel && manager && vsatIds.length === 0 && (
        <p className="text-[13px] text-vx-faint">Pick a VSAT above to see its results analysis{roles.admin ? " and select students for PI" : ""}.</p>
      )}

      {/* ── selection bar ─────────────────────────── */}
      {manager && sel.size > 0 && (
        <div className="space-y-2 rounded-[14px] border border-vx-violet/35 bg-vx-violet/[0.08] p-3 text-sm sm:px-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{sel.size} selected</span>
            <span className="flex-1" />
            <button className={`${ghost} inline-flex items-center gap-1.5`} onClick={openComms} disabled={busy !== ""}><IconSend /> {busy === "comms" ? "Loading…" : "Send Communication"}</button>
            <button className={`${ghost} inline-flex items-center gap-1.5`} onClick={exportCsv} disabled={busy !== ""}><IconDownload /> Export</button>
            <button className={ghost} onClick={() => setSel(new Set())}>Clear</button>
          </div>
          {planOn && <PlanBar ids={selInOrder} planner={planner} onDone={afterBooking} onSent={setPlanMsg} />}
          {offerPanel && <OfferBar ids={selInOrder} onDone={() => setReload((n) => n + 1)} onReleased={setOfferMsg} />}
          <BulkBar ids={[...sel]} current={selStage} panel={panel} onDone={() => setReload((n) => n + 1)} />
          {examPanel && <div className="border-t border-vx-violet/20 pt-2"><ProctoringBar ids={[...sel]} onDone={() => setReload((n) => n + 1)} /></div>}
        </div>
      )}
      {manager && sel.size === 0 && total > 0 && !loading && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-vx-faint">
          <span>No selection → actions apply to all {total} matching student{total === 1 ? "" : "s"}:</span>
          <button className={cx(vx.btn, vx.ghost, vx.sm)} onClick={openComms} disabled={busy !== ""}><IconSend /> Send Communication</button>
        </div>
      )}

      {err && <p role="alert" className={vx.error}>{err}</p>}
      {planTrack && planner.loadErr && <p role="alert" className={vx.error}>Couldn&apos;t load the {planTrack.noun} times: {planner.loadErr}</p>}
      {planOn && planMsg && (
        <div role="status" className={cx(planMsg.ok ? vx.ok : vx.info, "flex items-start justify-between gap-3")}>
          <span>{planMsg.text}</span>
          <button type="button" aria-label="Dismiss" className="text-vx-faint hover:text-vx-ink" onClick={() => setPlanMsg(null)}>×</button>
        </div>
      )}
      {offerPanel && offerMsg && (
        <div role="status" className={cx(offerMsg.ok ? vx.ok : vx.info, "flex items-start justify-between gap-3")}>
          <span>{offerMsg.text}</span>
          <button type="button" aria-label="Dismiss" className="text-vx-faint hover:text-vx-ink" onClick={() => setOfferMsg(null)}>×</button>
        </div>
      )}
      {planTrack && sel.size === 0 && total > 0 && !loading && (
        <p className="text-xs text-vx-faint">To book: fill {planTrack.Host}, Date and Time on the rows (saved as you type, not sent), select them, then press Send.{offerPanel ? " To release offers: select students at Counselled and press Release offer." : ""}</p>
      )}

      {/* ── table ─────────────────────────────────── */}
      <RefreshShimmer on={shimmer.on} delayMs={examPanel && manager && vsatIds.length > 0 ? 80 : 0} className="rounded-[18px]">
      <div className="overflow-auto rounded-[18px] border border-vx-line bg-white/[0.015] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 z-10 text-[12.5px] text-vx-faint">
            <tr>
              {manager && <th className={`sticky left-0 z-20 w-8 border-b border-vx-line px-3 py-3 ${STICKY_BG}`}><input type="checkbox" className={vx.check} aria-label="Select all on this page" checked={allOnPage}
                onChange={() => setSel(allOnPage ? new Set() : new Set(rows.map((r) => r.application_id)))} /></th>}
              {tableCols.map((c, i) => (
                <Fragment key={c.key}>
                  <th className={`whitespace-nowrap border-b border-vx-line px-4 py-3 font-medium ${i === 0 ? `sticky z-20 ${STICKY_BG} ${manager ? "left-[44px]" : "left-0"}` : STICKY_BG} ${c.restricted ? "text-vx-orange-t/70" : ""}`}
                    title={c.restricted ? "Admin / admissions only" : c.group}>{columnLabel(c.key)}</th>
                  {planTrack && i === 0 && plannerHeads(planTrack).map((h) => (
                    <th key={h} className={`whitespace-nowrap border-b border-vx-line px-3 py-3 font-medium ${STICKY_BG}`}>{h}</th>
                  ))}
                </Fragment>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && !keepRows && <tr><td colSpan={colCount} className="px-4 py-10 text-center text-vx-faint">Loading…</td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={colCount} className="px-4 py-10 text-center text-vx-faint">{anyFilter ? "No students match these filters." : "No students here."}</td></tr>}
            {(!loading || keepRows) && rows.map((r) => {
              const name = String(r.registered_name ?? r.application_id);
              return (
                <tr key={r.application_id} className={`group cursor-pointer border-t border-vx-line-soft transition-colors hover:bg-white/[0.03] ${sel.has(r.application_id) ? "bg-vx-violet/[0.08]" : ""}`} onClick={() => setOpenId(r.application_id)}>
                  {manager && <td className={`sticky left-0 z-[1] px-3 py-3 ${STICKY_BG}`} onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" className={vx.check} aria-label={`Select ${name}`} checked={sel.has(r.application_id)} onChange={() => toggle(r.application_id)} /></td>}
                  {tableCols.map((c, i) => (
                    <Fragment key={c.key}>
                      <td className={`whitespace-nowrap px-4 py-3 ${i === 0 ? `sticky z-[1] ${STICKY_BG} ${manager ? "left-[44px]" : "left-0"}` : ""}`}>
                        <Cell col={c} row={r} onEditVps={roles.admin ? (t) => setVpsEdit(t) : undefined} />
                      </td>
                      {planOn && i === 0 && (
                        <>
                          {/* editing a cell never opens the student page */}
                          <td className="whitespace-nowrap px-3 py-2" onClick={(e) => e.stopPropagation()}><PlanInterviewer app={r.application_id} name={name} planner={planner} /></td>
                          <td className="whitespace-nowrap px-3 py-2" onClick={(e) => e.stopPropagation()}><PlanDate app={r.application_id} name={name} planner={planner} /></td>
                          <td className="whitespace-nowrap px-3 py-2" onClick={(e) => e.stopPropagation()}><PlanTime app={r.application_id} name={name} planner={planner} /></td>
                          <td className="whitespace-nowrap px-3 py-2" onClick={(e) => e.stopPropagation()}><PlanStatus app={r.application_id} planner={planner} /></td>
                        </>
                      )}
                    </Fragment>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      </RefreshShimmer>

      {data && data.total > PAGE && (
        <div className="flex items-center gap-3 text-sm text-vx-mut">
          <button className={cx(vx.btn, vx.ghost, vx.sm)} disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>Previous</button>
          <span>{offset + 1}–{Math.min(offset + PAGE, data.total)} of {data.total}</span>
          <button className={cx(vx.btn, vx.secondary, vx.sm)} disabled={offset + PAGE >= data.total} onClick={() => setOffset(offset + PAGE)}>Next</button>
        </div>
      )}

      {vpsEdit && <VpsEditDialog target={vpsEdit} onClose={() => setVpsEdit(null)} onDone={() => setReload((n) => n + 1)} />}

      {openId && <StudentDrawer id={openId} roles={roles} onClose={() => setOpenId(null)} onChanged={() => setReload((n) => n + 1)} />}

      {showCols && <ColumnsDrawer catalog={catalog} cols={cols} panel={panel} onChange={setColumns} onClose={() => setShowCols(false)} />}

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

const num = (v: unknown): number | null => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

/** One cell: the student column carries the app no.; stage shows the badge; VPS / eligible mark an override; admins can edit VPS. */
function Cell({ col, row, onEditVps }: { col: GridColumn; row: GridRow; onEditVps?: (t: VpsTarget) => void }) {
  const v = row[col.key];
  if (col.key === "registered_name") {
    return <><div className="font-medium">{v ? String(v) : "—"}</div><div className="text-xs text-vx-faint">{String(row.application_no ?? row.application_id)}</div></>;
  }
  if (col.key === "stage") return isStage(row.stage) && isStatus(row.status) ? <StageBadge stage={row.stage} status={row.status} /> : <>{String(v ?? "—")}</>;
  if (col.key === "vps_effective" || col.key === "eligible_effective") {
    const ov = row[col.key === "vps_effective" ? "vps_override" : "eligible_override"];
    const hasOv = ov !== null && ov !== undefined;
    const calc = col.key === "vps_effective" ? num(row.vps_calculated) : null;
    return (
      <span className="inline-flex items-center gap-1" title={hasOv && calc !== null ? `Calculated ${formatValue("num", "vps", calc)}` : undefined}>
        {formatValue(col.type, col.key, v)}
        {hasOv && <span className="text-xs text-vx-orange-t">override</span>}
        {col.key === "vps_effective" && onEditVps && (
          <button type="button" aria-label={`Edit VPS for ${String(row.registered_name ?? row.application_id)}`}
            className="ml-0.5 grid h-6 w-6 place-items-center rounded-md text-vx-faint opacity-60 hover:bg-white/10 hover:text-vx-ink hover:opacity-100 focus-visible:opacity-100 group-hover:opacity-100"
            onClick={(e) => { e.stopPropagation(); onEditVps({ applicationId: row.application_id, name: String(row.registered_name ?? row.application_no ?? row.application_id),
              value: num(v), calculated: calc, override: num(ov) }); }}>
            <IconPencil />
          </button>
        )}
      </span>
    );
  }
  if (col.key === "proctoring") {
    if (v === "disqualified") return <span className={cx(vx.badge, vx.tone.red)}>Disqualified</span>;
    if (v === "cleared") return <span className={cx(vx.badge, vx.tone.green)}>Cleared</span>;
    return <span className="text-vx-faint">—</span>;
  }
  if (col.key === "interview_meet" || col.key === "counselling_meet") return isMeetState(v) ? <MeetBadge state={v} /> : <span className="text-vx-faint">—</span>;
  if (col.key === "campus") return <span className="capitalize">{formatValue(col.type, col.key, v)}</span>;
  if (col.type === "ts" || col.type === "date") return <span className="text-xs text-vx-mut">{formatValue(col.type, col.key, v)}</span>;
  if (col.type === "bool") { const s = formatValue(col.type, col.key, v); return <span className={s === "Yes" ? "text-vx-green" : s === "No" ? "text-vx-faint" : ""}>{s}</span>; }
  const s = formatValue(col.type, col.key, v);
  return <span className={s.length > 48 ? "block max-w-[320px] truncate" : ""} title={s.length > 48 ? s : undefined}>{s}</span>;
}

/** Pick which columns to show, grouped as the database groups them. "Student" is always on. */
function ColumnsDrawer({ catalog, cols, panel, onChange, onClose }: { catalog: GridColumn[]; cols: string[]; panel: PanelKey; onChange: (c: string[]) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const on = new Set(cols);
  const groups = useMemo(() => {
    const m = new Map<string, GridColumn[]>();
    for (const c of catalog) { if (c.key === "registered_name") continue; const l = m.get(c.group) ?? []; l.push(c); m.set(c.group, l); }
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
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search columns" aria-label="Search columns"
            className={`${input} mb-3 w-full`} />
          {groups.map(([g, list]) => {
            const vis = list.filter(match);
            if (!vis.length) return null;
            return (
              <div key={g} className="mb-4">
                <div className="mb-1 flex items-center justify-between font-mono text-[10px] text-vx-faint">
                  <span>{g}</span><span>{list.filter((c) => on.has(c.key)).length}/{list.length}</span>
                </div>
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
          <button onClick={() => onChange(sanitizeColumns(null, catalog, DEFAULT_COLUMNS[panel]))} className={ghost}>Reset</button>
          <button onClick={onClose} className={cx(vx.btn, vx.primary)}>Done</button>
        </div>
      </div>
    </>
  );
}

/** Fixed-list columns (proctoring, 12th result) are picked, not typed: is / is not / set / empty only. */
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
    else if (arity === "list") {
      const list = v1.split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
      if (!list.length) return; clause = { column: col, op, v: list };
    } else { if (!v1.trim()) return; clause = { column: col, op, v: v1.trim() }; }
    setDraft([...draft, clause]); setV1(""); setV2("");
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed right-0 top-0 z-50 flex h-full w-[min(460px,100%)] flex-col border-l border-vx-line bg-[#0e0b29] text-vx-ink shadow-2xl">
        <div className="flex items-center justify-between border-b border-vx-line px-5 py-4">
          <div><h2 className="text-base font-bold">Filters</h2><p className="text-xs text-vx-faint">Build conditions on any column. All conditions must match (AND).</p></div>
          <button onClick={onClose} aria-label="Close" className="grid h-8 w-8 place-items-center rounded-lg border border-vx-line text-vx-mut hover:text-vx-ink"><IconClose /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
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
            <div className="text-[10px] font-mono text-vx-faint">Add a condition</div>
            <select className={`${input} w-full`} value={col} onChange={(e) => pickCol(e.target.value)} aria-label="Filter column">
              {filterable.map((c) => <option key={c.key} value={c.key}>{columnLabel(c.key)}{c.restricted ? " · restricted" : ""}</option>)}
            </select>
            <div className="flex gap-2">
              <select className={`${input} w-40`} value={op} onChange={(e) => { setOp(e.target.value); setV1(""); setV2(""); }} aria-label="Operator">
                {ops.map((o) => <option key={o.op} value={o.op}>{o.label}</option>)}
              </select>
              {arity === "one" && (VALUE_CHOICES[col]
                ? <select className={`${input} flex-1`} value={v1} onChange={(e) => setV1(e.target.value)} aria-label="Value">
                    <option value="">Pick…</option>
                    {VALUE_CHOICES[col].map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                : <input className={`${input} flex-1`} type={inputType} value={v1} onChange={(e) => setV1(e.target.value)} placeholder="value" aria-label="Value" />)}
              {arity === "two" && <>
                <input className={`${input} w-24`} type={inputType} value={v1} onChange={(e) => setV1(e.target.value)} placeholder="from" aria-label="From" />
                <input className={`${input} w-24`} type={inputType} value={v2} onChange={(e) => setV2(e.target.value)} placeholder="to" aria-label="To" />
              </>}
              {arity === "list" && <input className={`${input} flex-1`} value={v1} onChange={(e) => setV1(e.target.value)} placeholder="value, value, …" aria-label="Values" />}
            </div>
            <button type="button" className={`${ghost} w-full`} onClick={add}>+ Add condition</button>
          </div>
        </div>
        <div className="flex items-center gap-2 border-t border-vx-line px-5 py-4">
          <button onClick={() => setDraft([])} className={`${ghost} mr-auto`} disabled={!draft.length}>Clear all</button>
          <button onClick={onClose} className={ghost}>Cancel</button>
          <button onClick={() => { onChange(draft); onClose(); }} className={cx(vx.btn, vx.primary)}>Apply{draft.length > 0 ? ` (${draft.length})` : ""}</button>
        </div>
      </div>
    </>
  );
}

/** Bulk move (admin / admissions). Each student is checked on its own by the database; skipped ones are listed. */
function BulkBar({ ids, current, panel, onDone }: { ids: string[]; current: Stage | null; panel: PanelKey; onDone: () => void }) {
  const [supabase] = useState(() => createClient());
  const targets = STAGES.filter((s) => !NEEDS_ASSIGNMENT[s]);
  const [to, setTo] = useState<Stage>(current && !NEEDS_ASSIGNMENT[current] ? current : PANEL_STAGES[panel][0]);
  const [st, setSt] = useState<Status>("active");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const reasonNeeded = current ? needsReason(current, "active", to, st) : true;

  async function apply() {
    if (reasonNeeded && reason.trim().length < 3) return setMsg("Please add a reason (at least 3 characters).");
    setBusy(true); setMsg("");
    const p: Record<string, unknown> = { application_ids: ids, to_stage: to, to_status: st };
    if (reason.trim()) p.reason = reason.trim();
    if (current) p.expected_stage = current;
    const { data, error } = await supabase.rpc("vsat_move_bulk", { p });
    setBusy(false);
    if (error) return setMsg(errorText(error.message));
    const d = data as { moved: number; unchanged: number; skipped: { application_id: string; code: string }[] };
    setMsg(`Moved ${d.moved}${d.unchanged ? `, ${d.unchanged} already there` : ""}${d.skipped.length ? `, ${d.skipped.length} skipped: ${d.skipped.slice(0, 5).map((s) => `${s.application_id} (${errorText(s.code)})`).join("; ")}${d.skipped.length > 5 ? " …" : ""}` : ""}.`);
    setReason(""); onDone();
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-vx-mut">Move to</span>
      <select className={input} value={to} onChange={(e) => setTo(e.target.value as Stage)} aria-label="Move to stage">
        {targets.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
      </select>
      <select className={input} value={st} onChange={(e) => setSt(e.target.value as Status)} aria-label="Status">
        {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
      </select>
      <input className={`${input} w-64`} placeholder={reasonNeeded ? "Reason (required)" : "Reason (optional)"} value={reason}
        onChange={(e) => setReason(e.target.value)} maxLength={500} aria-label="Reason" />
      <button className={cx(vx.btn, vx.primary)} disabled={busy} onClick={apply}>{busy ? "Moving…" : "Move"}</button>
      <span className="text-xs text-vx-faint">{panel === "intv" ? "To book interviews: fill Interviewer, Date and Time on the rows and press Send above. " : panel === "couns" ? "To book counselling: fill Counsellor, Date and Time on the rows and press Send above. " : ""}{current ? "" : "Mixed stages selected: a reason is required."}</span>
      {msg && <p className="w-full text-vx-ink">{msg}</p>}
    </div>
  );
}

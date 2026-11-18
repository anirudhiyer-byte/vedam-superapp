"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { CampaignFull } from "@/lib/growth/marketing";
import {
  academicYearStart, buildCountsPayload, buildDrillPayload, clampPage, columnsFor, DRILL_PAGE_SIZE, nextSort, pageCount, seasonError, toCsv, validateRange,
  type Counts, type DrillKind, type DrillResult, type SortState,
} from "@/lib/growth/season";
import { CSS, Modal, rpc } from "./shared";

/**
 * Growth → Overview → Season Dashboard.
 * Three cards (Total Leads / Paid Applications / Enrolments) and the list behind each one.
 * Numbers and lists come from growth_season_counts / growth_season_drill (migration 0108): admin only, checked in the
 * database, one shared definition so a card and its list cannot disagree. The browser never touches the tables.
 */

const CARDS: { kind: DrillKind; label: string; hint: string }[] = [
  { kind: "leads", label: "Total Leads", hint: "Leads created in the window" },
  { kind: "paid", label: "Paid Applications", hint: "Leads whose VSAT payment is in the window" },
  { kind: "enrolled", label: "Enrolments", hint: "Approved enrolments in the window" },
];
const TITLES: Record<DrillKind, string> = { leads: "Total Leads", paid: "Paid Applications", enrolled: "Enrolments" };

const todayIst = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const fmt = (n: number) => n.toLocaleString("en-IN");

function cell(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return String(v);
}

export function SeasonPanel() {
  const [sb] = useState(() => createClient());
  const today = useMemo(() => todayIst(), []);
  const [from, setFrom] = useState(() => academicYearStart(todayIst()));
  const [to, setTo] = useState(() => todayIst());
  const [campaignId, setCampaignId] = useState("");
  const [campaigns, setCampaigns] = useState<CampaignFull[]>([]);
  const [campErr, setCampErr] = useState("");
  const [counts, setCounts] = useState<Counts | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [tick, setTick] = useState(0);
  const [open, setOpen] = useState<DrillKind | null>(null);
  const seq = useRef(0);

  // campaigns for the selector (the dashboard still works by dates if this fails)
  useEffect(() => {
    let on = true;
    void rpc<CampaignFull[]>(sb, "growth_campaigns_list").then((r) => {
      if (!on) return;
      if (r.error) setCampErr(r.error); else { setCampErr(""); setCampaigns(r.data ?? []); }
    });
    return () => { on = false; };
  }, [sb]);

  const range = validateRange(from, to);
  const rangeError = campaignId || range.ok ? "" : range.error;

  useEffect(() => {
    if (rangeError) { setLoading(false); setErr(""); setCounts(null); return; }
    const id = ++seq.current;
    setLoading(true); setErr("");
    void rpc<Counts>(sb, "growth_season_counts", buildCountsPayload({ from, to, campaignId })).then((r) => {
      if (id !== seq.current) return; // an older answer arrived late
      setLoading(false);
      if (r.error) { setErr(seasonError(r.code)); setCounts(null); return; }
      setCounts(r.data);
    });
  }, [sb, from, to, campaignId, rangeError, tick]);

  const locked = !!campaignId && !!counts?.locked;
  const ready = !!counts && !loading && !err && !rangeError;
  const campName = campaigns.find((c) => c.id === campaignId)?.name ?? counts?.campaign ?? "";
  const num = (k: DrillKind) => (k === "leads" ? counts?.leads : k === "paid" ? counts?.paid : counts?.enrolled) ?? 0;

  return (
    <div className="mk-wrap">
      <style>{CSS}</style>
      <style>{SD_CSS}</style>
      <div className="mk-page">
        <div className="mk-head">
          <div>
            <h2>Season Dashboard</h2>
            <p>Leads, paid applications and enrolments for the admissions season. Click a card to see the people behind the number.</p>
          </div>
        </div>

        <div className="mk-bar" role="group" aria-label="Season filters">
          <label className="sd-f"><span className="mk-lbl">From</span>
            <input className="mk-in mk-date" type="date" value={locked && counts?.from ? counts.from : from} max={today} disabled={!!campaignId} onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
          </label>
          <label className="sd-f"><span className="mk-lbl">To</span>
            <input className="mk-in mk-date" type="date" value={locked && counts?.to ? counts.to : to} max={today} disabled={!!campaignId} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
          </label>
          <label className="sd-f"><span className="mk-lbl">Campaign</span>
            <select className="mk-sel sd-camp" value={campaignId} onChange={(e) => setCampaignId(e.target.value)} aria-label="Campaign">
              <option value="">All-time</option>
              {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <button className="mk-btn" onClick={() => setTick((t) => t + 1)} disabled={loading || !!rangeError}>Refresh</button>
        </div>

        {rangeError && <div className="mk-err" role="alert">{rangeError}</div>}
        {campErr && <p className="mk-note" role="status">The campaign list could not be loaded ({campErr}). You can still use the dates.</p>}
        {locked && counts && (
          <p className="mk-note" role="status">
            Campaign “{campName}” sets the window to {counts.from} → {counts.to}. Leads are counted in that window; Paid and Enrolments are the leads whose application is on this campaign’s exam date.
          </p>
        )}

        {err && (
          <div className="mk-err sd-err" role="alert">
            <span>{err}</span>
            <button className="mk-btn" onClick={() => setTick((t) => t + 1)}>Try again</button>
          </div>
        )}

        <div className="sd-cards" aria-busy={loading}>
          {CARDS.map((c) => (
            <button key={c.kind} type="button" className={`mk-card sd-card${c.kind === "enrolled" ? " mk-card-a" : ""}`} disabled={!ready}
              onClick={() => setOpen(c.kind)} aria-label={ready ? `${c.label}: ${fmt(num(c.kind))}. Open the list.` : `${c.label}: not available`}>
              <span className="mk-cl">{c.label}</span>
              <span className="mk-cv">{loading ? "…" : counts ? fmt(num(c.kind)) : "—"}</span>
              <span className="mk-cs">{c.hint}</span>
            </button>
          ))}
        </div>
      </div>

      {open && counts && (
        <div className="sd-dlg">
          <DrillDialog sb={sb} kind={open} from={counts.from ?? from} to={counts.to ?? to} campaignId={campaignId} total={num(open)}
            sub={campaignId ? `${campName} · ${counts.from} → ${counts.to}` : `${counts.from} → ${counts.to}`} onClose={() => setOpen(null)} />
        </div>
      )}
    </div>
  );
}

function DrillDialog({ sb, kind, from, to, campaignId, total, sub, onClose }: {
  sb: ReturnType<typeof createClient>; kind: DrillKind; from: string; to: string; campaignId: string; total: number; sub: string; onClose: () => void;
}) {
  const cols = useMemo(() => columnsFor(kind), [kind]);
  const [qSearch, setQSearch] = useState("");
  const [qFilters, setQFilters] = useState<Record<string, string>>({});
  const [applied, setApplied] = useState<{ search: string; filters: Record<string, string> }>({ search: "", filters: {} });
  const [sort, setSort] = useState<SortState>(null);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<DrillResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  const seq = useRef(0);

  // typing waits a moment before it asks the database
  useEffect(() => {
    const t = setTimeout(() => {
      setApplied((a) => (a.search === qSearch && JSON.stringify(a.filters) === JSON.stringify(qFilters) ? a : { search: qSearch, filters: qFilters }));
    }, 300);
    return () => clearTimeout(t);
  }, [qSearch, qFilters]);
  const firstRun = useRef(true);
  useEffect(() => { if (firstRun.current) { firstRun.current = false; return; } setPage(1); }, [applied]);

  useEffect(() => {
    const id = ++seq.current;
    setLoading(true); setErr("");
    const payload = buildDrillPayload({ kind, from, to, campaignId, search: applied.search, filters: applied.filters, sort, page, pageSize: DRILL_PAGE_SIZE });
    void rpc<DrillResult>(sb, "growth_season_drill", payload).then((r) => {
      if (id !== seq.current) return;
      setLoading(false);
      if (r.error) { setErr(seasonError(r.code)); return; }
      setData(r.data);
    });
  }, [sb, kind, from, to, campaignId, applied, sort, page, tick]);

  // a filter can leave fewer pages than the page we are on
  useEffect(() => {
    if (data && !loading) { const p = clampPage(page, data.total, DRILL_PAGE_SIZE); if (p !== page) setPage(p); }
  }, [data, loading, page]);

  const n = (qSearch.trim() ? 1 : 0) + Object.values(qFilters).filter((v) => v.trim()).length;
  const pages = pageCount(data?.total ?? 0, DRILL_PAGE_SIZE);
  const rows = data?.rows ?? [];

  function clear() { setQSearch(""); setQFilters({}); setApplied({ search: "", filters: {} }); setPage(1); }

  async function exportCsv() {
    if (busy) return;
    setBusy(true); setNote("");
    const r = await rpc<DrillResult>(sb, "growth_season_drill", buildDrillPayload({
      kind, from, to, campaignId, search: applied.search, filters: applied.filters, sort, page: 1, pageSize: DRILL_PAGE_SIZE, exportAll: true,
    }));
    setBusy(false);
    if (r.error || !r.data) { setNote(seasonError(r.code)); return; }
    const blob = new Blob(["﻿", toCsv(cols, r.data.rows)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `season-${kind}-${campaignId ? "campaign" : `${from}_${to}`}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNote(r.data.truncated ? `Only the first ${fmt(r.data.rows.length)} of ${fmt(r.data.total)} rows were exported. Narrow the search and export again for the rest.` : `Exported ${fmt(r.data.rows.length)} rows.`);
  }

  return (
    <Modal title={TITLES[kind]} sub={sub} onClose={onClose} wide>
      <div className="sd-tools">
        <input className="mk-in sd-search" type="search" value={qSearch} onChange={(e) => setQSearch(e.target.value)} maxLength={600}
          placeholder="Search name, email, phone, city… (comma = many, ! = leave out)" aria-label="Search" />
        <button className="mk-btn" onClick={clear} disabled={n === 0}>Clear filters ({n})</button>
        <button className="mk-btn" onClick={() => void exportCsv()} disabled={busy || loading || !!err || (data?.total ?? 0) === 0}>{busy ? "Exporting…" : "Export CSV"}</button>
      </div>
      <p className="mk-hint sd-count" aria-live="polite">
        {err ? "" : data ? `${fmt(data.total)} ${data.total === 1 ? "row" : "rows"}${n ? " match" : ""}` : "Loading…"}
        {!err && data && !n && data.total !== total ? ` (card shows ${fmt(total)}; reload the page if numbers changed)` : ""}
      </p>
      {note && <p className="mk-note" role="status">{note}</p>}

      {err ? (
        <div className="mk-err sd-err" role="alert"><span>{err}</span><button className="mk-btn" onClick={() => setTick((t) => t + 1)}>Try again</button></div>
      ) : (
        <div className="mk-tablewrap sd-wrap" aria-busy={loading}>
          <table className="mk-table sd-table" aria-label={`${TITLES[kind]} list`}>
            <thead>
              <tr>
                {cols.map((c) => {
                  const s = sort && sort.col === c.key ? sort.dir : null;
                  return (
                    <th key={c.key} className="mk-sort" scope="col" aria-sort={s === "asc" ? "ascending" : s === "desc" ? "descending" : "none"}>
                      <button type="button" className="sd-th" onClick={() => { setSort(nextSort(sort, c.key)); setPage(1); }}>
                        {c.label}<span aria-hidden="true">{s === "asc" ? " ▲" : s === "desc" ? " ▼" : ""}</span>
                      </button>
                    </th>
                  );
                })}
              </tr>
              <tr className="sd-fr">
                {cols.map((c) => (
                  <th key={c.key} scope="col">
                    <input className="mk-in sd-fin" value={qFilters[c.key] ?? ""} maxLength={100} aria-label={`Filter ${c.label}`} placeholder="Filter"
                      onChange={(e) => setQFilters((f) => ({ ...f, [c.key]: e.target.value }))} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && rows.length === 0 && <tr><td className="mk-mid" colSpan={cols.length}>Loading…</td></tr>}
              {!loading && rows.length === 0 && <tr><td className="mk-mid" colSpan={cols.length}>{n ? "No rows match these filters." : "Nothing in this window yet."}</td></tr>}
              {rows.map((r, i) => (
                <tr key={`${page}-${i}`} style={loading ? { opacity: 0.5 } : undefined}>
                  {cols.map((c) => <td key={c.key}>{cell(r[c.key])}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mk-pager sd-pager">
        <span>Page {fmt(Math.min(page, pages))} of {fmt(pages)}</span>
        <div>
          <button className="mk-btn" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={loading || page <= 1}>Previous</button>
          <button className="mk-btn" onClick={() => setPage((p) => Math.min(pages, p + 1))} disabled={loading || page >= pages}>Next</button>
        </div>
      </div>
    </Modal>
  );
}

const SD_CSS = `
.sd-f{display:flex;align-items:center;gap:8px}
.sd-camp{min-width:200px;max-width:100%}
.sd-cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}
.sd-card{text-align:left;font-family:inherit;color:inherit;cursor:pointer;transition:border-color .15s,transform .15s}
.sd-card:hover:not(:disabled){border-color:rgba(130,150,255,.34);transform:translateY(-2px)}
.sd-card:disabled{cursor:default;opacity:.7}
.sd-card .mk-cv{display:block}
.sd-err{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px;cursor:default}
.sd-dlg .mk-sheet-w{width:min(1180px,100%)}
.sd-tools{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
.sd-search{flex:1;min-width:240px}
.sd-count{margin:10px 0 8px}
.sd-wrap{max-height:52vh}
.sd-table th{padding:0}
.sd-th{background:none;border:0;color:inherit;font:inherit;padding:12px 14px;cursor:pointer;white-space:nowrap;height:44px;box-sizing:border-box}
.sd-fr th{top:44px;padding:6px 8px}
.sd-fin{width:100%;min-width:110px;min-height:30px;padding:4px 8px;font-size:12.5px}
.sd-pager{margin-top:12px}
@media (max-width:760px){.sd-cards{grid-template-columns:1fr}.sd-dlg .mk-modal{padding:8px}.sd-dlg .mk-sheet{padding:16px}.sd-camp{min-width:0;width:100%}.sd-f{flex:1 1 100%}.sd-f .mk-in,.sd-f .mk-sel{flex:1}}
`;

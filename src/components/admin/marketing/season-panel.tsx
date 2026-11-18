"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import type { CampaignFull } from "@/lib/growth/marketing";
import {
  academicYearStart, buildCountsPayload, buildDrillPayload, clampPage, columnsFor, DRILL_PAGE_SIZE, DRILL_PAGE_SIZE_LEADS, pageCount, seasonError, toCsv, validateRange,
  type Counts, type DrillKind, type DrillResult, type SortState,
} from "@/lib/growth/season";
import { CSS, rpc } from "./shared";

/**
 * Growth → Overview → Season Dashboard.
 * Three cards (Total Leads / Paid Applications / Enrolments) and the list behind each one.
 * Numbers and lists come from growth_season_counts / growth_season_drill (migration 0108): admin only, checked in the
 * database, one shared definition so a card and its list cannot disagree. The browser never touches the tables.
 * Layout, card effects and the list popup follow the CRM's Season Dashboard (colours stay on the staging palette).
 */

// lucide icon shapes (same as the CRM), drawn inline so no package is added
const Svg = ({ children, size = 16 }: { children: ReactNode; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);
const IUsers = () => <Svg size={18}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></Svg>;
const ICard = () => <Svg size={18}><rect width="20" height="14" x="2" y="5" rx="2" /><line x1="2" x2="22" y1="10" y2="10" /></Svg>;
const IGrad = () => <Svg size={18}><path d="M22 10v6M2 10l10-5 10 5-10 5z" /><path d="M6 12v5c3 3 9 3 12 0v-5" /></Svg>;
const ICal = () => <Svg size={18}><rect width="18" height="18" x="3" y="4" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></Svg>;
const ISearch = () => <Svg><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></Svg>;
const IDown = () => <Svg><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" x2="12" y1="15" y2="3" /></Svg>;
const IUp = () => <Svg size={13}><path d="m18 15-6-6-6 6" /></Svg>;
const IChev = () => <Svg size={13}><path d="m6 9 6 6 6-6" /></Svg>;
const ISpin = ({ size = 16 }: { size?: number }) => <span className="sd-spin" style={{ width: size, height: size }} aria-hidden="true" />;

const CARDS: { kind: DrillKind; label: string; accent: string; icon: ReactNode }[] = [
  { kind: "leads", label: "Total Leads", accent: "var(--violet)", icon: <IUsers /> },
  { kind: "paid", label: "Paid Applications", accent: "#fb923c", icon: <ICard /> },
  { kind: "enrolled", label: "Enrolments", accent: "var(--cyan)", icon: <IGrad /> },
];
const META = Object.fromEntries(CARDS.map((c) => [c.kind, c])) as Record<DrillKind, (typeof CARDS)[number]>;

const todayIst = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const fmt = (n: number) => n.toLocaleString("en-IN");

/** Same as the CRM: a header click flips newest/largest first ↔ oldest/smallest first. It never goes back to "no sort". */
const toggleSort = (cur: SortState, col: string): SortState => (cur && cur.col === col && cur.dir === "desc" ? { col, dir: "asc" } : { col, dir: "desc" });

function Cell({ v }: { v: unknown }) {
  if (v === null || v === undefined || v === "") return <span className="sd-dim">—</span>;
  if (typeof v === "boolean") return <>{v ? "Yes" : "No"}</>;
  return <>{String(v)}</>;
}

export function SeasonPanel() {
  const [sb] = useState(() => createClient());
  const today = useMemo(() => todayIst(), []);
  const [from, setFrom] = useState(() => academicYearStart(todayIst()));
  const [to, setTo] = useState(() => todayIst());
  // what is typed in the two date boxes; it is applied 250 ms after typing stops (like the CRM)
  const [dFrom, setDFrom] = useState(from);
  const [dTo, setDTo] = useState(to);
  const [campaignId, setCampaignId] = useState("");
  const [campaigns, setCampaigns] = useState<CampaignFull[]>([]);
  const [campErr, setCampErr] = useState("");
  const [counts, setCounts] = useState<Counts | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [tick, setTick] = useState(0);
  const [open, setOpen] = useState<DrillKind | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => { setFrom(dFrom); setTo(dTo); }, 250);
    return () => clearTimeout(t);
  }, [dFrom, dTo]);

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
      <div className="mk-page sd-page">
        <div className="sd-head">
          <h1 className="sd-title">Season Dashboard</h1>
          <p className="sd-sub">3 metrics · click any card to drill into rows</p>
        </div>

        <div className="sd-bar" role="group" aria-label="Season filters">
          {campaignId ? (
            <>
              <span className="sd-eyebrow">Window</span>
              <span className="sd-win">{locked && counts?.from && counts?.to ? <>{counts.from}<i> → </i>{counts.to}</> : "…"}</span>
              <span className="sd-eyebrow sd-lock" title={`Campaign “${campName}” sets the window. Leads are counted in that window; Paid and Enrolments are the leads whose application is on this campaign’s exam date.`}>Locked to campaign</span>
            </>
          ) : (
            <>
              <span className="sd-eyebrow">Range</span>
              <div className="sd-range">
                <span className="sd-rico"><ICal /></span>
                <span className="sd-eyebrow sd-rlbl">Date range</span>
                <label className="sd-df"><span className="sd-eyebrow sd-dl">From</span>
                  <input className="mk-in mk-date sd-date" type="date" value={dFrom} max={today} onChange={(e) => setDFrom(e.target.value)} aria-label="From date" />
                </label>
                <label className="sd-df"><span className="sd-eyebrow sd-dl">To</span>
                  <input className="mk-in mk-date sd-date" type="date" value={dTo} max={today} onChange={(e) => setDTo(e.target.value)} aria-label="To date" />
                </label>
              </div>
            </>
          )}
          <span className="sd-vdiv" aria-hidden="true" />
          <span className="sd-eyebrow sd-acc">Campaign</span>
          <select className="mk-sel sd-camp" value={campaignId} onChange={(e) => setCampaignId(e.target.value)} aria-label="Campaign">
            <option value="">All-time (no campaign)</option>
            {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>

        {rangeError && <div className="mk-err" role="alert">{rangeError}</div>}
        {campErr && <p className="mk-note" role="status">The campaign list could not be loaded ({campErr}). You can still use the dates.</p>}

        {err && (
          <div className="mk-err sd-err" role="alert">
            <span>{err}</span>
            <button className="mk-btn" onClick={() => setTick((t) => t + 1)}>Try again</button>
          </div>
        )}

        <div className="sd-cards" aria-busy={loading}>
          {CARDS.map((c) => (
            <button key={c.kind} type="button" className="sd-card" style={{ ["--sd-a" as string]: c.accent }} disabled={!ready}
              onClick={() => setOpen(c.kind)} aria-label={ready ? `${c.label}: ${fmt(num(c.kind))}. Open the list.` : `${c.label}: not available`}>
              <span className="sd-line" aria-hidden="true" />
              <span className="sd-chead"><span className="sd-cl">{c.label}</span><span className="sd-ci">{c.icon}</span></span>
              <span className="sd-cv">{loading ? "…" : counts ? fmt(num(c.kind)) : "—"}</span>
              <span className="sd-chint">Click to drill into rows →</span>
            </button>
          ))}
        </div>
      </div>

      {open && counts && (
        <DrillDialog sb={sb} kind={open} from={counts.from ?? from} to={counts.to ?? to} campaignId={campaignId} total={num(open)} onClose={() => setOpen(null)} />
      )}
    </div>
  );
}

function DrillDialog({ sb, kind, from, to, campaignId, total, onClose }: {
  sb: ReturnType<typeof createClient>; kind: DrillKind; from: string; to: string; campaignId: string; total: number; onClose: () => void;
}) {
  const meta = META[kind];
  const cols = useMemo(() => columnsFor(kind), [kind]);
  const isLeads = kind === "leads";
  const size = isLeads ? DRILL_PAGE_SIZE_LEADS : DRILL_PAGE_SIZE;
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

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, [onClose]);

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
    const payload = buildDrillPayload({ kind, from, to, campaignId, search: applied.search, filters: applied.filters, sort, page, pageSize: size, maxPageSize: size });
    void rpc<DrillResult>(sb, "growth_season_drill", payload).then((r) => {
      if (id !== seq.current) return;
      setLoading(false);
      if (r.error) { setErr(seasonError(r.code)); return; }
      setData(r.data);
    });
  }, [sb, kind, from, to, campaignId, applied, sort, page, size, tick]);

  // a filter can leave fewer pages than the page we are on
  useEffect(() => {
    if (data && !loading) { const p = clampPage(page, data.total, size); if (p !== page) setPage(p); }
  }, [data, loading, page, size]);

  const n = (qSearch.trim() ? 1 : 0) + Object.values(qFilters).filter((v) => v.trim()).length;
  const pages = pageCount(data?.total ?? 0, size);
  const rows = data?.rows ?? [];
  const shown = data?.total ?? 0;
  const first = shown === 0 ? 0 : (Math.min(page, pages) - 1) * size + 1;
  const last = Math.min(Math.min(page, pages) * size, shown);

  function clear() { setQSearch(""); setQFilters({}); setApplied({ search: "", filters: {} }); setPage(1); }

  async function exportCsv() {
    if (busy) return;
    setBusy(true); setNote("");
    const r = await rpc<DrillResult>(sb, "growth_season_drill", buildDrillPayload({
      kind, from, to, campaignId, search: applied.search, filters: applied.filters, sort, page: 1, pageSize: size, maxPageSize: size, exportAll: true,
    }));
    setBusy(false);
    if (r.error || !r.data) { setNote(seasonError(r.code)); return; }
    const blob = new Blob(["﻿", toCsv(cols, r.data.rows)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${kind}-${from}-to-${to}-${r.data.rows.length}-rows.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNote(r.data.truncated ? `Only the first ${fmt(r.data.rows.length)} of ${fmt(r.data.total)} rows were exported. Narrow the search and export again for the rest.` : `Exported ${fmt(r.data.rows.length)} rows.`);
  }

  const emptyText = isLeads || n > 0 ? "No rows match this search." : "No rows for this window.";

  return (
    <div className="sd-ov" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sd-dlg" role="dialog" aria-modal="true" aria-label={meta.label} style={{ ["--sd-a" as string]: meta.accent }}>
        <div className="sd-dh">
          <h3 className="sd-dt">
            <span className="sd-abar" aria-hidden="true" />
            {meta.label}
            <span className="sd-dsub">
              {isLeads
                ? ` · ${fmt(applied.search && data ? data.total : total)} rows${applied.search ? ` matching "${applied.search}"` : ""}`
                : ` · ${fmt(total)} rows${n > 0 && data ? ` · ${fmt(data.total)} after filters` : ""}`}
            </span>
          </h3>
          <button className="sd-x" onClick={onClose} aria-label="Close"><Svg size={18}><path d="M18 6 6 18M6 6l12 12" /></Svg></button>
        </div>

        <div className="sd-tb">
        <div className="sd-tools">
          <div className="sd-sw">
            <span className="sd-si"><ISearch /></span>
            <input className="mk-in sd-search" type="search" autoFocus value={qSearch} onChange={(e) => setQSearch(e.target.value)} maxLength={600} aria-label="Search"
              placeholder={isLeads ? "Search all columns — comma for many, ! to exclude (e.g. google, !test)" : "Search all columns — comma for many, ! to exclude (e.g. PCM, PCMB, !test)"} />
            {isLeads && loading && data && <span className="sd-sp"><ISpin /></span>}
          </div>
          <button className="sd-exp" onClick={() => void exportCsv()} disabled={busy || loading || !!err || shown === 0}>
            <span className="sd-expi"><IDown /></span>{busy ? "Exporting…" : `Export CSV (${fmt(shown)})`}
          </button>
          {!isLeads && n > 0 && <button className="sd-ghost" onClick={clear}>Clear filters ({n})</button>}
        </div>
        {!isLeads && <p className="sd-tip">Tip: comma-separate to match several (PCM, PCMB); prefix ! to exclude (!Enrolled). Works in every column box too.</p>}
        {note && <p className="sd-tip" role="status">{note}</p>}
        {!err && data && !n && data.total !== total && <p className="sd-tip" role="status">The card shows {fmt(total)}; close and reopen after reloading the page if the numbers changed.</p>}

        </div>

        <div className="sd-body" aria-busy={loading}>
          {err ? (
            <div className="sd-qerr" role="alert"><b>Query error</b><span>{err}</span><button className="sd-ghost" onClick={() => setTick((t) => t + 1)}>Try again</button></div>
          ) : loading && rows.length === 0 ? (
            <div className="sd-mid"><ISpin />Loading rows…</div>
          ) : rows.length === 0 && (isLeads || n === 0) ? (
            <div className="sd-mid">{emptyText}</div>
          ) : (
            <table className="sd-table" aria-label={`${meta.label} list`}>
              <thead>
                <tr>
                  {cols.map((c) => {
                    const s = sort && sort.col === c.key ? sort.dir : null;
                    return (
                      <th key={c.key} scope="col" aria-sort={s === "asc" ? "ascending" : s === "desc" ? "descending" : "none"}>
                        <button type="button" className="sd-th" onClick={() => { setSort(toggleSort(sort, c.key)); setPage(1); }}>
                          {c.label}{s === "asc" ? <IUp /> : s === "desc" ? <IChev /> : null}
                        </button>
                      </th>
                    );
                  })}
                </tr>
                {!isLeads && (
                  <tr className="sd-fr">
                    {cols.map((c) => (
                      <th key={c.key} scope="col">
                        <input className="sd-fin" value={qFilters[c.key] ?? ""} maxLength={100} aria-label={`Filter ${c.label}`} placeholder="filter… (a, b, !c)"
                          onChange={(e) => setQFilters((f) => ({ ...f, [c.key]: e.target.value }))} />
                      </th>
                    ))}
                  </tr>
                )}
              </thead>
              <tbody style={loading ? { opacity: 0.5 } : undefined}>
                {rows.map((r, i) => (
                  <tr key={`${page}-${i}`}>{cols.map((c) => <td key={c.key}><Cell v={r[c.key]} /></td>)}</tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {!err && !(shown === 0 && !loading) && (
        <div className="sd-foot">
          <span>{`Showing ${fmt(first)}–${fmt(last)} of ${fmt(shown)}`}</span>
          <div className="sd-pg">
            <button className="sd-pb" onClick={() => setPage(1)} disabled={loading || page <= 1}>First</button>
            <button className="sd-pb" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={loading || page <= 1}>Prev</button>
            <span className="sd-pn">{fmt(Math.min(page, pages))} / {fmt(pages)}</span>
            <button className="sd-pb" onClick={() => setPage((p) => Math.min(pages, p + 1))} disabled={loading || page >= pages}>Next</button>
            <button className="sd-pb" onClick={() => setPage(pages)} disabled={loading || page >= pages}>Last</button>
          </div>
        </div>
        )}
      </div>
    </div>
  );
}

const SD_CSS = `
.sd-page{gap:16px}
.sd-head{display:flex;flex-direction:column;gap:6px}
.sd-title{font-family:var(--mk-head);font-weight:800;font-size:30px;line-height:1.1;letter-spacing:-.03em;margin:0;background:linear-gradient(135deg,var(--ink) 30%,var(--mut));-webkit-background-clip:text;background-clip:text;color:transparent;width:fit-content}
.sd-sub{margin:0;font-size:13px;font-weight:600;color:var(--mut)}
.sd-eyebrow{font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--mut);white-space:nowrap}
.sd-acc{color:#fb923c}
.sd-bar{display:flex;flex-wrap:wrap;align-items:center;gap:16px;background:var(--panel);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border:1px solid var(--line);border-radius:14px;padding:12px 16px}
.sd-range{display:flex;flex-wrap:wrap;align-items:flex-end;gap:20px;margin-bottom:24px;background:rgba(130,150,255,.05);border:1px solid var(--line);border-radius:16px;padding:20px}
.sd-rico{display:grid;place-items:center;width:34px;height:34px;border-radius:10px;background:rgba(139,92,246,.18);color:#c4b5fd;align-self:center}
.sd-rlbl{align-self:center;font-weight:500;color:var(--mut2);letter-spacing:.18em}
.sd-df{display:flex;flex-direction:column;gap:6px}
.sd-dl{font-size:10px;line-height:15px;font-weight:500;letter-spacing:.18em;color:var(--mut2)}
.sd-date{width:176px;font-size:14px;font-weight:400;padding:4px 10px;min-height:32px}
.sd-win{font-size:13px;font-weight:700;color:var(--ink);font-variant-numeric:tabular-nums}.sd-win i{font-style:normal;color:var(--mut)}
.sd-lock{font-size:10px;font-weight:600;color:var(--mut2);cursor:help}
.sd-vdiv{width:1px;align-self:stretch;min-height:24px;background:var(--line)}
.sd-camp{min-width:200px;max-width:100%;font-size:13px;font-weight:700;min-height:35px;padding:8px 12px;border-color:rgba(251,146,60,.3);border-radius:10px;cursor:pointer;transition:none}
.sd-camp:focus{border-color:rgba(251,146,60,.6)}
.sd-cards{display:grid;grid-template-columns:1fr;gap:16px}
.sd-card{position:relative;overflow:hidden;display:flex;flex-direction:column;gap:10px;text-align:left;font-family:inherit;color:inherit;cursor:pointer;background:var(--panel);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border:1px solid var(--line);border-radius:16px;padding:16px;transition:transform .15s cubic-bezier(.4,0,.2,1),border-color .15s cubic-bezier(.4,0,.2,1)}
.sd-card:hover:not(:disabled){transform:translateY(-2px);border-color:rgba(130,150,255,.3)}
.sd-card:disabled{cursor:default;opacity:.7}
.sd-line{position:absolute;inset:0 0 auto 0;height:2px;opacity:.75;background:linear-gradient(90deg,transparent,var(--sd-a),transparent)}
.sd-chead{display:flex;align-items:center;justify-content:space-between;gap:8px}
.sd-cl{font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--mut)}
.sd-ci{display:grid;color:var(--sd-a);opacity:.5}
.sd-cv{font-family:var(--mk-head);font-weight:800;font-size:32px;line-height:1.1;letter-spacing:-.02em;color:var(--sd-a);font-variant-numeric:tabular-nums}
.sd-chint{font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--mut);opacity:0;transition:opacity .15s;min-height:15px;line-height:15px}
.sd-card:hover:not(:disabled) .sd-chint,.sd-card:focus-visible .sd-chint{opacity:1}
.sd-err{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px;cursor:default}
.sd-ov{position:fixed;inset:0;z-index:60;display:grid;place-items:center;background:rgba(4,6,16,.72);backdrop-filter:blur(4px)}
.sd-dlg{position:relative;display:flex;flex-direction:column;width:100vw;height:100dvh;background:var(--bg2);border:1px solid rgba(130,150,255,.14);overflow:hidden;box-sizing:border-box;color:var(--ink);font-family:var(--mk-ui)}
.sd-dh{display:flex;align-items:flex-start;padding:16px 48px 16px 16px;border-bottom:1px solid var(--line);flex-shrink:0}
.sd-dt{display:flex;flex-wrap:wrap;align-items:center;gap:12px;margin:0;font-family:var(--mk-head);font-weight:700;font-size:24px;line-height:32px;letter-spacing:-.025em;color:var(--ink)}
.sd-abar{width:4px;height:28px;border-radius:999px;background:var(--sd-a)}
.sd-dsub{font-family:var(--mk-ui);font-weight:500;font-size:14px;line-height:19px;letter-spacing:0;color:var(--mut)}
.sd-x{position:absolute;top:8px;right:8px;display:grid;place-items:center;width:28px;height:28px;background:none;border:0;border-radius:8px;color:var(--mut);cursor:pointer;transition:background .15s,color .15s}.sd-x:hover{color:var(--ink);background:rgba(130,150,255,.1)}
.sd-tb{display:flex;flex-direction:column;gap:8px;padding:12px 16px;border-bottom:1px solid var(--line);flex-shrink:0}
.sd-tools{display:flex;align-items:center;gap:12px}
.sd-sw{position:relative;flex:1;min-width:0}
.sd-si{position:absolute;left:12px;top:50%;transform:translateY(-50%);display:grid;color:var(--mut);pointer-events:none}
.sd-search{width:100%;min-height:32px;height:32px;padding:4px 36px 4px 36px;font-size:14px}
.sd-sp{position:absolute;right:12px;top:50%;transform:translateY(-50%);display:grid;color:var(--mut)}
.sd-exp{display:inline-flex;flex-shrink:0;align-items:center;justify-content:center;gap:8px;font:inherit;font-size:12.8px;font-weight:500;height:36px;padding:0 12px;border-radius:8px;cursor:pointer;white-space:nowrap;background:transparent;color:var(--ink);border:1px solid color-mix(in srgb,var(--sd-a) 38%,transparent);transition:background .15s}
.sd-exp:hover:not(:disabled){background:rgba(130,150,255,.08)}
.sd-exp:disabled{opacity:.5;cursor:default}
.sd-expi{display:grid;color:var(--sd-a)}
.sd-ghost{flex-shrink:0;font:inherit;font-size:12.8px;font-weight:500;height:36px;padding:0 12px;border-radius:8px;background:none;border:0;color:var(--mut);cursor:pointer;white-space:nowrap;transition:background .15s,color .15s}.sd-ghost:hover{color:var(--ink);background:rgba(130,150,255,.1)}
.sd-tip{margin:0;font-size:11px;line-height:1.5;color:var(--mut2)}
.sd-body{flex:1;min-height:0;overflow:auto}
.sd-mid{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;height:100%;min-height:200px;font-size:13px;color:var(--mut)}
.sd-qerr{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;height:100%;min-height:200px;padding:20px;text-align:center;font-size:13px;color:#ffd4dc}.sd-qerr b{color:#ff8fa3}
.sd-spin{display:inline-block;border:2px solid rgba(130,150,255,.25);border-top-color:var(--ink);border-radius:50%;animation:sd-rot .8s linear infinite}
@keyframes sd-rot{to{transform:rotate(360deg)}}
.sd-table{width:100%;min-width:760px;border-collapse:collapse;font-size:13px}
.sd-table thead{position:sticky;top:0;z-index:2;background:var(--bg2)}
.sd-table th{text-align:left;padding:0;white-space:nowrap;font-weight:600}
.sd-table thead tr:first-child th{border-bottom:1px solid var(--line)}
.sd-table tr.sd-fr th{padding:6px 8px;border-bottom:1px solid var(--line)}
.sd-th{display:inline-flex;align-items:center;gap:4px;width:100%;min-width:140px;height:38px;box-sizing:border-box;padding:10px 12px;background:none;border:0;color:var(--mut);font:inherit;font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;cursor:pointer}.sd-th:hover{color:var(--ink)}
.sd-fin{width:100%;min-width:120px;box-sizing:border-box;height:25px;padding:4px 8px;font:inherit;font-size:11px;line-height:1.2;color:var(--ink);background:rgba(130,150,255,.06);border:1px solid rgba(130,150,255,.14);border-radius:4px;outline:none}.sd-fin:focus{border-color:rgba(139,92,246,.6)}.sd-fin::placeholder{color:var(--mut2)}
.sd-table td{padding:8px 12px;line-height:19px;height:35px;box-sizing:border-box;white-space:nowrap;color:var(--mk-soft)}
.sd-table tbody tr:hover td{background:rgba(130,150,255,.06)}
.sd-dim{color:var(--mut2);opacity:.6}
.sd-foot{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;padding:12px 16px;border-top:1px solid var(--line);font-size:13px;color:var(--mut);flex-shrink:0}
.sd-pg{display:flex;align-items:center;gap:8px}
.sd-pb{font:inherit;font-size:12.8px;font-weight:500;height:32px;padding:0 12px;border-radius:8px;cursor:pointer;background:rgba(130,150,255,.04);border:1px solid rgba(130,150,255,.14);color:var(--ink);transition:background .15s}.sd-pb:hover:not(:disabled){background:rgba(130,150,255,.1)}.sd-pb:disabled{opacity:.5;cursor:default}
.sd-pn{padding:0 12px;font-weight:600;font-variant-numeric:tabular-nums}
@media (min-width:768px){
  .sd-title{font-size:48px}
  .sd-card{padding:24px;min-height:157px}
  .sd-cv{font-size:44px}
  .sd-dlg{width:75vw;height:85vh;border-radius:10px}
  .sd-dh{padding:24px 48px 16px 24px}
  .sd-tb{padding:12px 24px}.sd-foot{padding:12px 24px}
}
/* 3 cards from 1024 (the CRM goes to 3 at 768 and clips the numbers there) */
@media (min-width:1024px){.sd-cards{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media (max-width:760px){.sd-camp{min-width:0;width:100%}.sd-range{padding:12px;margin-bottom:0}.sd-date{width:140px}.sd-vdiv{display:none}.sd-bar{gap:10px}}
`;

"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import type { CampaignFull } from "@/lib/growth/marketing";
import { campaignOption } from "@/lib/growth/vcamp";
import {
  buildCohortPayload, buildMatrix, checkRange, cohortError, conversion, fmtDay, fmtFull, fmtShort, heatAlpha, summarySource,
  type CohortReport, type MatrixRow,
} from "@/lib/growth/cohort";
import { CSS, rpc } from "./shared";

/**
 * Growth → Overview → Payment Cohort.
 * Copy of the CRM page /cohort: campaign selector, date range, summary bar, 4 tiles and the lead-date × payment-date
 * matrix with the same-day ring and heat. Every number comes from growth_cohort_report (migration 0117): admin only,
 * checked in the database, which also decides the default window ("today", IST) and the 120-day limit. Only day counts
 * reach the browser. The CRM's campus picker (ALL / GGN / PUNE) is not built (owner's decision).
 * Fixes over the CRM (same way as the Season / VSAT Report panels): controls full width on small screens, tiles go to
 * 4 columns only when the page area is wide enough, the matrix scrolls inside its card, old numbers are dimmed while
 * loading, and bad / reversed / too-long ranges show a sentence instead of zeros.
 */

// lucide icon shapes (same as the CRM), drawn inline so no package is added
const Svg = ({ children }: { children: ReactNode }) => (
  <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);
const ITarget = () => <Svg><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" /></Svg>;
const ICal = () => <Svg><rect width="18" height="18" x="3" y="4" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></Svg>;

// CRM accents → staging palette (purple #8A18FF, orange #F97D03, cyan #00CFE5, pink #E80074)
const VIOLET = "var(--violet)";
const ORANGE = "#fb923c";
const CYAN = "var(--cyan)";
const PINK = "#ff8fa3";
const heat = (a: number) => (a > 0 ? `rgba(251,146,60,${a.toFixed(3)})` : undefined);
const fmtIN = (n: number) => n.toLocaleString("en-IN");

type Query = { campaignId: string; from: string; to: string };

function Tile({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="pco-tile" style={{ ["--pco-a" as string]: accent }}>
      <span className="pco-tline" aria-hidden="true" />
      <div className="pco-tl">{label}</div>
      <div className="pco-tv">{value}</div>
    </div>
  );
}

const Dot = () => <span className="pco-dot">·</span>;

function Row({ row, days, maxCell }: { row: MatrixRow; days: string[]; maxCell: number }) {
  const cls = row.kind === "day" ? "pco-r" : row.kind === "unknown" ? "pco-r pco-ru" : "pco-r pco-rb";
  return (
    <tr className={cls}>
      <th scope="row" className="pco-rl" title={row.title}>
        {row.label}
        {row.sub && <div className="pco-rsub">{row.sub}</div>}
      </th>
      {row.leads === null ? <td className="pco-lc pco-lcx"><Dot /></td> : <td className="pco-lc">{row.leads || <Dot />}</td>}
      {row.cells.map((n, j) => {
        // CRM: the Unknown row gets no heat colour; a ring marks a same-day payment (lead day = pay day)
        const a = row.kind === "unknown" ? 0 : heatAlpha(n, maxCell);
        const same = row.kind === "day" && n > 0 && row.day === days[j];
        return (
          <td key={days[j]} className={n > 0 ? (same ? "pco-c pco-on pco-same" : "pco-c pco-on") : "pco-c"} style={{ backgroundColor: heat(a) }}>
            {n || <Dot />}
          </td>
        );
      })}
      <td className="pco-rt">{row.total || <Dot />}</td>
    </tr>
  );
}

export function CohortPanel() {
  const [sb] = useState(() => createClient());
  const [campaigns, setCampaigns] = useState<CampaignFull[]>([]);
  const [campErr, setCampErr] = useState("");
  const [q, setQ] = useState<Query>({ campaignId: "", from: "", to: "" });   // all empty = the database's last 30 days
  const [dFrom, setDFrom] = useState("");
  const [dTo, setDTo] = useState("");
  const [rangeErr, setRangeErr] = useState("");
  const [report, setReport] = useState<CohortReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [tick, setTick] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // campaigns for the selector (same list and order as the VSAT Campaign Report)
  useEffect(() => {
    let on = true;
    void rpc<CampaignFull[]>(sb, "growth_campaigns_list").then((r) => {
      if (!on) return;
      if (r.error) setCampErr(r.error);
      else setCampaigns(Array.isArray(r.data) ? r.data : []);
    });
    return () => { on = false; };
  }, [sb]);

  // the matrix (old numbers stay on screen, dimmed, until the new ones arrive)
  useEffect(() => {
    let on = true;
    setLoading(true);
    setErr("");
    void rpc<CohortReport>(sb, "growth_cohort_report", buildCohortPayload(q)).then((r) => {
      if (!on) return;
      setLoading(false);
      if (r.error) { setErr(cohortError(r.code, { campaign: !!q.campaignId })); return; }
      setReport(r.data);
      setDFrom(r.data?.from ?? "");
      setDTo(r.data?.to ?? "");
    });
    return () => { on = false; };
  }, [sb, q, tick]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  // CRM: typing a date waits 250 ms, then asks for that custom range (the campaign is dropped)
  const onDate = (from: string, to: string) => {
    setDFrom(from);
    setDTo(to);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const c = checkRange(from, to);
      if (!c.ok) { setRangeErr(c.error); return; }
      setRangeErr("");
      setQ({ campaignId: "", from, to });
    }, 250);
  };

  // a campaign locks the dates to its window; "Choose a campaign…" unlocks them (they keep the window shown)
  const onCampaign = (id: string) => {
    if (timer.current) clearTimeout(timer.current);
    setRangeErr("");
    setQ(id ? { campaignId: id, from: "", to: "" } : { campaignId: "", from: dFrom, to: dTo });
  };

  const locked = !!q.campaignId;
  const m = buildMatrix(report);
  const camp = report?.campaign ?? null;
  const beforeRow = m.rows.find((r) => r.kind === "before");
  const empty = !!report && m.grand === 0 && m.totalLeads === 0;

  return (
    <div className="mk-wrap">
      <style>{CSS}</style>
      <style>{PCO_CSS}</style>
      <div className="mk-page pco-page">
        <div className="pco-head">
          <h1 className="pco-title">Payment Cohort</h1>
          <p className="pco-sub">Lead date × payment date · same-day diagonal + heat intensity</p>
        </div>

        <div className="pco-filters">
          <div className="pco-card">
            <div className="pco-tag">
              <span className="pco-tico pco-tico-o"><ITarget /></span>
              <span className="pco-eye">Campaign</span>
            </div>
            <div className="pco-field pco-fsel">
              <label htmlFor="pco-campaign" className="pco-eye">Select</label>
              <select id="pco-campaign" className="pco-select" value={q.campaignId} onChange={(e) => onCampaign(e.target.value)}>
                <option value="">Choose a campaign…</option>
                {campaigns.map((c) => <option key={c.id} value={c.id}>{campaignOption(c)}</option>)}
                {locked && camp && !campaigns.some((c) => c.id === camp.id) && <option value={camp.id}>{camp.name}</option>}
              </select>
            </div>
          </div>

          <div className="pco-card">
            <div className="pco-tag">
              <span className="pco-tico pco-tico-v"><ICal /></span>
              <span className="pco-eye">Date Range</span>
            </div>
            <div className="pco-field pco-fdate">
              <label htmlFor="pco-from" className="pco-eye">From</label>
              <input id="pco-from" className="pco-date" type="date" value={dFrom} disabled={locked}
                onChange={(e) => onDate(e.target.value, dTo)} />
            </div>
            <div className="pco-field pco-fdate">
              <label htmlFor="pco-to" className="pco-eye">To</label>
              <input id="pco-to" className="pco-date" type="date" value={dTo} disabled={locked}
                onChange={(e) => onDate(dFrom, e.target.value)} />
            </div>
          </div>
        </div>

        {locked && <p className="mk-note pco-lock">Dates follow the campaign window. Choose “Choose a campaign…” to pick your own dates.</p>}
        {campErr && <p className="mk-note" role="status">The campaign list could not be loaded ({campErr}).</p>}
        {rangeErr && <div className="mk-err pco-err" role="alert"><span>{rangeErr}</span></div>}
        {err && (
          <div className="mk-err pco-err" role="alert">
            <span>{err}</span>
            <button className="mk-btn" onClick={() => setTick((t) => t + 1)}>Try again</button>
          </div>
        )}

        {!report ? (
          loading && <div className="pco-empty" role="status"><span className="pco-spin" aria-hidden="true" /> Loading the cohort…</div>
        ) : (
          <div className={loading ? "pco-body pco-dim" : "pco-body"} aria-busy={loading}>
            <div className="pco-bar">
              <span className="pco-bar-eye">Showing matrix</span>
              <span className="pco-sep">·</span>
              <span className="pco-bar-d">{fmtFull(report.from)}</span>
              <span className="pco-sep">→</span>
              <span className="pco-bar-d">{fmtFull(report.to)}</span>
              <span className="pco-sep">·</span>
              <span className="pco-bar-s">{summarySource(report)}</span>
              {loading && <span className="pco-busy" role="status"><span className="pco-spin" aria-hidden="true" />Loading…</span>}
            </div>

            <div className="pco-tiles">
              <Tile label="Total Leads" value={fmtIN(m.totalLeads)} accent={VIOLET} />
              <Tile label="Total Paid" value={fmtIN(m.grand)} accent={ORANGE} />
              <Tile label="Conversion" value={`${conversion(m.grand, m.totalLeads)}%`} accent={CYAN} />
              <Tile label="Range Days" value={String(m.days.length)} accent={PINK} />
            </div>

            {empty && <p className="mk-note pco-none" role="status">No leads and no payments in this range.</p>}

            <div className="pco-mx">
              <span className="pco-mline" aria-hidden="true" />
              <div className="pco-scroll">
                <table className="pco-table">
                  <thead>
                    <tr>
                      <th scope="col" className="pco-h0">Lead ↓ / Pay →</th>
                      <th scope="col" className="pco-hl">Leads</th>
                      {m.days.map((d) => <th scope="col" key={d} className="pco-hd" title={fmtFull(d)}>{fmtDay(d)}</th>)}
                      <th scope="col" className="pco-ht">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {m.rows.map((row) => <Row key={row.key} row={row} days={m.days} maxCell={m.maxCell} />)}
                    <tr className="pco-tot">
                      <th scope="row" className="pco-tot0">Total</th>
                      <td className="pco-totl">{m.totalLeads}</td>
                      {m.days.map((d, j) => <td key={d} className="pco-totc">{m.colTotals[j] || <Dot />}</td>)}
                      <td className="pco-totg">{m.grand}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div className="pco-legend">
              <div className="pco-li"><span className="pco-sw pco-sw-ring" />Same-day conversion</div>
              <div className="pco-li pco-li-heat">
                <span className="pco-heat-eye">Heat:</span>
                {[0.15, 0.35, 0.55, 0.67].map((o) => <span key={o} className="pco-sw" style={{ backgroundColor: heat(o) }} />)}
              </div>
              {beforeRow && <div className="pco-li"><span className="pco-sw pco-sw-before" />Lead came in before {fmtShort(report.from)}</div>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// own prefix `pco-` (checked unused; College Predictor's globals use `cp-`). Sizes are the CRM's (measured).
const PCO_CSS = `
.pco-page{gap:0}
.pco-head{margin-bottom:24px}
.pco-title{font-family:var(--mk-head);font-weight:800;font-size:30px;line-height:1;letter-spacing:-.025em;margin:0;background:linear-gradient(135deg,var(--ink) 30%,var(--mut));-webkit-background-clip:text;background-clip:text;color:transparent;width:fit-content}
.pco-sub{margin:8px 0 0;font-size:13px;font-weight:600;color:var(--mut)}
.pco-eye{display:block;font-size:10px;font-weight:500;letter-spacing:.18em;text-transform:uppercase;color:var(--mut2);white-space:nowrap}
.pco-filters{display:flex;flex-wrap:wrap;align-items:flex-end;gap:12px;margin-bottom:16px}
.pco-card{display:flex;flex-wrap:wrap;align-items:flex-end;gap:20px;margin-bottom:24px;padding:20px;max-width:100%;box-sizing:border-box;background:var(--panel);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);border:1px solid var(--line);border-radius:16px}
.pco-tag{display:flex;align-items:center;gap:8px;margin-right:8px;align-self:center}
.pco-tico{display:grid;place-items:center;padding:8px;border-radius:8px}
.pco-tico-o{background:rgba(251,146,60,.1);border:1px solid rgba(251,146,60,.2);color:${ORANGE}}
.pco-tico-v{background:rgba(139,92,246,.1);border:1px solid rgba(139,92,246,.2);color:var(--violet)}
.pco-field{display:flex;flex-direction:column;gap:6px;min-width:0;max-width:100%}
.pco-select{height:36px;width:420px;max-width:100%;box-sizing:border-box;padding:0 12px;font:inherit;font-size:14px;color:var(--ink);background:rgba(130,150,255,.06);border:1px solid var(--line);border-radius:8px;outline:none;cursor:pointer}
.pco-select:focus{border-color:rgba(139,92,246,.5);box-shadow:0 0 0 2px rgba(139,92,246,.3)}
.pco-select option{background:var(--bg2);color:var(--ink)}
.pco-date{height:32px;width:176px;max-width:100%;box-sizing:border-box;padding:4px 10px;font:inherit;font-size:14px;color:var(--ink);color-scheme:dark;background:rgba(130,150,255,.06);border:1px solid var(--line);border-radius:10px;outline:none;transition:color .15s,border-color .15s,box-shadow .15s}
.pco-date:focus{border-color:rgba(139,92,246,.5);box-shadow:0 0 0 2px rgba(139,92,246,.3)}
.pco-date:disabled{opacity:.55;cursor:not-allowed}
.pco-lock{margin:-24px 0 16px}
.pco-err{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px;margin-bottom:16px;cursor:default}
.pco-empty{display:flex;align-items:center;justify-content:center;gap:10px;padding:32px;text-align:center;background:var(--panel);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border:1px solid var(--line);border-radius:16px;color:var(--mut);font-size:15px;font-weight:600}
.pco-spin{display:inline-block;width:14px;height:14px;border:2px solid rgba(130,150,255,.25);border-top-color:var(--ink);border-radius:50%;animation:pco-rot .8s linear infinite}
@keyframes pco-rot{to{transform:rotate(360deg)}}
.pco-body{min-width:0;transition:opacity .15s;container-type:inline-size}
.pco-dim{opacity:.55}
.pco-bar{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-bottom:20px;padding:12px 16px;font-size:13px;background:var(--panel);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border:1px solid var(--line);border-radius:14px}
.pco-bar-eye{font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--mut)}
.pco-sep{color:var(--mut2);opacity:.7}
.pco-bar-d{font-weight:700;color:var(--ink);font-variant-numeric:tabular-nums}
.pco-bar-s{font-weight:600;color:var(--mk-soft)}
.pco-busy{display:inline-flex;align-items:center;gap:8px;margin-left:auto;font-size:12px;font-weight:600;color:var(--mut)}
.pco-tiles{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-bottom:24px}
.pco-tile{position:relative;overflow:hidden;min-width:0;padding:20px;background:var(--panel);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border:1px solid var(--line);border-radius:16px;transition:border-color .15s cubic-bezier(.4,0,.2,1)}
.pco-tile:hover{border-color:rgba(130,150,255,.24)}
.pco-tline{position:absolute;inset:0 0 auto 0;height:2px;opacity:.75;background:linear-gradient(90deg,transparent,var(--pco-a),transparent)}
.pco-tl{margin-bottom:12px;font-size:11px;font-weight:700;line-height:1;letter-spacing:.12em;text-transform:uppercase;color:var(--mut);overflow-wrap:anywhere}
.pco-tv{font-family:var(--mk-head);font-size:28px;font-weight:800;line-height:1;letter-spacing:-.025em;color:var(--pco-a);font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.pco-none{margin:-8px 0 16px}
.pco-mx{position:relative;overflow:hidden;background:var(--panel);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border:1px solid var(--line);border-radius:16px}
.pco-mline{position:absolute;inset:0 0 auto 0;z-index:1;height:2px;opacity:.75;background:linear-gradient(90deg,transparent,var(--violet),${ORANGE},transparent)}
.pco-scroll{overflow-x:auto}
.pco-table{width:100%;border-collapse:collapse;font-size:14px}
.pco-table thead tr{border-bottom:2px solid rgba(130,150,255,.24)}
.pco-table th,.pco-table td{font-variant-numeric:tabular-nums}
.pco-h0,.pco-hl,.pco-ht{padding:12px 16px;font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;white-space:nowrap}
.pco-h0{text-align:left;color:var(--mut);border-right:1px solid var(--line)}
.pco-hl{padding:12px;text-align:center;color:var(--violet);border-right:1px solid var(--line)}
.pco-ht{padding:12px;text-align:center;color:var(--mut);border-left:1px solid var(--line)}
.pco-hd{min-width:40px;padding:12px 8px;text-align:center;font-size:13px;font-weight:700;color:var(--mk-soft)}
.pco-r{border-bottom:1px solid var(--line);transition:background-color .15s cubic-bezier(.4,0,.2,1)}
.pco-rb{background:rgba(139,92,246,.04)}
.pco-ru{background:rgba(255,143,163,.04)}
.pco-r:hover{background:rgba(130,150,255,.08)}
.pco-rl{padding:10px 16px;text-align:left;font-size:13px;font-weight:700;color:var(--mk-soft);white-space:nowrap;border-right:1px solid var(--line)}
.pco-rsub{margin-top:2px;font-size:10px;font-weight:600;color:var(--mut)}
.pco-lc{padding:10px 12px;text-align:center;font-size:13px;font-weight:700;color:var(--violet);background:rgba(139,92,246,.06);border-right:1px solid var(--line)}
.pco-lcx{background:transparent}
.pco-c{padding:10px 8px;text-align:center;font-size:13px;color:var(--mut2)}
.pco-on{font-weight:700;color:var(--ink)}
.pco-same{box-shadow:inset 0 0 0 2px ${ORANGE}}
.pco-rt{padding:10px 12px;text-align:center;font-size:13px;font-weight:700;color:var(--ink);border-left:1px solid var(--line)}
.pco-dot{color:var(--mut2);font-weight:400}
.pco-tot{border-top:2px solid rgba(130,150,255,.24);background:rgba(130,150,255,.08)}
.pco-tot0{padding:12px 16px;text-align:left;font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--ink);white-space:nowrap;border-right:1px solid var(--line)}
.pco-totl{padding:12px;text-align:center;font-size:14px;font-weight:800;color:var(--violet);background:rgba(139,92,246,.12);border-right:1px solid var(--line)}
.pco-totc{padding:12px 8px;text-align:center;font-size:13px;font-weight:800;color:var(--ink)}
.pco-totg{padding:12px;text-align:center;font-size:14px;font-weight:800;color:${ORANGE};border-left:1px solid var(--line)}
.pco-legend{display:flex;flex-wrap:wrap;align-items:center;gap:20px;margin-top:16px;font-size:12px;font-weight:600;color:var(--mk-soft)}
.pco-li{display:flex;align-items:center;gap:8px}
.pco-li-heat{gap:6px}
.pco-heat-eye{font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--mut)}
.pco-sw{display:inline-block;width:16px;height:16px;border-radius:4px}
.pco-sw-ring{box-shadow:inset 0 0 0 2px ${ORANGE}}
.pco-sw-before{background:rgba(139,92,246,.15)}
@media (min-width:768px){.pco-title{font-size:48px}}
/* 4 tiles only when the page area (not the window) is wide enough: at 768 the CRM's tiles were 97px and clipped */
@container (min-width:880px){.pco-tiles{grid-template-columns:repeat(4,minmax(0,1fr))}}
/* small screens: the cards and controls take the full width, so nothing pushes the page sideways (CRM break at ≤480) */
@media (max-width:760px){.pco-card{flex:1 1 100%;gap:12px;padding:16px;margin-bottom:12px}.pco-fsel{flex:1 1 100%}.pco-select{width:100%}.pco-fdate{flex:1 1 130px}.pco-date{width:100%}.pco-lock{margin:-12px 0 16px}}
`;

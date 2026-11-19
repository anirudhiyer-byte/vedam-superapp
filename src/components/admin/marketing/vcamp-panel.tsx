"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import type { CampaignFull } from "@/lib/growth/marketing";
import {
  buildReportPayload, campaignOption, fmtIN, gapNote, metrics, reportRows, toSplit, vcampError, type Report,
} from "@/lib/growth/vcamp";
import { CSS, rpc } from "./shared";

/**
 * Growth → Overview → VSAT Campaign Report.
 * Copy of the CRM page /morning-report: campaign selector, 4 cards (Target / Achievement / Remaining / Days to Go) and a
 * 7-row matrix split by campus. Every number comes from growth_vcamp_report (migration 0116): admin only, checked in
 * the database, which also decides "today" (IST) and the default campaign. The browser never touches the tables.
 * Colours stay on the staging palette. Mobile does not clip (dropdown full width, 4 cards from 1024, table scrolls).
 */

// lucide icon shapes (same as the CRM), drawn inline so no package is added
const Svg = ({ children, size = 16 }: { children: ReactNode; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);
const ITrophy = () => (
  <Svg><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" /><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" /><path d="M4 22h16" />
    <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" /><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
    <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" /></Svg>
);
const ITarget = () => <Svg><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" /></Svg>;
const IDown = () => <Svg><polyline points="22 17 13.5 8.5 8.5 13.5 2 7" /><polyline points="16 17 22 17 22 11" /></Svg>;
const ICal = () => <Svg><rect width="18" height="18" x="3" y="4" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></Svg>;

// CRM accents → staging palette (pink #E80074, purple #8A18FF, orange #F97D03, cyan #00CFE5)
const PINK = "#ff8fa3";
const VIOLET = "var(--violet)";
const ORANGE = "#fb923c";
const CYAN = "var(--cyan)";

function HeroCard({ label, value, sub, accent, icon }: { label: string; value: string; sub: string; accent: string; icon: ReactNode }) {
  return (
    <div className="vcr-card" style={{ ["--vcr-a" as string]: accent }}>
      <span className="vcr-line" aria-hidden="true" />
      <div className="vcr-chead"><span className="vcr-cl">{label}</span><span className="vcr-ci">{icon}</span></div>
      <div className="vcr-cv">{value}</div>
      <div className="vcr-cs">{sub}</div>
    </div>
  );
}

export function VcampPanel() {
  const [sb] = useState(() => createClient());
  const [campaigns, setCampaigns] = useState<CampaignFull[]>([]);
  const [campErr, setCampErr] = useState("");
  const [campaignId, setCampaignId] = useState("");   // "" = let the database open its default campaign
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [tick, setTick] = useState(0);

  // campaigns for the selector (newest start first, like the CRM)
  useEffect(() => {
    let on = true;
    void rpc<CampaignFull[]>(sb, "growth_campaigns_list").then((r) => {
      if (!on) return;
      if (r.error) setCampErr(r.error);
      else setCampaigns(Array.isArray(r.data) ? r.data : []);
    });
    return () => { on = false; };
  }, [sb]);

  // the report (old numbers stay on screen, dimmed, until the new ones arrive)
  useEffect(() => {
    let on = true;
    setLoading(true);
    setErr("");
    void rpc<Report>(sb, "growth_vcamp_report", buildReportPayload(campaignId)).then((r) => {
      if (!on) return;
      setLoading(false);
      if (r.error) { setErr(vcampError(r.code)); return; }
      setReport(r.data);
    });
    return () => { on = false; };
  }, [sb, campaignId, tick]);

  const camp = report?.campaign ?? null;
  const selected = campaignId || camp?.id || "";
  const rows = report?.rows ?? {};
  const achieved = toSplit(rows.achievement).total;
  const m = camp && report ? metrics({ target: camp.application_target, achieved, end: camp.campaign_end, today: report.today }) : null;
  const over = !!report?.over;

  return (
    <div className="mk-wrap">
      <style>{CSS}</style>
      <style>{VCR_CSS}</style>
      <div className="mk-page vcr-page">
        <div className="vcr-head">
          <h1 className="vcr-title">VSAT Campaign Report</h1>
          <p className="vcr-sub">Campaign pacing · campus split · daily activity</p>
        </div>

        <div className="vcr-sel">
          <div className="vcr-tag">
            <span className="vcr-tico"><ITarget /></span>
            <span className="vcr-eye">Campaign</span>
          </div>
          <div className="vcr-field">
            <label htmlFor="vcr-campaign" className="vcr-eye vcr-lbl">Select</label>
            <select id="vcr-campaign" className="vcr-select" value={selected} onChange={(e) => setCampaignId(e.target.value)} disabled={!campaigns.length && !selected}>
              {!selected && <option value="">Choose a campaign…</option>}
              {campaigns.map((c) => <option key={c.id} value={c.id}>{campaignOption(c)}</option>)}
              {selected && camp && !campaigns.some((c) => c.id === camp.id) && <option value={camp.id}>{campaignOption(camp)}</option>}
            </select>
          </div>
          {loading && report && <span className="vcr-busy" role="status"><span className="vcr-spin" aria-hidden="true" />Loading…</span>}
        </div>

        {campErr && <p className="mk-note" role="status">The campaign list could not be loaded ({campErr}).</p>}
        {err && (
          <div className="mk-err vcr-err" role="alert">
            <span>{err}</span>
            <button className="mk-btn" onClick={() => setTick((t) => t + 1)}>Try again</button>
          </div>
        )}

        {!report && loading ? (
          <div className="vcr-empty" role="status"><span className="vcr-spin" aria-hidden="true" /> Loading the report…</div>
        ) : !camp ? (
          !err && <div className="vcr-empty"><p>Select a campaign above to see its report.</p></div>
        ) : (
          <div className={loading ? "vcr-body vcr-dim" : "vcr-body"} aria-busy={loading}>
            <div className="vcr-cards">
              <HeroCard label="Target Application" value={fmtIN(camp.application_target)} sub="Campaign target" accent={PINK} icon={<ITrophy />} />
              <HeroCard label="Achievement" value={fmtIN(achieved)} sub={`${m?.pct ?? 0}% of Target Application`} accent={VIOLET} icon={<ITarget />} />
              <HeroCard label="Remaining" value={fmtIN(m?.remaining ?? 0)} sub={over ? "Campaign closed" : "to hit target"} accent={ORANGE} icon={<IDown />} />
              <HeroCard label="Days to Go" value={String(m?.daysToGo ?? 0)} sub={`${over ? "Ended" : "Ends"} ${camp.campaign_end ?? "—"}`} accent={CYAN} icon={<ICal />} />
            </div>

            <div className="vcr-mx">
              <span className="vcr-mline" aria-hidden="true" />
              <div className="vcr-mh">
                <h2 className="vcr-mn">{camp.name}</h2>
                <p className="vcr-md">
                  {camp.campaign_start ?? "—"} → {camp.campaign_end ?? "—"}
                  {over && <span className="vcr-frozen">Frozen</span>}
                </p>
              </div>
              <div className="vcr-scroll">
                <table className="vcr-table">
                  <thead>
                    <tr><th scope="col">Metric</th><th scope="col">Total</th><th scope="col">GGN</th><th scope="col">Pune</th></tr>
                  </thead>
                  <tbody>
                    {reportRows(!!report?.last3_valid).map((d) => {
                      const s = toSplit(rows[d.key]);
                      const note = gapNote(s, d.gap);
                      const cls = [d.bold ? "vcr-b" : "", d.accent ? "vcr-acc" : ""].filter(Boolean).join(" ");
                      return (
                        <tr key={d.key} className={cls || undefined}>
                          <th scope="row" className="vcr-ml">{d.label}</th>
                          <td>{fmtIN(s.total)}{note && <div className="vcr-gap">{note}</div>}</td>
                          <td>{fmtIN(s.ggn)}</td>
                          <td>{fmtIN(s.pune)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// own prefix `vcr-` (checked unused; College Predictor's globals use `cp-`)
const VCR_CSS = `
.vcr-page{gap:24px}
.vcr-head{display:flex;flex-direction:column;gap:8px}
.vcr-title{font-family:var(--mk-head);font-weight:800;font-size:30px;line-height:1;letter-spacing:-.025em;margin:0;background:linear-gradient(135deg,var(--ink) 30%,var(--mut));-webkit-background-clip:text;background-clip:text;color:transparent;width:fit-content}
.vcr-sub{margin:0;font-size:13px;font-weight:600;color:var(--mut)}
.vcr-eye{font-size:10px;font-weight:500;letter-spacing:.18em;text-transform:uppercase;color:var(--mut2);white-space:nowrap}
.vcr-sel{display:flex;flex-wrap:wrap;align-items:flex-end;gap:20px;padding:20px;background:var(--panel);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);border:1px solid var(--line);border-radius:16px}
.vcr-tag{display:flex;align-items:center;gap:8px;margin-right:8px;align-self:center}
.vcr-tico{display:grid;place-items:center;padding:8px;border-radius:8px;background:rgba(251,146,60,.1);border:1px solid rgba(251,146,60,.2);color:${ORANGE}}
.vcr-field{display:flex;flex-direction:column;gap:6px;min-width:0;max-width:100%}
.vcr-lbl{display:block}
.vcr-select{height:36px;width:420px;max-width:100%;box-sizing:border-box;padding:0 12px;font:inherit;font-size:14px;color:var(--ink);background:rgba(130,150,255,.06);border:1px solid var(--line);border-radius:8px;outline:none;cursor:pointer}
.vcr-select:focus{border-color:rgba(139,92,246,.5);box-shadow:0 0 0 2px rgba(139,92,246,.3)}
.vcr-select:disabled{cursor:default;opacity:.6}
.vcr-select option{background:var(--bg2);color:var(--ink)}
.vcr-busy{display:inline-flex;align-items:center;gap:8px;align-self:center;font-size:12px;font-weight:600;color:var(--mut)}
.vcr-spin{display:inline-block;width:14px;height:14px;border:2px solid rgba(130,150,255,.25);border-top-color:var(--ink);border-radius:50%;animation:vcr-rot .8s linear infinite}
@keyframes vcr-rot{to{transform:rotate(360deg)}}
.vcr-err{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px;cursor:default}
.vcr-empty{display:flex;align-items:center;justify-content:center;gap:10px;padding:32px;text-align:center;background:var(--panel);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border:1px solid var(--line);border-radius:16px;color:var(--mut);font-size:15px;font-weight:600}
.vcr-empty p{margin:0}
.vcr-body{display:flex;flex-direction:column;gap:24px;transition:opacity .15s;container-type:inline-size}
.vcr-dim{opacity:.55}
.vcr-cards{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}
.vcr-card{position:relative;overflow:hidden;min-width:0;padding:20px;background:var(--panel);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border:1px solid var(--line);border-radius:16px;transition:border-color .15s cubic-bezier(.4,0,.2,1)}
.vcr-card:hover{border-color:rgba(130,150,255,.24)}
.vcr-line{position:absolute;inset:0 0 auto 0;height:2px;opacity:.75;background:linear-gradient(90deg,transparent,var(--vcr-a),transparent)}
.vcr-chead{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:12px}
.vcr-cl{font-size:11px;font-weight:700;line-height:1;letter-spacing:.12em;text-transform:uppercase;color:var(--mut)}
.vcr-ci{display:grid;flex-shrink:0;color:var(--vcr-a);opacity:.5}
.vcr-cv{font-family:var(--mk-head);font-weight:800;font-size:32px;line-height:1;letter-spacing:-.025em;color:var(--vcr-a);font-variant-numeric:tabular-nums}
.vcr-cs{margin-top:12px;font-size:11px;font-weight:600;color:var(--mut)}
.vcr-mx{position:relative;overflow:hidden;background:var(--panel);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border:1px solid var(--line);border-radius:16px}
.vcr-mline{position:absolute;inset:0 0 auto 0;height:2px;opacity:.75;background:linear-gradient(90deg,transparent,${PINK},var(--violet),${ORANGE},var(--cyan),transparent)}
.vcr-mh{padding:16px 32px;border-bottom:1px solid rgba(130,150,255,.16)}
.vcr-mn{margin:0;font-family:var(--mk-head);font-size:22px;font-weight:800;line-height:1.25;letter-spacing:-.025em;color:var(--ink)}
.vcr-md{margin:6px 0 0;font-size:13px;font-weight:600;color:var(--mut);font-variant-numeric:tabular-nums}
.vcr-frozen{margin-left:12px;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;background:rgba(251,146,60,.15);color:${ORANGE}}
.vcr-scroll{overflow-x:auto}
.vcr-table{width:100%;min-width:640px;border-collapse:collapse}
.vcr-table thead tr{background:rgba(130,150,255,.05);border-bottom:1px solid rgba(130,150,255,.16)}
.vcr-table thead th{padding:10px 32px;text-align:center;font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--mut)}
.vcr-table tbody tr{border-bottom:1px solid rgba(130,150,255,.16)}
.vcr-table tbody tr:last-child{border-bottom:0}
.vcr-table tbody tr.vcr-acc{background:rgba(139,92,246,.08)}
.vcr-table td,.vcr-table .vcr-ml{padding:6px 32px;text-align:center;color:var(--mk-soft)}
.vcr-table td{font-size:26px;font-weight:500;font-variant-numeric:tabular-nums}
.vcr-table .vcr-ml{font-size:16px;font-weight:600;white-space:nowrap}
.vcr-table tr.vcr-b td,.vcr-table tr.vcr-b .vcr-ml{color:var(--ink)}
.vcr-gap{margin-top:2px;font-size:10px;font-weight:600;letter-spacing:normal;text-transform:none;color:var(--mut)}
@media (min-width:768px){.vcr-title{font-size:48px}}
/* below 1024 the 32px cell padding alone pushes the table past its box; 20px keeps all 4 columns visible */
@media (max-width:1023px){.vcr-table thead th,.vcr-table td,.vcr-table .vcr-ml{padding-left:20px;padding-right:20px}}
/* 4 cards only when the page area (not the window) is wide enough: the admin sidebar takes ~260px, so at a 1024px
   window 4 cards were 162px and the labels wrapped (the CRM has the same squeeze at 768) */
@container (min-width:880px){.vcr-cards{grid-template-columns:repeat(4,minmax(0,1fr))}}
@media (max-width:760px){.vcr-sel{gap:12px;padding:16px}.vcr-field{flex:1 1 100%}.vcr-select{width:100%}.vcr-mh{padding:16px 20px}.vcr-table thead th,.vcr-table td,.vcr-table .vcr-ml{padding-left:16px;padding-right:16px}}
`;

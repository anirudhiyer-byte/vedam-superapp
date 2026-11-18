"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import { errorText, type Channel, type CustomColumn, type Meta, type Week } from "@/lib/growth/marketing";

/**
 * Growth → Ads + Influencers · shared plumbing for the listing and performance screens.
 * Every read and write is a SECURITY DEFINER RPC from migration 0105 (admin only, checked in the
 * database). The browser never touches the tables.
 */

export type Client = ReturnType<typeof createClient>;
export type RpcResult<T> = { data: T | null; error: string | null; code: string | null; detail: string | null };

/** Call an RPC; database codes become plain sentences (custom column keys shown by their label). */
export async function rpc<T>(sb: Client, fn: string, p?: Record<string, unknown>, labelOf?: (k: string) => string): Promise<RpcResult<T>> {
  const { data, error } = p === undefined ? await sb.rpc(fn) : await sb.rpc(fn, { p });
  if (error) return { data: null, error: errorText(error.message, labelOf), code: error.message, detail: (error as { details?: string }).details ?? null };
  return { data: data as T, error: null, code: null, detail: null };
}

/** Campaigns, custom columns, influencers. `reload()` after any change to them. */
export function useMeta(sb: Client) {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [err, setErr] = useState("");
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let on = true;
    void rpc<Meta>(sb, "growth_mkt_meta").then((r) => {
      if (!on) return;
      if (r.error) setErr(r.error); else { setErr(""); setMeta(r.data); }
    });
    return () => { on = false; };
  }, [sb, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { meta, err, reload };
}

export const colsOf = (meta: Meta | null, channel: Channel): CustomColumn[] => (meta?.columns ?? []).filter((c) => c.channel === channel);

// ───────────────────────────── small UI ─────────────────────────────

export function Card({ label, value, sub, accent, title }: { label: string; value: ReactNode; sub?: ReactNode; accent?: boolean; title?: string }) {
  return (
    <div className={`mk-card${accent ? " mk-card-a" : ""}`} title={title}>
      <div className="mk-cl">{label}</div>
      <div className="mk-cv">{value}</div>
      {sub != null && <div className="mk-cs">{sub}</div>}
    </div>
  );
}

/** "In-window" big, "All-time" small under it. */
export function SplitCard({ label, iw, all, hasWindow, title }: { label: string; iw: number; all: number; hasWindow: boolean; title?: string }) {
  return (
    <div className="mk-card" title={title}>
      <div className="mk-cl">{label}</div>
      <div className="mk-split"><span className="mk-k">In-window</span><span className="mk-cv mk-cv-p">{hasWindow ? iw.toLocaleString("en-IN") : "—"}</span></div>
      <div className="mk-split"><span className="mk-k">All-time</span><span className="mk-cv2">{all.toLocaleString("en-IN")}</span></div>
    </div>
  );
}

export function Modal({ title, sub, onClose, children, wide }: { title: string; sub?: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="mk-modal" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`mk-sheet${wide ? " mk-sheet-w" : ""}`}>
        <div className="mk-sheethead">
          <div><h3>{title}</h3>{sub && <p className="mk-hint">{sub}</p>}</div>
          <button className="mk-x" onClick={onClose} aria-label="Close">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Field({ label, required, children, hint }: { label: string; required?: boolean; children: ReactNode; hint?: string }) {
  return (
    <label className="mk-field">
      <span className="mk-flabel">{label}{required && <b className="mk-req"> *</b>}</span>
      {children}
      {hint && <span className="mk-fhint">{hint}</span>}
    </label>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string }[]; value: T; onChange: (t: T) => void }) {
  return (
    <div className="mk-tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={t.id === value} className={t.id === value ? "on" : ""} onClick={() => onChange(t.id)}>{t.label}</button>
      ))}
    </div>
  );
}

export function Err({ msg, onClose }: { msg: string; onClose?: () => void }) {
  if (!msg) return null;
  return <div className="mk-err" role="alert" onClick={onClose}>{msg}</div>;
}

/** Safe external link (only http/https; opens in a new tab without referrer). */
export function ExtLink({ href, children }: { href: string | null | undefined; children: ReactNode }) {
  if (!href || !/^https?:\/\//i.test(href)) return <>{children}</>;
  return <a className="mk-a" href={href} target="_blank" rel="noopener noreferrer nofollow">{children}</a>;
}

// ───────────────────────────── charts (plain SVG) ─────────────────────────────

/** Funnel: each step a bar, its width relative to the first step, with the step-to-step % on the right. */
export function Funnel({ steps }: { steps: { label: string; value: number }[] }) {
  const top = Math.max(1, steps[0]?.value ?? 0);
  return (
    <div className="mk-funnel">
      {steps.map((s, i) => {
        const prev = i > 0 ? steps[i - 1].value : null;
        const pct = prev && prev > 0 ? (s.value / prev) * 100 : null;
        const w = Math.max(3, Math.min(100, (s.value / top) * 100));
        return (
          <div key={s.label} className="mk-frow">
            <span className="mk-fk">{s.label}</span>
            <div className="mk-fbar"><i style={{ width: `${w}%` }} /><b>{s.value.toLocaleString("en-IN")}</b></div>
            <span className="mk-fp">{pct === null ? "" : `${pct < 0.1 && pct > 0 ? pct.toFixed(3) : pct.toFixed(1)}% of ${steps[i - 1].label.toLowerCase()}`}</span>
          </div>
        );
      })}
    </div>
  );
}

const SERIES = ["#a78bfa", "#fb923c"]; // side A, side B

/**
 * Small multiples: one panel per metric (leads / payments / enrollments), each with its own scale so a
 * small payment count is still readable next to thousands of leads. Two lines per panel (side A, side B).
 */
export function WeeklyCompare({ a, b, labels }: { a: Week[]; b: Week[]; labels: [string, string] }) {
  const weeks = [...new Set([...a, ...b].map((w) => w.week))].sort();
  if (weeks.length === 0) return <p className="mk-mid">No leads, payments or enrollments in these weeks yet.</p>;
  const pick = (ws: Week[], k: keyof Omit<Week, "week">) => { const m = new Map(ws.map((w) => [w.week, w[k]])); return weeks.map((w) => m.get(w) ?? 0); };
  const panels: { k: keyof Omit<Week, "week">; label: string }[] = [
    { k: "leads", label: "Leads" }, { k: "payments", label: "Payments" }, { k: "enrollments", label: "Enrollments" },
  ];
  const W = 420, H = 180, P = { l: 40, r: 14, t: 12, b: 24 };
  const x = (i: number) => P.l + (weeks.length === 1 ? (W - P.l - P.r) / 2 : (i * (W - P.l - P.r)) / (weeks.length - 1));
  const fmtW = (w: string) => new Date(`${w}T00:00:00Z`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", timeZone: "UTC" });
  const tickEvery = Math.max(1, Math.ceil(weeks.length / 5));
  return (
    <div className="mk-mult">
      <div className="mk-legend">
        <span><i style={{ background: SERIES[0] }} />{labels[0]}</span>
        <span><i style={{ background: SERIES[1] }} />{labels[1]}</span>
      </div>
      <div className="mk-mult-row">
      {panels.map((p) => {
        const sa = pick(a, p.k), sb = pick(b, p.k);
        const max = Math.max(1, ...sa, ...sb);
        const y = (v: number) => H - P.b - (v / max) * (H - P.t - P.b);
        const path = (s: number[]) => s.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
        return (
          <figure key={p.k} className="mk-panel">
            <figcaption>{p.label} <span>per week · A {sa.reduce((t, v) => t + v, 0).toLocaleString("en-IN")} · B {sb.reduce((t, v) => t + v, 0).toLocaleString("en-IN")}</span></figcaption>
            <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${p.label} per week, A versus B`}>
              {[0, 0.5, 1].map((f) => (
                <g key={f}>
                  <line x1={P.l} x2={W - P.r} y1={y(max * f)} y2={y(max * f)} className="mk-grid" />
                  <text x={P.l - 6} y={y(max * f) + 3} className="mk-ax" textAnchor="end">{Math.round(max * f).toLocaleString("en-IN")}</text>
                </g>
              ))}
              {weeks.map((w, i) => ((i % tickEvery === 0 && (weeks.length - 1 - i >= tickEvery / 2 || i === 0)) || i === weeks.length - 1 ? <text key={w} x={x(i)} y={H - 6} className="mk-ax" textAnchor={weeks.length > 1 && i === 0 ? "start" : weeks.length > 1 && i === weeks.length - 1 ? "end" : "middle"}>{fmtW(w)}</text> : null))}
              <path d={path(sa)} fill="none" stroke={SERIES[0]} strokeWidth="2" />
              <path d={path(sb)} fill="none" stroke={SERIES[1]} strokeWidth="2" strokeDasharray="5 3" />
              {weeks.map((w, i) => (
                <g key={`t${w}`}>
                  <title>{`Week of ${fmtW(w)}: A ${sa[i]}, B ${sb[i]}`}</title>
                  <rect x={x(i) - 6} y={P.t} width="12" height={H - P.t - P.b} fill="transparent" />
                </g>
              ))}
            </svg>
          </figure>
        );
      })}
      </div>
    </div>
  );
}

// ───────────────────────────── CSS ─────────────────────────────

export const CSS = `
.mk-wrap{height:100%;overflow:auto;color:var(--ink);font-family:var(--font)}
.mk-page{padding:18px 20px 40px;display:flex;flex-direction:column;gap:14px}
.mk-head{display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end;justify-content:space-between}
.mk-head h2{font-family:var(--display);font-size:22px;margin:0;color:var(--ink)}
.mk-head p{margin:4px 0 0;font-size:12px;color:var(--mut2)}
.mk-actions{display:flex;flex-wrap:wrap;gap:8px}
.mk-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.mk-in,.mk-sel{background:rgba(130,150,255,.06);border:1px solid var(--line);border-radius:10px;color:var(--ink);font-size:13px;padding:8px 11px;outline:none;font-family:inherit}
.mk-in:focus,.mk-sel:focus{border-color:rgba(52,226,176,.45)}
.mk-in::placeholder{color:var(--mut2)}
.mk-sel option{background:#14172b;color:#e8eaf6}
.mk-search{flex:1;min-width:240px}
.mk-date{width:150px;color-scheme:dark}
.mk-num{width:110px}
.mk-lbl{font-family:var(--mono);font-size:9.5px;letter-spacing:1.4px;text-transform:uppercase;color:var(--mut2)}
.mk-btn,.mk-pri,.mk-dan{font-size:12.5px;padding:8px 13px;border-radius:10px;cursor:pointer;border:1px solid var(--line);background:rgba(130,150,255,.06);color:var(--mut);font-family:inherit;white-space:nowrap}
.mk-btn:hover{color:var(--ink)}
.mk-btn:disabled,.mk-pri:disabled,.mk-dan:disabled{opacity:.5;cursor:default}
.mk-pri{background:linear-gradient(90deg,var(--green),var(--cyan));color:#04101a;border:0;font-weight:600}
.mk-dan{border-color:rgba(255,90,120,.4);color:#ffb4c2}
.mk-link{background:none;border:0;color:var(--cyan);font-size:12px;cursor:pointer;padding:2px 4px;text-decoration:underline;font-family:inherit}
.mk-a{color:var(--cyan);text-decoration:none}.mk-a:hover{text-decoration:underline}
.mk-err{background:rgba(255,90,120,.14);border:1px solid rgba(255,90,120,.4);color:#ffd4dc;font-size:12.5px;padding:9px 13px;border-radius:10px;cursor:pointer;white-space:pre-line}
.mk-ok{background:rgba(52,226,176,.12);border:1px solid rgba(52,226,176,.35);color:var(--green);font-size:12.5px;padding:9px 13px;border-radius:10px;cursor:pointer}
.mk-note{font-size:11.5px;color:var(--mut2);line-height:1.5}
.mk-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px}
.mk-card{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:13px 15px}
.mk-card-a{border-color:rgba(52,226,176,.3);background:linear-gradient(160deg,rgba(52,226,176,.1),var(--panel))}
.mk-cl{font-family:var(--mono);font-size:9.5px;letter-spacing:1.4px;text-transform:uppercase;color:var(--mut2);margin-bottom:8px}
.mk-cv{font-family:var(--display);font-weight:700;font-size:24px;color:var(--ink);line-height:1.1}
.mk-cv-p{color:#c4b5fd;font-size:20px}
.mk-cv2{font-family:var(--display);font-weight:600;font-size:15px;color:var(--cyan)}
.mk-cs{font-size:11px;color:var(--mut2);margin-top:5px;line-height:1.4}
.mk-split{display:flex;align-items:baseline;justify-content:space-between;gap:8px}
.mk-k{font-size:10.5px;color:var(--mut2)}
.mk-tabs{display:flex;gap:4px;border-bottom:1px solid var(--line);flex-wrap:wrap}
.mk-tabs button{background:none;border:0;border-bottom:2px solid transparent;color:var(--mut);font-size:13px;padding:9px 12px;cursor:pointer;font-family:inherit}
.mk-tabs button.on{color:var(--ink);border-bottom-color:var(--green)}
.mk-tablewrap{border:1px solid var(--line);border-radius:14px;overflow:auto;background:rgba(12,16,38,.4);max-height:68vh}
.mk-table{width:100%;border-collapse:collapse;font-size:12.5px}
.mk-table th{position:sticky;top:0;background:rgba(14,18,40,.97);text-align:left;font-family:var(--mono);font-size:9.5px;letter-spacing:1.3px;text-transform:uppercase;color:var(--mut2);padding:10px 11px;border-bottom:1px solid var(--line);white-space:nowrap;z-index:2}
.mk-table th.mk-sort{cursor:pointer;user-select:none}.mk-table th.mk-sort:hover{color:var(--ink)}
.mk-table th.r,.mk-table td.r{text-align:right}
.mk-table td{padding:7px 11px;border-bottom:1px solid rgba(130,150,255,.06);vertical-align:middle;color:var(--mut);white-space:nowrap}
.mk-table tr:hover td{background:rgba(130,150,255,.04)}
.mk-table tr.on td{background:rgba(52,226,176,.07)}
.mk-table td.mk-strong{color:var(--ink);font-weight:500;white-space:normal;min-width:160px;max-width:280px}
.mk-table input[type=checkbox]{accent-color:#34e2b0}
.mk-cellsel{background:rgba(130,150,255,.06);border:1px solid var(--line);border-radius:8px;color:var(--ink);font-size:12px;padding:4px 6px;font-family:inherit}
.mk-cellsel option{background:#14172b}
.mk-trunc{display:inline-block;max-width:220px;overflow:hidden;text-overflow:ellipsis;vertical-align:bottom}
.mk-tag{font-size:10.5px;padding:2px 8px;border-radius:999px;background:rgba(130,150,255,.1);border:1px solid var(--line);color:var(--mut);white-space:nowrap}
.mk-tag-on{background:rgba(52,226,176,.14);border-color:rgba(52,226,176,.35);color:var(--green)}
.mk-tag-off{background:rgba(255,170,90,.12);border-color:rgba(255,170,90,.35);color:#ffc58a}
.mk-pair{display:flex;flex-direction:column;line-height:1.25}
.mk-pair small{color:var(--mut2);font-size:10.5px}
.mk-mid{text-align:center;color:var(--mut2);padding:26px!important;font-size:12.5px}
.mk-pager{display:flex;align-items:center;justify-content:space-between;font-size:12.5px;color:var(--mut2);flex-wrap:wrap;gap:8px}
.mk-pager div{display:flex;gap:8px;align-items:center}
.mk-bulk{display:flex;flex-wrap:wrap;align-items:center;gap:10px;background:rgba(52,226,176,.08);border:1px solid rgba(52,226,176,.25);border-radius:12px;padding:8px 12px;font-size:12.5px}
.mk-modal{position:fixed;inset:0;background:rgba(4,6,16,.72);backdrop-filter:blur(4px);display:grid;place-items:center;z-index:60;padding:20px}
.mk-sheet{width:min(560px,100%);background:var(--bg2);border:1px solid var(--line);border-radius:18px;padding:20px 22px;max-height:90vh;overflow:auto}
.mk-sheet-w{width:min(860px,100%)}
.mk-sheethead{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;margin-bottom:10px}
.mk-sheet h3{font-family:var(--display);margin:0 0 4px;font-size:17px;color:var(--ink)}
.mk-hint{font-size:11.5px;color:var(--mut2);margin:0;line-height:1.5}
.mk-x{background:none;border:0;color:var(--mut);font-size:22px;cursor:pointer;line-height:1}
.mk-form{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.mk-form .mk-wide{grid-column:1/-1}
.mk-field{display:flex;flex-direction:column;gap:5px}
.mk-flabel{font-family:var(--mono);font-size:9.5px;letter-spacing:1.3px;text-transform:uppercase;color:var(--mut2)}
.mk-req{color:#ff8fa3}
.mk-fhint{font-size:11px;color:var(--mut2)}
.mk-foot{display:flex;justify-content:flex-end;gap:10px;margin-top:16px}
.mk-combo{position:relative}
.mk-combo-list{position:absolute;left:0;right:0;top:100%;margin-top:4px;background:#14172b;border:1px solid var(--line);border-radius:10px;max-height:240px;overflow:auto;z-index:5;padding:4px}
.mk-combo-list button{display:block;width:100%;text-align:left;background:none;border:0;color:var(--mut);padding:7px 9px;border-radius:7px;font-size:12.5px;cursor:pointer;font-family:inherit}
.mk-combo-list button:hover,.mk-combo-list button.on{background:rgba(52,226,176,.12);color:var(--ink)}
.mk-grid2{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.mk-box{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:14px 16px}
.mk-box h4{font-family:var(--display);font-size:13.5px;margin:0 0 10px;color:var(--ink)}
.mk-box-a{border-color:rgba(167,139,250,.45)}.mk-box-b{border-color:rgba(251,146,60,.45)}
.mk-funnel{display:flex;flex-direction:column;gap:9px}
.mk-frow{display:grid;grid-template-columns:110px 1fr 150px;gap:10px;align-items:center;font-size:12px}
.mk-fk{color:var(--mut)}
.mk-fbar{position:relative;height:26px;background:rgba(130,150,255,.06);border-radius:8px;overflow:hidden}
.mk-fbar i{position:absolute;inset:0 auto 0 0;background:linear-gradient(90deg,rgba(52,226,176,.55),rgba(34,211,238,.45));border-radius:8px}
.mk-fbar b{position:relative;padding-left:10px;line-height:26px;color:var(--ink);font-family:var(--mono);font-size:12px}
.mk-fp{color:var(--mut2);font-size:11px}
.mk-mult{display:flex;flex-direction:column;gap:10px}
.mk-mult-row{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
@media (max-width:1000px){.mk-mult-row{grid-template-columns:1fr}.mk-panel svg{max-width:560px}}
.mk-legend{display:flex;gap:16px;font-size:12px;color:var(--mut)}
.mk-legend i{display:inline-block;width:14px;height:3px;border-radius:2px;margin-right:6px;vertical-align:middle}
.mk-panel{margin:0;background:rgba(12,16,38,.4);border:1px solid var(--line);border-radius:12px;padding:8px 10px}
.mk-panel figcaption{font-size:12px;color:var(--ink);font-weight:600;margin-bottom:2px}
.mk-panel figcaption span{color:var(--mut2);font-weight:400;font-size:11px;margin-left:6px}
.mk-panel svg{width:100%;height:auto;display:block}
.mk-grid{stroke:rgba(130,150,255,.12);stroke-width:1}
.mk-ax{fill:var(--mut2);font-size:9.5px;font-family:var(--mono)}
.mk-cmp td.v{font-family:var(--mono);color:var(--ink);text-align:right}
.mk-top{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px}
.mk-topc{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:13px 15px}
.mk-topc .mk-cv{font-size:21px}
.mk-topn{font-size:12.5px;color:var(--ink);margin-top:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
@media (max-width:760px){.mk-form,.mk-grid2{grid-template-columns:1fr}.mk-frow{grid-template-columns:80px 1fr}.mk-fp{display:none}}
`;

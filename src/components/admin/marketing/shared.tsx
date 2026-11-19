"use client";

import { Fragment, useCallback, useEffect, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import { countTicks, errorText, labelIndexes, type Channel, type CustomColumn, type Meta, type Week } from "@/lib/growth/marketing";

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

export type PanelStep = {
  label: string; value: ReactNode; tone: "ld" | "py" | "en" | "vw" | "ps";
  /** width of the step's bar, 0–100; leave out on every step for a panel without bars */
  bar?: number; chip?: ReactNode; title?: string;
};
/** What sits between two steps: a conversion (value + short name) or null for a plain gap. */
export type PanelLink = { value: ReactNode; name: string; title?: string } | null;

/**
 * The headline panel of the Ads / Influencers pages: spend (and a few counts) on the left, the
 * steps on the right with what links them. Follows the width of the page area, not the screen:
 * spend moves on top under 900px, the steps stack under 600px.
 */
export function FunnelPanel({ aria, spendLabel, spend, meta, steps, links = [] }: {
  aria: string; spendLabel: string; spend: ReactNode; meta: { label: string; value: ReactNode; sub?: ReactNode; title?: string }[];
  steps: PanelStep[]; links?: PanelLink[];
}) {
  const bars = steps.some((s) => s.bar !== undefined);
  return (
    <section className={`mk-fun${steps.length > 3 ? " mk-fun-wide" : ""}`} aria-label={aria}><div className="mk-fun-in">
      <div className="mk-fun-sp">
        <div><div className="mk-fs-l">{spendLabel}</div><div className="mk-fun-spv">{spend}</div></div>
        <div className="mk-fun-meta">{meta.map((x) => <div key={x.label} title={x.title}><span>{x.label}</span><b>{x.value}</b>{x.sub != null && <small>{x.sub}</small>}</div>)}</div>
      </div>
      <div className="mk-fun-st">
        {steps.map((s, i) => {
          const link = i > 0 ? links[i - 1] ?? null : undefined;
          return (
            <Fragment key={s.label}>
              {link === null && <div className="mk-fs-gap" aria-hidden="true" />}
              {link && <div className="mk-fs-arr" title={link.title}><b>{link.value}</b><span className="mk-fs-line" aria-hidden="true" /><small>{link.name}</small></div>}
              <div className={`mk-fs mk-fs-${s.tone}`} title={s.title}>
                <div className="mk-fs-l"><i aria-hidden="true" />{s.label}</div>
                <div className="mk-fs-v">{s.value}</div>
                {bars && <div className={`mk-fs-bar${s.bar === undefined ? " mk-fs-nobar" : ""}`} aria-hidden="true"><span style={{ width: `${Math.max(0, Math.min(100, s.bar ?? 0))}%` }} /></div>}
                {s.chip != null && <div className="mk-fs-cost">{s.chip}</div>}
              </div>
            </Fragment>
          );
        })}
      </div>
    </div></section>
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

/**
 * A filter dropdown you can type in: the list narrows to the options that contain the typed text.
 * Empty value = the "all" option. Arrow keys + Enter pick, Esc closes and keeps the current choice.
 */
export function SearchSelect({ options, value, onChange, allLabel, ariaLabel, width = 190 }: {
  options: { value: string; label: string }[]; value: string; onChange: (v: string) => void; allLabel: string; ariaLabel: string; width?: number;
}) {
  const cur = options.find((o) => o.value === value);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const t = q.trim().toLowerCase();
  const shown = [{ value: "", label: allLabel }, ...(t ? options.filter((o) => o.label.toLowerCase().includes(t)) : options)].slice(0, 80);
  const pick = (v: string) => { onChange(v); setQ(""); setOpen(false); };
  const listId = `mk-ss-${ariaLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <div className="mk-combo" style={{ width }}>
      <input className="mk-in mk-ss" style={{ width: "100%" }} value={open ? q : cur?.label ?? ""} placeholder={open ? "Type to search…" : allLabel}
        onFocus={() => { setOpen(true); setQ(""); setHi(Math.max(0, [{ value: "" }, ...options].findIndex((o) => o.value === value))); }} onBlur={() => setTimeout(() => { setOpen(false); setQ(""); }, 150)}
        onChange={(e) => { setQ(e.target.value); setOpen(true); setHi(e.target.value.trim() ? 1 : 0); }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setHi((h) => Math.min(h + 1, shown.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
          else if (e.key === "Enter" && open) { e.preventDefault(); const o = shown[Math.min(hi, shown.length - 1)]; if (o) pick(o.value); (e.target as HTMLInputElement).blur(); }
          else if (e.key === "Escape") { setOpen(false); setQ(""); (e.target as HTMLInputElement).blur(); }
        }}
        role="combobox" aria-expanded={open} aria-controls={listId} aria-label={ariaLabel} maxLength={120} />
      {open && (
        <div className="mk-combo-list" role="listbox" id={listId}>
          {shown.map((o, i) => (
            <button type="button" key={o.value || "__all"} role="option" aria-selected={o.value === value}
              className={i === hi ? "on" : ""} onMouseEnter={() => setHi(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(o.value)}>{o.label}</button>
          ))}
          {shown.length === 1 && t && <div className="mk-note" style={{ padding: 8 }}>No influencer matches “{q.trim()}”.</div>}
        </div>
      )}
    </div>
  );
}

const SERIES = ["#a78bfa", "#fb923c"]; // side A, side B

/**
 * Small multiples: one panel per metric (leads / payments / enrollments), each with its own scale so a
 * small payment count is still readable next to thousands of leads. Two lines per panel (side A, side B).
 * Moving the pointer (mouse or touch) over any panel shows a marker on the same week in all three panels:
 * a vertical line, a dot on each line and a box with that week's A and B numbers.
 */
export function WeeklyCompare({ a, b, labels }: { a: Week[]; b: Week[]; labels: [string, string] }) {
  const [hover, setHover] = useState<number | null>(null);
  const weeks = [...new Set([...a, ...b].map((w) => w.week))].sort();
  if (weeks.length === 0) return <p className="mk-mid">No leads, payments or enrollments in these weeks yet.</p>;
  const pick = (ws: Week[], k: keyof Omit<Week, "week">) => { const m = new Map(ws.map((w) => [w.week, w[k]])); return weeks.map((w) => m.get(w) ?? 0); };
  const panels: { k: keyof Omit<Week, "week">; label: string }[] = [
    { k: "leads", label: "Leads" }, { k: "payments", label: "Payments" }, { k: "enrollments", label: "Enrollments" },
  ];
  const W = 420, H = 180, P = { l: 40, r: 14, t: 12, b: 24 };
  const x = (i: number) => P.l + (weeks.length === 1 ? (W - P.l - P.r) / 2 : (i * (W - P.l - P.r)) / (weeks.length - 1));
  const xs = weeks.map((_, i) => x(i));
  const fmtW = (w: string) => new Date(`${w}T00:00:00Z`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", timeZone: "UTC" });
  const fmtWy = (w: string) => new Date(`${w}T00:00:00Z`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
  const xLabels = new Set(labelIndexes(xs, 62));
  const anchor = (i: number) => (weeks.length > 1 && i === 0 ? "start" : weeks.length > 1 && i === weeks.length - 1 ? "end" : "middle");
  // pointer x (screen) → nearest week
  const onMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    if (!r.width) return;
    const vx = ((e.clientX - r.left) / r.width) * W;
    let best = 0;
    for (let i = 1; i < xs.length; i++) if (Math.abs(xs[i] - vx) < Math.abs(xs[best] - vx)) best = i;
    setHover(best);
  };
  return (
    <div className="mk-mult">
      <div className="mk-legend">
        <span><i style={{ background: SERIES[0] }} />{labels[0]}</span>
        <span><i style={{ background: SERIES[1] }} />{labels[1]}</span>
      </div>
      <div className="mk-mult-row">
      {panels.map((p) => {
        const sa = pick(a, p.k), sb = pick(b, p.k);
        const { top, ticks } = countTicks(Math.max(...sa, ...sb));
        const y = (v: number) => H - P.b - (v / top) * (H - P.t - P.b);
        const path = (s: number[]) => s.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
        const h = hover != null && hover < weeks.length ? hover : null;
        // tooltip box: right of the marker, or left of it near the right edge
        const boxW = 118, boxH = 46;
        const bx = h == null ? 0 : xs[h] + 8 + boxW > W - P.r ? xs[h] - 8 - boxW : xs[h] + 8;
        return (
          <figure key={p.k} className="mk-panel">
            <figcaption>{p.label} <span>per week · A {sa.reduce((t, v) => t + v, 0).toLocaleString("en-IN")} · B {sb.reduce((t, v) => t + v, 0).toLocaleString("en-IN")}</span></figcaption>
            <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${p.label} per week, A versus B`} className="mk-chart"
                 onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => setHover(null)}>
              {ticks.map((v) => (
                <g key={v}>
                  <line x1={P.l} x2={W - P.r} y1={y(v)} y2={y(v)} className="mk-grid" />
                  <text x={P.l - 6} y={y(v) + 3} className="mk-ax" textAnchor="end">{v.toLocaleString("en-IN")}</text>
                </g>
              ))}
              {weeks.map((w, i) => (xLabels.has(i) ? <text key={w} x={x(i)} y={H - 6} className="mk-ax" textAnchor={anchor(i)}>{fmtW(w)}</text> : null))}
              <path d={path(sa)} fill="none" stroke={SERIES[0]} strokeWidth="2" />
              <path d={path(sb)} fill="none" stroke={SERIES[1]} strokeWidth="2" strokeDasharray="5 3" />
              {h != null && (
                <g className="mk-hover" pointerEvents="none">
                  <line x1={xs[h]} x2={xs[h]} y1={P.t} y2={H - P.b} className="mk-cross" />
                  <circle cx={xs[h]} cy={y(sb[h])} r="4" fill={SERIES[1]} className="mk-dot" />
                  <circle cx={xs[h]} cy={y(sa[h])} r="4" fill={SERIES[0]} className="mk-dot" />
                  <rect x={bx} y={P.t} width={boxW} height={boxH} rx="6" className="mk-tip" />
                  <text x={bx + 8} y={P.t + 14} className="mk-tip-h">Week of {fmtWy(weeks[h])}</text>
                  <text x={bx + 8} y={P.t + 27} className="mk-tip-v"><tspan fill={SERIES[0]}>●</tspan> A  {sa[h].toLocaleString("en-IN")}</text>
                  <text x={bx + 8} y={P.t + 39} className="mk-tip-v"><tspan fill={SERIES[1]}>●</tspan> B  {sb[h].toLocaleString("en-IN")}</text>
                </g>
              )}
            </svg>
          </figure>
        );
      })}
      </div>
    </div>
  );
}

// ───────────────────────────── CSS ─────────────────────────────

/*
 * Type system for the Growth marketing screens (scoped to .mk-wrap, the admin shell is untouched):
 *   Outfit (Vedam brand face) — page titles, section headings, big numbers
 *   Inter                     — everything you read: labels, tables, forms, notes (tabular figures for numbers)
 *   JetBrains Mono            — only URLs / UTM links, where character-level reading matters
 * Scale on a 14px base: 11.5 axis · 12.5 meta · 13.5 tables + controls · 14 body · 16 sections · 20 dialogs · 26 page · 30 KPI.
 * Labels are sentence case at readable size (no tiny tracked capitals).
 */
export const CSS = `
.mk-wrap{--mk-head:var(--font-outfit),'Outfit',var(--display),system-ui,sans-serif;--mk-ui:var(--font-inter),'Inter',var(--font),system-ui,sans-serif;--mk-code:var(--font-jetbrains),'JetBrains Mono',var(--mono),monospace;--mk-soft:#c3cbea;height:100%;overflow:auto;color:var(--ink);font-family:var(--mk-ui);font-size:14px;line-height:1.55;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;text-rendering:optimizeLegibility;font-feature-settings:"cv05","cv08"}
.mk-wrap :focus-visible{outline:2px solid rgba(52,226,176,.7);outline-offset:2px}
.mk-page{padding:28px 32px 64px;display:flex;flex-direction:column;gap:20px;max-width:1680px}
.mk-head{display:flex;flex-wrap:wrap;gap:16px;align-items:flex-end;justify-content:space-between}
.mk-head h2{font-family:var(--mk-head);font-weight:600;font-size:26px;line-height:1.15;letter-spacing:-.02em;margin:0;color:var(--ink)}
.mk-head p{margin:6px 0 0;font-size:13.5px;color:var(--mut);max-width:72ch}
.mk-actions{display:flex;flex-wrap:wrap;gap:8px}
.mk-bar{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
.mk-in,.mk-sel{background:rgba(130,150,255,.06);border:1px solid rgba(130,150,255,.14);border-radius:10px;color:var(--ink);font-size:13.5px;line-height:1.4;padding:9px 12px;min-height:40px;box-sizing:border-box;outline:none;font-family:inherit;transition:border-color .15s,background .15s}
.mk-in:hover,.mk-sel:hover{border-color:rgba(130,150,255,.24)}
.mk-in:focus,.mk-sel:focus{border-color:rgba(52,226,176,.55);background:rgba(130,150,255,.09)}
.mk-in::placeholder{color:var(--mut2)}
.mk-sel option{background:#14172b;color:#e8eaf6}
.mk-search{flex:1;min-width:260px}
.mk-date{width:156px;color-scheme:dark;font-variant-numeric:tabular-nums}
.mk-num{width:116px;font-variant-numeric:tabular-nums}
.mk-lbl{font-size:12.5px;font-weight:500;color:var(--mut)}
.mk-btn,.mk-pri,.mk-dan{font-size:13px;font-weight:500;line-height:1.3;padding:9px 14px;min-height:40px;box-sizing:border-box;border-radius:10px;cursor:pointer;border:1px solid rgba(130,150,255,.14);background:rgba(130,150,255,.06);color:var(--mk-soft);font-family:inherit;white-space:nowrap;transition:color .15s,border-color .15s,background .15s}
.mk-btn:hover{color:var(--ink);border-color:rgba(130,150,255,.28);background:rgba(130,150,255,.1)}
.mk-btn:disabled,.mk-pri:disabled,.mk-dan:disabled{opacity:.5;cursor:default}
.mk-pri{background:linear-gradient(90deg,var(--green),var(--cyan));color:#04101a;border:0;font-weight:600}
.mk-dan{border-color:rgba(255,90,120,.4);color:#ffb4c2}
.mk-link{background:none;border:0;color:var(--cyan);font-size:13px;cursor:pointer;padding:2px 4px;text-decoration:underline;text-underline-offset:3px;font-family:inherit}
.mk-a{color:var(--cyan);text-decoration:none}.mk-a:hover{text-decoration:underline;text-underline-offset:3px}
.mk-a .mk-trunc{font-family:var(--mk-code);font-size:12.5px;letter-spacing:-.01em;max-width:200px}
.mk-err{background:rgba(255,90,120,.12);border:1px solid rgba(255,90,120,.38);color:#ffd4dc;font-size:13.5px;line-height:1.5;padding:11px 14px;border-radius:12px;cursor:pointer;white-space:pre-line}
.mk-ok{background:rgba(52,226,176,.1);border:1px solid rgba(52,226,176,.32);color:var(--green);font-size:13.5px;padding:11px 14px;border-radius:12px;cursor:pointer}
.mk-note{font-size:12.5px;color:var(--mut);line-height:1.6;max-width:110ch}
.mk-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(178px,1fr));gap:14px}
.mk-card{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:16px 18px 18px;display:flex;flex-direction:column}
.mk-card-a{border-color:rgba(52,226,176,.3);background:linear-gradient(160deg,rgba(52,226,176,.09),var(--panel))}
.mk-fun{container-type:inline-size;background:var(--panel);border:1px solid var(--line);border-radius:18px;overflow:hidden}
.mk-fun-in{display:grid;grid-template-columns:minmax(240px,300px) 1fr}
.mk-fun-sp{padding:24px 26px;border-right:1px solid var(--line);background:linear-gradient(160deg,rgba(52,226,176,.10),rgba(52,226,176,0) 70%);display:flex;flex-direction:column;justify-content:space-between;gap:20px}
.mk-fun-spv{font-family:var(--mk-head);font-weight:500;font-size:40px;line-height:1;letter-spacing:-.025em;color:var(--ink);font-variant-numeric:tabular-nums;margin-top:12px}
.mk-fun-meta{display:grid;grid-template-columns:repeat(auto-fill,minmax(64px,1fr));gap:14px 12px;width:100%}.mk-fun-meta div{display:flex;flex-direction:column;gap:4px}.mk-fun-meta span{font-size:12.5px;color:var(--mut2)}
.mk-fun-meta small{font-size:12px;color:var(--mut2)}
.mk-fun-meta b{font-family:var(--mk-head);font-weight:500;font-size:18px;color:var(--ink);font-variant-numeric:tabular-nums}
.mk-fun-st{display:flex;align-items:stretch;padding:24px 26px 22px}
.mk-fs{flex:1 1 0;min-width:0}.mk-fs-ld{--k:#818cf8}.mk-fs-py{--k:var(--violet)}.mk-fs-en{--k:var(--cyan)}.mk-fs-vw{--k:#60a5fa}.mk-fs-ps{--k:#818cf8}
.mk-fs-gap{flex:0 0 32px}.mk-fs-nobar{visibility:hidden}
.mk-fs-l{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:500;color:var(--mut)}
.mk-fs-l i{width:8px;height:8px;border-radius:50%;background:var(--k)}
.mk-fs-v{font-family:var(--mk-head);font-weight:500;font-size:40px;line-height:1;letter-spacing:-.025em;color:var(--ink);font-variant-numeric:tabular-nums;margin:12px 0 14px}
.mk-fs-bar{height:6px;border-radius:6px;background:rgba(130,150,255,.08);overflow:hidden;margin-bottom:14px}
.mk-fs-bar span{display:block;height:100%;border-radius:6px;background:var(--k)}
.mk-fs-cost{display:inline-flex;align-items:baseline;flex-wrap:wrap;gap:4px 8px;padding:6px 10px;border-radius:9px;background:rgba(130,150,255,.07);border:1px solid var(--line)}
.mk-fs-cost b{font-family:var(--mk-head);font-weight:500;font-size:16px;color:var(--ink);font-variant-numeric:tabular-nums}
.mk-fs-cost span{font-size:12px;color:var(--mut)}
.mk-fs-pair{display:inline-flex;align-items:baseline;gap:6px;white-space:nowrap}
.mk-fs-arr{flex:0 0 84px;display:flex;flex-direction:column;align-items:center;gap:6px;padding-top:36px}
.mk-fs-arr b{font-family:var(--mk-head);font-weight:600;font-size:17px;color:var(--ink);font-variant-numeric:tabular-nums}
.mk-fs-arr small{font-size:11.5px;color:var(--mut2)}
.mk-fs-line{width:52px;height:1px;background:linear-gradient(90deg,rgba(130,150,255,.15),rgba(130,150,255,.55));position:relative}
.mk-fs-line::after{content:"";position:absolute;right:-1px;top:-4px;border:4.5px solid transparent;border-left:7px solid rgba(130,150,255,.55);border-right:0}
@container (max-width:900px){.mk-fun-in{grid-template-columns:1fr}.mk-fun-meta{display:flex;flex-wrap:wrap;gap:14px 36px;width:auto}.mk-fun-meta span,.mk-fun-meta small{white-space:nowrap}.mk-fun-sp{border-right:0;border-bottom:1px solid var(--line);flex-direction:row;align-items:flex-end;flex-wrap:wrap}}
@container (max-width:1150px){.mk-fun-wide .mk-fun-in{grid-template-columns:1fr}.mk-fun-wide .mk-fun-meta{display:flex;flex-wrap:wrap;gap:14px 36px;width:auto}.mk-fun-wide .mk-fun-meta span,.mk-fun-wide .mk-fun-meta small{white-space:nowrap}.mk-fun-wide .mk-fun-sp{border-right:0;border-bottom:1px solid var(--line);flex-direction:row;align-items:flex-end;flex-wrap:wrap}}
@container (max-width:600px){.mk-fun-sp,.mk-fun-st{padding:18px}.mk-fun-spv,.mk-fs-v{font-size:32px}.mk-fun-st{flex-direction:column;gap:4px}.mk-fs,.mk-fs-arr{flex:none}.mk-fs-gap{flex:none;height:14px}.mk-fs-arr{flex-direction:row;justify-content:flex-start;padding:6px 0 10px;gap:10px}.mk-fs-line{width:1px;height:18px;background:rgba(130,150,255,.4)}.mk-fs-line::after{display:none}.mk-fs-v{margin:8px 0 10px}}
@container (max-width:820px){.mk-fun-wide .mk-fun-sp,.mk-fun-wide .mk-fun-st{padding:18px}.mk-fun-wide .mk-fun-spv,.mk-fun-wide .mk-fs-v{font-size:32px}.mk-fun-wide .mk-fun-st{flex-direction:column;gap:4px}.mk-fun-wide .mk-fs,.mk-fun-wide .mk-fs-arr{flex:none}.mk-fun-wide .mk-fs-gap{flex:none;height:14px}.mk-fun-wide .mk-fs-arr{flex-direction:row;justify-content:flex-start;padding:6px 0 10px;gap:10px}.mk-fun-wide .mk-fs-line{width:1px;height:18px;background:rgba(130,150,255,.4)}.mk-fun-wide .mk-fs-line::after{display:none}.mk-fun-wide .mk-fs-v{margin:8px 0 10px}}
.mk-cl{font-size:12.5px;font-weight:500;line-height:1.35;color:var(--mut);margin-bottom:10px}
.mk-cv{font-family:var(--mk-head);font-weight:500;font-size:30px;line-height:1.05;letter-spacing:-.02em;color:var(--ink);font-variant-numeric:tabular-nums}
.mk-cv-p{color:#c4b5fd;font-size:24px}
.mk-cv2{font-family:var(--mk-head);font-weight:500;font-size:16px;letter-spacing:-.01em;color:var(--cyan);font-variant-numeric:tabular-nums}
.mk-cs{font-size:12.5px;color:var(--mut);margin-top:8px;line-height:1.45}
.mk-split{display:flex;align-items:baseline;justify-content:space-between;gap:10px}
.mk-split+.mk-split{margin-top:6px}
.mk-k{font-size:12.5px;color:var(--mut)}
.mk-tabs{display:flex;gap:6px;border-bottom:1px solid var(--line);flex-wrap:wrap}
.mk-tabs button{background:none;border:0;border-bottom:2px solid transparent;margin-bottom:-1px;color:var(--mut);font-size:14px;font-weight:500;padding:10px 14px;cursor:pointer;font-family:inherit;transition:color .15s}
.mk-tabs button:hover{color:var(--ink)}
.mk-tabs button.on{color:var(--ink);border-bottom-color:var(--green)}
.mk-tablewrap{border:1px solid var(--line);border-radius:16px;overflow:auto;background:rgba(12,16,38,.42);max-height:70vh}
.mk-table{width:100%;border-collapse:collapse;font-size:13.5px;line-height:1.45}
.mk-table th{position:sticky;top:0;background:#10142c;text-align:left;font-size:12.5px;font-weight:500;color:var(--mut);padding:12px 14px;border-bottom:1px solid rgba(130,150,255,.14);white-space:nowrap;z-index:2}
.mk-table th.mk-sort{cursor:pointer;user-select:none;transition:color .15s}.mk-table th.mk-sort:hover{color:var(--ink)}
.mk-table th.r,.mk-table td.r{text-align:right}
.mk-table td.r{font-variant-numeric:tabular-nums}
.mk-table td{padding:12px 14px;border-bottom:1px solid rgba(130,150,255,.07);vertical-align:middle;color:var(--mk-soft);white-space:nowrap}
.mk-table tbody tr:last-child td{border-bottom:0}
.mk-table tr:hover td{background:rgba(130,150,255,.045)}
.mk-table tr.on td{background:rgba(52,226,176,.07)}
.mk-table td.mk-strong{color:var(--ink);font-weight:500;white-space:normal;min-width:170px;max-width:300px}
.mk-table input[type=checkbox]{accent-color:#34e2b0;width:15px;height:15px}
.mk-cellsel{background:rgba(130,150,255,.06);border:1px solid rgba(130,150,255,.14);border-radius:8px;color:var(--ink);font-size:13px;padding:5px 8px;font-family:inherit}
.mk-cellsel option{background:#14172b}
.mk-trunc{display:inline-block;max-width:240px;overflow:hidden;text-overflow:ellipsis;vertical-align:bottom}
.mk-tag{font-size:12px;font-weight:500;padding:3px 10px;border-radius:999px;background:rgba(130,150,255,.1);border:1px solid var(--line);color:var(--mk-soft);white-space:nowrap}
.mk-tag-on{background:rgba(52,226,176,.13);border-color:rgba(52,226,176,.34);color:var(--green)}
.mk-tag-off{background:rgba(255,170,90,.11);border-color:rgba(255,170,90,.34);color:#ffc58a}
.mk-pair{display:flex;flex-direction:column;line-height:1.3;gap:2px}
.mk-pair small{color:var(--mut2);font-size:12px;font-variant-numeric:normal}
.mk-mid{text-align:center;color:var(--mut);padding:32px!important;font-size:13.5px}
.mk-pager{display:flex;align-items:center;justify-content:space-between;font-size:13px;color:var(--mut);flex-wrap:wrap;gap:10px}
.mk-pager div{display:flex;gap:8px;align-items:center}
.mk-bulk{display:flex;flex-wrap:wrap;align-items:center;gap:12px;background:rgba(52,226,176,.08);border:1px solid rgba(52,226,176,.25);border-radius:12px;padding:10px 14px;font-size:13.5px}
.mk-modal{position:fixed;inset:0;background:rgba(4,6,16,.72);backdrop-filter:blur(4px);display:grid;place-items:center;z-index:60;padding:24px}
.mk-sheet{width:min(580px,100%);background:var(--bg2);border:1px solid rgba(130,150,255,.14);border-radius:20px;padding:24px 26px;max-height:90vh;overflow:auto;box-sizing:border-box}
.mk-sheet-w{width:min(880px,100%)}
.mk-sheethead{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;margin-bottom:18px}
.mk-sheet h3{font-family:var(--mk-head);font-weight:600;margin:0 0 6px;font-size:20px;line-height:1.2;letter-spacing:-.015em;color:var(--ink)}
.mk-hint{font-size:13px;color:var(--mut);margin:0;line-height:1.55}
.mk-x{background:none;border:0;color:var(--mut);font-size:24px;cursor:pointer;line-height:1;padding:2px 6px;border-radius:8px}.mk-x:hover{color:var(--ink);background:rgba(130,150,255,.1)}
.mk-form{display:grid;grid-template-columns:1fr 1fr;gap:16px 18px}
.mk-form .mk-wide{grid-column:1/-1}
.mk-field{display:flex;flex-direction:column;gap:7px}
.mk-flabel{font-size:13px;font-weight:500;color:var(--mk-soft)}
.mk-req{color:#ff8fa3;font-weight:500}
.mk-fhint{font-size:12px;color:var(--mut2);line-height:1.45}
.mk-foot{display:flex;justify-content:flex-end;gap:10px;margin-top:22px}
.mk-combo{position:relative}
.mk-ss{cursor:pointer}.mk-ss:focus{cursor:text}
.mk-combo-list{position:absolute;left:0;right:0;top:100%;margin-top:6px;background:#14172b;border:1px solid rgba(130,150,255,.16);border-radius:12px;max-height:260px;overflow:auto;z-index:5;padding:5px;box-shadow:0 12px 32px rgba(0,0,0,.35)}
.mk-combo-list button{display:block;width:100%;text-align:left;background:none;border:0;color:var(--mk-soft);padding:8px 10px;border-radius:8px;font-size:13.5px;cursor:pointer;font-family:inherit}
.mk-combo-list button:hover,.mk-combo-list button.on{background:rgba(52,226,176,.12);color:var(--ink)}
.mk-grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.mk-box{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:20px 22px}
.mk-box h4{font-family:var(--mk-head);font-weight:600;font-size:16px;line-height:1.3;letter-spacing:-.01em;margin:0 0 14px;color:var(--ink)}
.mk-box-a{border-color:rgba(167,139,250,.45)}.mk-box-b{border-color:rgba(251,146,60,.45)}
.mk-funnel{display:flex;flex-direction:column;gap:10px}
.mk-frow{display:grid;grid-template-columns:120px 1fr 160px;gap:14px;align-items:center;font-size:13.5px}
.mk-fk{color:var(--mk-soft);font-weight:500}
.mk-fbar{position:relative;height:30px;background:rgba(130,150,255,.06);border-radius:8px;overflow:hidden}
.mk-fbar i{position:absolute;inset:0 auto 0 0;background:linear-gradient(90deg,rgba(52,226,176,.55),rgba(34,211,238,.42));border-radius:8px}
.mk-fbar b{position:relative;padding-left:12px;line-height:30px;color:var(--ink);font-weight:600;font-size:13px;font-variant-numeric:tabular-nums}
.mk-fp{color:var(--mut);font-size:12.5px}
.mk-mult{display:flex;flex-direction:column;gap:14px}
.mk-mult-row{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}
@media (max-width:1000px){.mk-mult-row{grid-template-columns:1fr}.mk-panel svg{max-width:560px}}
.mk-legend{display:flex;flex-wrap:wrap;gap:8px 20px;font-size:13px;color:var(--mk-soft)}
.mk-legend i{display:inline-block;width:16px;height:3px;border-radius:2px;margin-right:8px;vertical-align:middle}
.mk-panel{margin:0;background:rgba(12,16,38,.42);border:1px solid var(--line);border-radius:14px;padding:12px 14px 8px}
.mk-panel figcaption{font-family:var(--mk-head);font-size:14.5px;color:var(--ink);font-weight:600;margin-bottom:6px;letter-spacing:-.005em}
.mk-panel figcaption span{font-family:var(--mk-ui);color:var(--mut);font-weight:400;font-size:12.5px;margin-left:8px;letter-spacing:0}
.mk-panel svg{width:100%;height:auto;display:block}
.mk-grid{stroke:rgba(130,150,255,.12);stroke-width:1}
.mk-ax{fill:var(--mut2);font-size:10.5px;font-family:var(--mk-ui);font-variant-numeric:tabular-nums}
.mk-chart{touch-action:pan-y;cursor:crosshair}
.mk-notice{background:rgba(251,146,60,.08);border:1px solid rgba(251,146,60,.3);border-radius:12px;padding:12px 16px;font-size:13.5px;color:var(--ink)}
.mk-notice p{margin:0}.mk-notice p+p{margin-top:4px}
.mk-cross{stroke:var(--mut);stroke-width:1;stroke-dasharray:3 3;opacity:.7}
.mk-dot{stroke:var(--panel);stroke-width:2}
.mk-tip{fill:var(--bg2);stroke:rgba(130,150,255,.2);stroke-width:1;opacity:.97}
.mk-tip-h{fill:var(--mut);font-size:10px;font-weight:500;font-family:var(--mk-ui)}
.mk-tip-v{fill:var(--ink);font-size:11px;font-weight:500;font-family:var(--mk-ui);font-variant-numeric:tabular-nums;white-space:pre}
.mk-cmp td.v{color:var(--ink);text-align:right;font-weight:500;font-variant-numeric:tabular-nums}
.mk-top{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px}
.mk-topc{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:16px 18px 18px}
.mk-topc .mk-cv{font-size:26px}
.mk-topn{font-size:14px;font-weight:500;color:var(--ink);margin-top:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mk-subh{font-family:var(--mk-head);font-weight:600;font-size:16px;letter-spacing:-.01em;margin:4px 0 0;color:var(--ink)}
@media (max-width:760px){.mk-page{padding:20px 16px 48px;gap:16px}.mk-head h2{font-size:22px}.mk-cv{font-size:26px}.mk-cards{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.mk-card{padding:14px}.mk-form,.mk-grid2{grid-template-columns:1fr}.mk-frow{grid-template-columns:90px 1fr}.mk-fp{display:none}.mk-search{min-width:0;flex:1 1 100%}}
`;

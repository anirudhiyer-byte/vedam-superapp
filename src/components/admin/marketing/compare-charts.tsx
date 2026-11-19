"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import {
  activeSpan, countTicks, cplGuides, cumulative, fmtCompact, fmtDate, fmtInr, fmtInt, fmtPct, labelIndexes, nearestIndex, niceCeil,
  shortPlatform, TIMING_PARTS, timingParts, type LeadTiming, type Metrics, type PerfRow, type Week,
} from "@/lib/growth/marketing";

/**
 * Influencer Compare charts (side A vs side B):
 *   CompareActivity    one weekly chart with a metric switch (leads / payments / enrollments), a weekly or
 *                      cumulative view, pins for the posts going live, a hover box and a range slider
 *   EfficiencyCompare  CPL / CPP / L2P / V2L of A and B side by side, the better one tagged
 *   PostScatter        every post as a dot: cost (x) vs leads (y), size = payments, cost-per-lead guide lines
 *   LeadTimingCompare  each side's leads split by the days after the post went live (growth_lead_timing, 0118)
 * The first three use data the page already loads (growth_perf rows + growth_weekly weeks).
 */

export const SIDE = ["#a78bfa", "#fb923c"] as const; // A, B

/** Width of an element in px, kept up to date (charts draw in real pixels so text stays crisp at any width). */
function useWidth<T extends HTMLElement>(fallback: number, min = 260) {
  const ref = useRef<T>(null);
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const set = () => setW(Math.max(min, Math.round(el.getBoundingClientRect().width)));
    set();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, [min]);
  return [ref, w] as const;
}

const DAY = 864e5;
/** Axis money: 0, ₹500, ₹12.5k, ₹1.2L, ₹2Cr. */
const shortInr = (v: number) => {
  if (!v) return "0";
  const t = (n: number, u: string) => `₹${Number(n.toFixed(n < 10 ? 1 : 0))}${u}`;
  return v >= 1e7 ? t(v / 1e7, "Cr") : v >= 1e5 ? t(v / 1e5, "L") : v >= 1e3 ? t(v / 1e3, "k") : `₹${Math.round(v)}`;
};
const toDay = (d: string) => Date.parse(`${d.slice(0, 10)}T00:00:00Z`);
const fmtWk = (w: string, year = false) => new Date(toDay(w)).toLocaleDateString("en-IN", { day: "2-digit", month: "short", ...(year ? { year: "numeric" } : {}), timeZone: "UTC" });
const MONTH = (w: string) => new Date(toDay(w)).toLocaleDateString("en-IN", { month: "short", timeZone: "UTC" });

type Metric = "leads" | "payments" | "enrollments";
const METRICS: { k: Metric; label: string }[] = [{ k: "leads", label: "Leads" }, { k: "payments", label: "Payments" }, { k: "enrollments", label: "Enrollments" }];

export type Pin = { side: 0 | 1; date: string; platform: string; label: string };

/**
 * One weekly chart for both sides. `weeks` = every week of the overview (Monday dates, filled with zeros),
 * `a` / `b` = the two sides' weeks. Starts zoomed to the weeks with activity; the slider under it shows
 * the whole overview and moves / resizes the window.
 */
export function CompareActivity({ weeks, a, b, labels, pins }: { weeks: string[]; a: Week[]; b: Week[]; labels: [string, string]; pins: Pin[] }) {
  const [metric, setMetric] = useState<Metric>("leads");
  const [cum, setCum] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const [box, width] = useWidth<HTMLDivElement>(900);
  const n = weeks.length;

  const series = useMemo(() => {
    const pick = (ws: Week[], k: Metric) => { const m = new Map(ws.map((w) => [w.week.slice(0, 10), w[k]])); return weeks.map((w) => m.get(w) ?? 0); };
    const out = {} as Record<Metric, [number[], number[]]>;
    for (const { k } of METRICS) out[k] = [pick(a, k), pick(b, k)];
    return out;
  }, [weeks, a, b]);
  const totals = (k: Metric) => series[k].map((s) => s.reduce((t, v) => t + v, 0)) as [number, number];
  const has = (k: Metric) => totals(k)[0] + totals(k)[1] > 0;
  // a metric with nothing on either side cannot be picked; fall back to leads
  const m: Metric = has(metric) ? metric : "leads";

  // visible window [lo, hi] (indexes into weeks); default = weeks with any activity, padded by a week
  const auto = useMemo(() => activeSpan(series.leads[0].map((v, i) => v + series.payments[0][i] + series.enrollments[0][i]),
    series.leads[1].map((v, i) => v + series.payments[1][i] + series.enrollments[1][i])) ?? [0, Math.max(0, n - 1)], [series, n]);
  const [win, setWin] = useState<[number, number] | null>(null);
  const key = weeks.join(",");
  useEffect(() => { setWin(null); setHover(null); }, [key]);
  const [lo, hi] = win ?? auto;

  if (n === 0) return <p className="mk-mid">No leads, payments or enrollments in these weeks yet.</p>;

  const [sa, sb] = series[m];
  const [ca, cb] = [cumulative(sa), cumulative(sb)];
  const va = (cum ? ca : sa).slice(lo, hi + 1), vb = (cum ? cb : sb).slice(lo, hi + 1);
  const vis = weeks.slice(lo, hi + 1);
  const { top, ticks } = countTicks(Math.max(0, ...va, ...vb));

  const W = width, H = 300, P = { l: 44, r: 16, t: 14, b: 30 }, PIN = 52;
  const plotW = W - P.l - P.r, baseY = H - P.b - PIN;
  const slot = plotW / vis.length;
  const cx = (i: number) => P.l + slot * (i + 0.5);
  const y = (v: number) => baseY - (v / top) * (baseY - P.t);
  const bw = Math.max(1.5, Math.min(14, (slot - 6) / 2));
  // date → x inside the window (pins)
  const t0 = toDay(vis[0]), t1 = toDay(vis[vis.length - 1]) + 7 * DAY;
  const dx = (d: string) => P.l + ((toDay(d) - t0) / (t1 - t0)) * plotW;
  // month labels on the first week of each month, never overlapping
  const monthIdx = vis.map((w, i) => (i === 0 || MONTH(w) !== MONTH(vis[i - 1]) ? i : -1)).filter((i) => i >= 0);
  const monthShown = new Set(labelIndexes(monthIdx.map(cx), 44).map((j) => monthIdx[j]));
  const visPins = pins.filter((p) => toDay(p.date) >= t0 && toDay(p.date) < t1).sort((x, z) => x.date.localeCompare(z.date));
  // pin labels: skip one that would overlap the previous label on its row (the hover box still lists it)
  // a label needs free room on its right: no other pin (either row) under it and no earlier label on its row
  const lastEnd: [number, number] = [-1e9, -1e9];
  const pinX = visPins.map((p) => dx(p.date));
  const pinLabel = visPins.map((p, i) => {
    const x = pinX[i], end = x + 9 + `${shortPlatform(p.platform)} · ${fmtWk(p.date)}`.length * 6.4;
    const free = x > lastEnd[p.side] + 6 && end < W - 4 && pinX.every((ox, j) => j === i || ox <= x || ox > end + 6);
    if (free) lastEnd[p.side] = end;
    return free;
  });

  const path = (vals: number[]) => {
    const pts = vals.map((v, i) => [cx(i), y(v)] as const);
    return pts.map(([x, yy], i) => (i === 0 ? `M${x},${yy}` : `C${(pts[i - 1][0] + x) / 2},${pts[i - 1][1]} ${(pts[i - 1][0] + x) / 2},${yy} ${x},${yy}`)).join(" ");
  };
  const onMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    if (!r.width) return;
    setHover(nearestIndex(vis.map((_, i) => cx(i)), ((e.clientX - r.left) / r.width) * W));
  };
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") { e.preventDefault(); setHover((h) => Math.max(0, Math.min(vis.length - 1, (h ?? -1) + (e.key === "ArrowRight" ? 1 : -1)))); }
    if (e.key === "Escape") setHover(null);
  };
  const h = hover != null && hover < vis.length ? hover : null;
  const hw = h == null ? null : lo + h;
  const weekPins = hw == null ? [] : pins.filter((p) => toDay(p.date) >= toDay(weeks[hw]) && toDay(p.date) < toDay(weeks[hw]) + 7 * DAY);
  const tipLeft = h == null ? 0 : Math.max(0, cx(h) + 14 + 270 > W ? cx(h) - 14 - 270 : cx(h) + 14);

  return (
    <div className="mk-ca">
      <div className="mk-ca-bar">
        <div className="mk-seg" role="group" aria-label="Metric">
          {METRICS.map(({ k, label }) => {
            const [ta, tb] = totals(k);
            return (
              <button key={k} type="button" className={k === m ? "on" : ""} aria-pressed={k === m} disabled={!has(k)}
                title={has(k) ? undefined : `No ${label.toLowerCase()} on either side yet`} onClick={() => { setMetric(k); setHover(null); }}>
                {label} <b><span style={{ color: SIDE[0] }}>{fmtInt(ta)}</span> · <span style={{ color: SIDE[1] }}>{fmtInt(tb)}</span></b>
              </button>
            );
          })}
        </div>
        <div className="mk-seg" role="group" aria-label="View">
          <button type="button" className={!cum ? "on" : ""} aria-pressed={!cum} onClick={() => setCum(false)}>Weekly</button>
          <button type="button" className={cum ? "on" : ""} aria-pressed={cum} onClick={() => setCum(true)}>Cumulative</button>
        </div>
      </div>

      <div className="mk-ca-plot" ref={box}>
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="mk-chart" tabIndex={0} role="img"
          aria-label={`${METRICS.find((x) => x.k === m)?.label} ${cum ? "so far" : "per week"}: ${labels[0]} ${fmtInt(totals(m)[0])}, ${labels[1]} ${fmtInt(totals(m)[1])}. Use the arrow keys to read each week.`}
          onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => setHover(null)} onKeyDown={onKey} onBlur={() => setHover(null)}>
          <defs>
            {SIDE.map((c, i) => (
              <linearGradient key={c} id={`mk-ca-g${i}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor={c} stopOpacity={cum ? 0.26 : 1} /><stop offset="1" stopColor={c} stopOpacity={cum ? 0 : 0.55} />
              </linearGradient>
            ))}
          </defs>
          {ticks.map((v) => (
            <g key={v}>
              <line x1={P.l} x2={W - P.r} y1={y(v)} y2={y(v)} className="mk-grid" />
              <text x={P.l - 8} y={y(v) + 4} className="mk-ax" textAnchor="end">{fmtInt(v)}</text>
            </g>
          ))}
          {h != null && <rect x={cx(h) - slot / 2 + 1} y={P.t - 6} width={Math.max(2, slot - 2)} height={baseY - P.t + 6} rx="6" className="mk-ca-band" />}
          <g key={`${m}-${cum}-${lo}-${hi}`} className="mk-ca-draw">
            {cum ? (
              <>
                {[va, vb].map((vals, s) => (
                  <g key={s}>
                    <path d={`${path(vals)} L${cx(vals.length - 1)},${baseY} L${cx(0)},${baseY} Z`} fill={`url(#mk-ca-g${s})`} />
                    <path d={path(vals)} fill="none" stroke={SIDE[s]} strokeWidth="2.4" strokeLinecap="round" />
                  </g>
                ))}
              </>
            ) : (
              vis.map((w, i) => (
                <g key={w}>
                  {va[i] > 0 && <rect x={cx(i) - bw - 1} y={y(va[i])} width={bw} height={baseY - y(va[i])} rx={Math.min(3, bw / 2)} fill="url(#mk-ca-g0)" className="mk-ca-bar-r" />}
                  {vb[i] > 0 && <rect x={cx(i) + 1} y={y(vb[i])} width={bw} height={baseY - y(vb[i])} rx={Math.min(3, bw / 2)} fill="url(#mk-ca-g1)" className="mk-ca-bar-r" />}
                </g>
              ))
            )}
          </g>
          {h != null && cum && [va, vb].map((vals, s) => <circle key={s} cx={cx(h)} cy={y(vals[h])} r="4.5" fill={SIDE[s]} className="mk-dot" />)}
          <line x1={P.l} x2={W - P.r} y1={baseY} y2={baseY} className="mk-ca-axis" />
          {vis.map((w, i) => (monthShown.has(i) ? <text key={w} x={cx(i) - slot / 2} y={baseY + 18} className="mk-ax">{MONTH(w)}</text> : null))}
          {visPins.map((p, i) => {
            const x = dx(p.date), py = baseY + (p.side === 0 ? 34 : 54);
            return (
              <g key={`${p.side}-${p.date}-${i}`}>
                <line x1={x} x2={x} y1={baseY + 2} y2={py - 7} stroke={SIDE[p.side]} strokeOpacity=".35" strokeDasharray="2 3" />
                <path d={`M${x} ${py - 6} L${x + 5} ${py} L${x} ${py + 6} L${x - 5} ${py} Z`} fill={SIDE[p.side]}><title>{`${p.side ? "B" : "A"} · ${p.label} · ${p.platform} · live ${fmtDate(p.date)}`}</title></path>
                {pinLabel[i] && <text x={x + 9} y={py + 4} className="mk-ca-pin" fill={SIDE[p.side]}>{shortPlatform(p.platform)} · {fmtWk(p.date)}</text>}
              </g>
            );
          })}
        </svg>
        {hw != null && h != null && (
          <div className={`mk-ca-tip${W < 560 ? " mk-ca-tip-below" : ""}`} style={W < 560 ? undefined : { left: tipLeft }} role="status">
            <h5>Week of {fmtWk(weeks[hw], true)}</h5>
            {[0, 1].map((s) => (
              <div key={s} className="mk-ca-side">
                <span style={{ color: SIDE[s] }}>{s ? "B" : "A"} · {labels[s]}</span>
                <b>{fmtInt(series.leads[s][hw])} leads · {fmtInt(series.payments[s][hw])} paid · {fmtInt(series.enrollments[s][hw])} enrolled</b>
              </div>
            ))}
            {cum && <div className="mk-ca-tr mk-ca-so"><span>{METRICS.find((x) => x.k === m)?.label} so far</span><b><span style={{ color: SIDE[0] }}>{fmtInt(ca[hw])}</span> · <span style={{ color: SIDE[1] }}>{fmtInt(cb[hw])}</span></b></div>}
            {weekPins.length > 0 && <hr />}
            {weekPins.map((p, i) => <div key={i} className="mk-ca-tr"><span style={{ color: SIDE[p.side] }}>{p.platform}</span><b>live {fmtWk(p.date)}</b></div>)}
          </div>
        )}
      </div>

      <RangeSlider weeks={weeks} a={sa} b={sb} lo={lo} hi={hi} width={W} onChange={(r) => { setWin(r); setHover(null); }} />
      <div className="mk-ca-foot">
        <span><i style={{ background: SIDE[0] }} />A · {labels[0]}</span>
        <span><i style={{ background: SIDE[1] }} />B · {labels[1]}</span>
        <span className="mk-ca-hint">{win ? <button type="button" className="mk-link" onClick={() => setWin(null)}>Back to the active weeks</button> : "Drag the slider to change the weeks · hover or use the arrow keys for a week's numbers"}</span>
      </div>
    </div>
  );
}

/** Overview of every week with a draggable window: drag the window to move it, a handle to resize it; arrow keys on a handle move it by a week. */
function RangeSlider({ weeks, a, b, lo, hi, width, onChange }: { weeks: string[]; a: number[]; b: number[]; lo: number; hi: number; width: number; onChange: (r: [number, number]) => void }) {
  const drag = useRef<{ kind: "lo" | "hi" | "move"; start: number; lo: number; hi: number } | null>(null);
  const W = width, H = 46, L = 44, R = 16, n = weeks.length;
  const slot = (W - L - R) / n;
  const xOf = (i: number) => L + i * slot;
  const idxAt = (px: number) => Math.max(0, Math.min(n - 1, Math.floor((px - L) / slot)));
  const max = Math.max(1, ...a.map((v, i) => v + (b[i] || 0)));
  const px = (e: ReactPointerEvent<SVGSVGElement>) => { const r = e.currentTarget.getBoundingClientRect(); return ((e.clientX - r.left) / r.width) * W; };
  const down = (e: ReactPointerEvent<SVGSVGElement>) => {
    const x = px(e), i = idxAt(x);
    const kind = Math.abs(x - xOf(lo)) < 10 ? "lo" : Math.abs(x - xOf(hi + 1)) < 10 ? "hi" : i >= lo && i <= hi ? "move" : null;
    if (!kind) { const half = Math.floor((hi - lo) / 2); const s = Math.max(0, Math.min(n - 1 - (hi - lo), i - half)); onChange([s, s + (hi - lo)]); return; }
    drag.current = { kind, start: i, lo, hi };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e: ReactPointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d) return;
    const i = idxAt(px(e));
    if (d.kind === "lo") onChange([Math.min(i, d.hi), d.hi]);
    else if (d.kind === "hi") onChange([d.lo, Math.max(i, d.lo)]);
    else { const shift = Math.max(-d.lo, Math.min(n - 1 - d.hi, i - d.start)); onChange([d.lo + shift, d.hi + shift]); }
  };
  const key = (which: "lo" | "hi") => (e: KeyboardEvent<SVGRectElement>) => {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    if (which === "lo") onChange([Math.max(0, Math.min(hi, lo + step)), hi]);
    else onChange([lo, Math.min(n - 1, Math.max(lo, hi + step))]);
  };
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="mk-ca-slider" onPointerDown={down} onPointerMove={move} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
      <rect x={L} y={4} width={W - L - R} height={30} rx="8" className="mk-ca-sl-bg" />
      {weeks.map((w, i) => { const v = (a[i] || 0) + (b[i] || 0); return v ? <rect key={w} x={xOf(i) + 0.5} y={32 - (v / max) * 24} width={Math.max(1, slot - 1)} height={(v / max) * 24} rx="1" className="mk-ca-sl-v" /> : null; })}
      <rect x={L} y={4} width={Math.max(0, xOf(lo) - L)} height={30} className="mk-ca-sl-dim" />
      <rect x={xOf(hi + 1)} y={4} width={Math.max(0, W - R - xOf(hi + 1))} height={30} className="mk-ca-sl-dim" />
      <rect x={xOf(lo)} y={4} width={Math.max(2, xOf(hi + 1) - xOf(lo))} height={30} rx="6" className="mk-ca-sl-win" />
      {(["lo", "hi"] as const).map((k) => (
        <rect key={k} x={(k === "lo" ? xOf(lo) : xOf(hi + 1)) - 4} y={10} width={8} height={18} rx="3" className="mk-ca-sl-h" tabIndex={0} role="slider"
          aria-label={k === "lo" ? "First week shown" : "Last week shown"} aria-valuemin={0} aria-valuemax={n - 1} aria-valuenow={k === "lo" ? lo : hi}
          aria-valuetext={fmtWk(weeks[k === "lo" ? lo : hi], true)} onKeyDown={key(k)} />
      ))}
      <text x={L + 4} y={H - 1} className="mk-ax">{fmtWk(weeks[0], true)}</text>
      <text x={W - R - 4} y={H - 1} className="mk-ax" textAnchor="end">{fmtWk(weeks[n - 1], true)}</text>
    </svg>
  );
}

/** CPL / CPP (lower is better) and L2P / V2L (higher is better) for A and B, the better one tagged. */
export function EfficiencyCompare({ a, b }: { a: Metrics; b: Metrics }) {
  const rows: { k: string; hint: string; va: number | null; vb: number | null; f: (v: number | null) => string; low: boolean }[] = [
    { k: "CPL", hint: "cost per lead · lower is better", va: a.cpl, vb: b.cpl, f: fmtInr, low: true },
    { k: "CPP", hint: "cost per payment · lower is better", va: a.cpp, vb: b.cpp, f: fmtInr, low: true },
    { k: "L2P", hint: "leads that paid", va: a.l2p, vb: b.l2p, f: (v) => fmtPct(v, 2), low: false },
    { k: "V2L", hint: "views that became leads", va: a.v2l, vb: b.v2l, f: (v) => fmtPct(v, 3), low: false },
  ];
  return (
    <div className="mk-eff">
      {rows.map((r) => {
        const max = Math.max(r.va ?? 0, r.vb ?? 0) || 1;
        const better = r.va == null || r.vb == null || r.va === r.vb ? null : (r.low ? r.va < r.vb : r.va > r.vb) ? 0 : 1;
        return (
          <div key={r.k} className="mk-eff-r">
            <div className="mk-eff-k">{r.k}<small>{r.hint}</small></div>
            <div className="mk-eff-bars">
              {[r.va, r.vb].map((v, s) => (
                <div key={s} className="mk-eff-b">
                  <b style={{ color: SIDE[s] }}>{r.f(v)}</b>
                  <span className="mk-eff-track"><span style={{ width: `${v == null ? 0 : Math.max(2, (v / max) * 100)}%`, background: SIDE[s] }} /></span>
                  {better === s ? <span className="mk-eff-win">better</span> : <span className="mk-eff-win mk-eff-none" aria-hidden="true">better</span>}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Every post of both sides: cost vs leads, dot size = payments, dashed cost-per-lead guides. Hover a dot for its numbers. */
export function PostScatter({ a, b }: { a: PerfRow[]; b: PerfRow[] }) {
  const [box, width] = useWidth<HTMLDivElement>(420);
  const [hover, setHover] = useState<number | null>(null);
  const pts = [...a.map((r) => ({ r, s: 0 as const })), ...b.map((r) => ({ r, s: 1 as const }))]
    .map(({ r, s }) => ({ s, r, cost: Number(r.cost) || 0, leads: r.leads, pay: r.payments }));
  if (pts.length === 0) return <p className="mk-mid">No posts to show.</p>;
  const W = width, H = 280, P = { l: 44, r: 18, t: 26, b: 34 };
  const xm = niceCeil(Math.max(1, ...pts.map((p) => p.cost)) * 1.08), { top: ym, ticks } = countTicks(Math.max(1, ...pts.map((p) => p.leads)) * 1.1);
  const X = (v: number) => P.l + (v / xm) * (W - P.l - P.r), Y = (v: number) => H - P.b - (v / ym) * (H - P.t - P.b);
  const xt = [0, xm / 4, xm / 2, (3 * xm) / 4, xm];
  const guides = cplGuides(pts);
  // labels: right of the dot, else left, else none (the hover box has it); never on top of another label
  const boxes: [number, number, number, number][] = [];
  const place = pts.map((p) => {
    const text = `${shortPlatform(p.r.platform)} · ${p.r.live_date ? fmtWk(p.r.live_date) : "no date"}`;
    const w = text.length * 6.2, r = 5 + 3 * Math.sqrt(p.pay);
    for (const side of [1, -1]) {
      const x0 = side > 0 ? X(p.cost) + r + 6 : X(p.cost) - r - 6 - w, y0 = Y(p.leads) - 6;
      if (x0 < P.l || x0 + w > W - 4) continue;
      if (boxes.some(([bx, by, bw2, bh]) => x0 < bx + bw2 && x0 + w > bx && y0 < by + bh && y0 + 13 > by)) continue;
      boxes.push([x0, y0, w, 13]);
      return { text, x: side > 0 ? x0 : x0 + w, anchor: side > 0 ? "start" : "end", r };
    }
    return { text: null, x: 0, anchor: "start", r };
  });
  const hp = hover == null ? null : pts[hover];
  return (
    <div className="mk-ca-plot" ref={box}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Each post: cost against leads">
        {ticks.map((v) => <g key={v}><line x1={P.l} x2={W - P.r} y1={Y(v)} y2={Y(v)} className="mk-grid" /><text x={P.l - 8} y={Y(v) + 4} className="mk-ax" textAnchor="end">{fmtInt(v)}</text></g>)}
        {xt.map((v, i) => <text key={i} x={X(v)} y={H - P.b + 18} className="mk-ax" textAnchor={i === 0 ? "start" : i === xt.length - 1 ? "end" : "middle"}>{shortInr(v)}</text>)}
        <text x={P.l} y={P.t - 12} className="mk-ax">Leads</text>
        <text x={W - P.r} y={H - 2} className="mk-ax" textAnchor="end">Cost</text>
        {guides.map((g) => {
          const xEnd = Math.min(xm, ym * g), yEnd = xEnd / g;
          return (
            <g key={g}>
              <line x1={X(0)} y1={Y(0)} x2={X(xEnd)} y2={Y(yEnd)} className="mk-sc-guide" />
              <text x={X(xEnd) - 4} y={Y(yEnd) + (xEnd >= xm ? 14 : -6)} className="mk-ax" textAnchor="end">{fmtInr(g)} per lead</text>
            </g>
          );
        })}
        {pts.map((p, i) => (
          <g key={`${p.s}-${p.r.id}`} className="mk-sc-pt" onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} tabIndex={0}
            aria-label={`${p.s ? "B" : "A"} · ${p.r.platform}, ${fmtInr(p.cost)}, ${p.leads} leads, ${p.pay} payments`}>
            <circle cx={X(p.cost)} cy={Y(p.leads)} r={place[i].r} fill={SIDE[p.s]} fillOpacity={hover == null || hover === i ? 0.88 : 0.35} stroke="var(--bg2)" strokeWidth="2" />
            {place[i].text && <text x={place[i].x} y={Y(p.leads) + 4} className="mk-sc-l" fill={SIDE[p.s]} textAnchor={place[i].anchor as "start" | "end"}>{place[i].text}</text>}
          </g>
        ))}
      </svg>
      {hp && (
        <div className="mk-ca-tip" style={{ left: Math.min(Math.max(8, X(hp.cost) - 120), W - 258), top: Math.max(4, Y(hp.leads) - 120) }} role="status">
          <h5 style={{ color: SIDE[hp.s] }}>{hp.s ? "B" : "A"} · {hp.r.influencer ?? hp.r.label}</h5>
          <div className="mk-ca-tr"><span>{hp.r.platform}</span><b>{hp.r.live_date ? `live ${fmtDate(hp.r.live_date)}` : "no live date"}</b></div>
          <div className="mk-ca-tr"><span>Cost · views</span><b>{fmtInr(hp.cost)} · {fmtCompact(Number(hp.r.views) || 0)}</b></div>
          <div className="mk-ca-tr"><span>Leads · paid · enrolled</span><b>{fmtInt(hp.leads)} · {fmtInt(hp.pay)} · {fmtInt(hp.r.enrollments)}</b></div>
          <div className="mk-ca-tr"><span>CPL · CPP</span><b>{fmtInr(hp.leads ? hp.cost / hp.leads : null)} · {fmtInr(hp.pay ? hp.cost / hp.pay : null)}</b></div>
        </div>
      )}
    </div>
  );
}

const pctTxt = (p: number) => `${p > 0 && p < 1 ? "<1" : Math.round(p)}%`;

/** Each side's leads as one bar split by the days after the post went live; a part's numbers sit inside it when it is wide enough (else on hover). */
export function LeadTimingCompare({ a, b, labels }: { a: LeadTiming | null; b: LeadTiming | null; labels: [string, string] }) {
  const sides = [timingParts(a), timingParts(b)];
  const used = new Set(sides.flatMap((s) => s.parts.map((p) => p.k)));
  return (
    <div className="mk-lt">
      {sides.map(({ total, parts }, s) => (
        <div key={s} className="mk-lt-r">
          <div className="mk-lt-n" style={{ color: SIDE[s] }} title={labels[s]}>{s ? "B" : "A"} · {labels[s]}</div>
          {total === 0 ? <div className="mk-lt-bar mk-lt-none">{[a, b][s] === null ? "Loading…" : "No leads yet"}</div> : (
            <TimingBar parts={parts} label={`${s ? "B" : "A"} · ${labels[s]}`} />
          )}
          <div className="mk-lt-t">{[a, b][s] === null ? "" : `${fmtInt(total)} leads`}</div>
        </div>
      ))}
      <div className="mk-lt-legend">
        {TIMING_PARTS.filter((p) => p.k !== "no_live" || used.has("no_live")).map((p) => <span key={p.k}><i className={`mk-lt-${p.k}`} />{p.label}</span>)}
      </div>
    </div>
  );
}

/** One side's bar. A part shows its numbers only when they fit inside it (measured in real pixels); otherwise they are on hover. */
function TimingBar({ parts, label }: { parts: ReturnType<typeof timingParts>["parts"]; label: string }) {
  const [ref, w] = useWidth<HTMLDivElement>(600, 0);
  const free = w - 2 * (parts.length - 1); // 2px gaps
  return (
    <div className="mk-lt-bar" ref={ref} role="img" aria-label={`${label}: ${parts.map((p) => `${p.label} ${p.n} (${pctTxt(p.pct)})`).join(", ")}`}>
      {parts.map((p) => {
        const text = `${fmtInt(p.n)} · ${pctTxt(p.pct)}`;
        const fits = (p.pct / 100) * free >= text.length * 7.2 + 20;
        return (
          <span key={p.k} className={`mk-lt-s mk-lt-${p.k}`} style={{ flexGrow: p.n }} title={`${p.label}: ${fmtInt(p.n)} leads (${pctTxt(p.pct)})`}>
            {fits && <b>{text}</b>}
          </span>
        );
      })}
    </div>
  );
}

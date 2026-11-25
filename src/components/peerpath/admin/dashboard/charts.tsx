"use client";

import { useId, type ReactNode } from "react";
import { DOW, pct } from "@/lib/peerpath/admin-dashboard";
import { useHit, useUi } from "./ui";

/* All charts are plain SVG with a viewBox, so they scale to their panel. Width W comes from the dashboard
   (640, or 380 on phones so labels stay readable). Every mark has a tooltip; most open a drawer on click. */

const cleanId = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, "");

export function Sparkline({ values, color = "#9152ff" }: { values: number[]; color?: string }) {
  const gid = `sg${cleanId(useId())}`;
  if (values.length === 0) return null;
  const max = Math.max(1, ...values);
  const n = values.length;
  const w = 160;
  const h = 34;
  const pts = values.map((v, i) => [(i / Math.max(1, n - 1)) * w, h - 3 - (v / max) * (h - 8)] as const);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity=".35" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line} L${w} ${h} L0 ${h} Z`} fill={`url(#${gid})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
      <circle cx={last[0]} cy={last[1]} r="2.6" fill={color} />
    </svg>
  );
}

function YGrid({ top, padL, padT, ih, W, steps = 4 }: { top: number; padL: number; padT: number; ih: number; W: number; steps?: number }) {
  const step = top / steps;
  return (
    <>
      {Array.from({ length: steps + 1 }, (_, k) => k).map((k) => {
        const v = step * k;
        const y = padT + ih - (v / top) * ih;
        return (
          <g key={k}>
            <line className="gridline" x1={padL} x2={W - 8} y1={y} y2={y} />
            <text x={padL - 6} y={y + 4} textAnchor="end">
              {Number.isInteger(v) ? v : v.toFixed(1)}
            </text>
          </g>
        );
      })}
    </>
  );
}

/** 4 even steps that end on a round number at or above max. */
const niceTop = (max: number, minTop = 4) => {
  const m = Math.max(minTop, max);
  return Math.ceil(m / 4) * 4;
};

export type AreaPoint = { v: number; label: string; title: string; extra?: ReactNode };

export function AreaChart({ points, h = 230, color = "#9152ff", label, onPoint, maxTop, steps = 4, width }: { points: AreaPoint[]; h?: number; color?: string; label: string; onPoint?: (i: number) => void; maxTop?: number; steps?: number; width?: number }) {
  const ui = useUi();
  const W = width ?? ui.W;
  const hit = useHit();
  const gid = `ag${cleanId(useId())}`;
  const n = points.length;
  if (n === 0) return null;
  const padL = 30;
  const padB = 24;
  const padT = 12;
  const iw = W - padL - 8;
  const ih = h - padB - padT;
  const top = maxTop ?? niceTop(Math.max(...points.map((p) => p.v)));
  const x = (i: number) => padL + (n === 1 ? iw / 2 : (i / (n - 1)) * iw);
  const y = (v: number) => padT + ih - (v / top) * ih;
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(p.v).toFixed(1)}`).join(" ");
  const every = Math.max(1, Math.round(n / (W < 500 ? 4 : 7)));
  const colW = n > 1 ? iw / (n - 1) : iw;
  return (
    <svg className="ppd-chart" viewBox={`0 0 ${W} ${h}`} role="img" aria-label={`${label} per day`}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity=".45" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <YGrid top={top} padL={padL} padT={padT} ih={ih} W={W} steps={steps} />
      {points.map((p, i) =>
        i % every === 0 || i === n - 1 ? (
          <text key={`l${i}`} x={x(i)} y={h - 6} textAnchor="middle">
            {p.label}
          </text>
        ) : null,
      )}
      <path d={`${line} L${x(n - 1)} ${padT + ih} L${x(0)} ${padT + ih} Z`} fill={`url(#${gid})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="2.4" strokeLinejoin="round" />
      <circle cx={x(n - 1)} cy={y(points[n - 1].v)} r="4" fill={color} />
      {points.map((p, i) => (
        <g
          key={`c${i}`}
          className="ppd-col"
          {...hit(
            <>
              <b>{p.title}</b>
              <br />
              <span className="k">{label}:</span> <b>{p.v}</b>
              {p.extra}
            </>,
            onPoint ? () => onPoint(i) : undefined,
          )}
        >
          <rect x={x(i) - colW / 2} y={padT} width={colW} height={ih} fill="transparent" />
          <line className="guide" x1={x(i)} x2={x(i)} y1={padT} y2={padT + ih} stroke="rgb(204 172 255)" strokeDasharray="3 3" />
          <circle className="guide" cx={x(i)} cy={y(p.v)} r="4.5" fill="#fff" stroke={color} strokeWidth="2" />
        </g>
      ))}
    </svg>
  );
}

export type StackKey<G> = { key: keyof G & string; label: string; color: string };

export function StackedBars<G extends { label: string; title: string; current?: boolean }>({
  groups,
  keys,
  h = 240,
  onBar,
  width,
  label = "Chats per week",
}: {
  groups: G[];
  keys: StackKey<G>[];
  h?: number;
  onBar?: (g: G) => void;
  width?: number;
  /** what the chart shows, for screen readers */
  label?: string;
}) {
  const ui = useUi();
  const W = width ?? ui.W;
  const hit = useHit();
  const padL = 30;
  const padB = 26;
  const padT = 14;
  const iw = W - padL - 8;
  const ih = h - padB - padT;
  const val = (g: G, k: StackKey<G>) => Number(g[k.key]) || 0;
  const total = (g: G) => keys.reduce((a, k) => a + val(g, k), 0);
  const top = niceTop(Math.max(0, ...groups.map(total)));
  const bw = iw / Math.max(1, groups.length);
  return (
    <svg className="ppd-chart" viewBox={`0 0 ${W} ${h}`} role="img" aria-label={label}>
      <YGrid top={top} padL={padL} padT={padT} ih={ih} W={W} />
      {groups.map((g, i) => {
        const x0 = padL + i * bw + bw * 0.18;
        const w = bw * 0.64;
        const t = total(g);
        let acc = 0;
        const showLabel = !(W < 500 && !g.current && (groups.length - 1 - i) % 2);
        return (
          <g key={i}>
            <g
              className="ppd-hit"
              {...hit(
                <>
                  <b>{g.title}</b>
                  {keys.map((k) => (
                    <span key={k.key}>
                      <br />
                      <span className="k">{k.label}:</span> <b>{val(g, k)}</b>
                    </span>
                  ))}
                </>,
                onBar ? () => onBar(g) : undefined,
              )}
            >
              <rect x={padL + i * bw} y={padT} width={bw} height={ih} fill="transparent" />
              {keys.map((k) => {
                const v = val(g, k);
                if (!v) return null;
                const hh = (v / top) * ih;
                const yy = padT + ih - ((acc + v) / top) * ih;
                acc += v;
                return <rect key={k.key} className="bar" x={x0} y={yy} width={w} height={Math.max(1, hh - 1.5)} rx={acc === t ? 5 : 2} fill={k.color} />;
              })}
              {t > 0 && bw >= 16 /* thin bars (30 days on a phone): the tooltip has the number */ && (
                <text x={x0 + w / 2} y={padT + ih - (t / top) * ih - 6} textAnchor="middle" style={{ fill: "var(--ink)", fontWeight: 600 }}>
                  {t}
                </text>
              )}
            </g>
            {showLabel && (
              <text x={x0 + w / 2} y={h - 7} textAnchor="middle" style={g.current ? { fill: "var(--o700)", fontWeight: 600 } : undefined}>
                {g.label}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

export type DonutPart = { label: string; v: number; color: string; onClick?: () => void };

export function Donut({ parts, center, sub, size = 180 }: { parts: DonutPart[]; center: ReactNode; sub: string; size?: number }) {
  const hit = useHit();
  const total = parts.reduce((a, p) => a + p.v, 0);
  const r = 70;
  const c = 2 * Math.PI * r;
  let off = 0;
  return (
    <svg viewBox="0 0 180 180" width={size} height={size} role="img" aria-label={sub} style={{ flex: "none" }}>
      <circle r={r} cx="90" cy="90" fill="none" stroke="var(--soft)" strokeWidth="22" />
      {total > 0 &&
        parts.map((p) => {
          const len = (p.v / total) * c;
          const el = (
            <g
              key={p.label}
              className="ppd-hit"
              {...hit(
                <>
                  <b>{p.label}</b>
                  <br />
                  <b>{p.v}</b> <span className="k">({pct(p.v, total)}%)</span>
                </>,
                p.onClick,
              )}
            >
              <circle className="bar" r={r} cx="90" cy="90" fill="none" stroke={p.color} strokeWidth="22" strokeDasharray={`${Math.max(0, len - 2)} ${c}`} strokeDashoffset={-off} transform="rotate(-90 90 90)" />
            </g>
          );
          off += len;
          return el;
        })}
      <text x="90" y="88" textAnchor="middle" style={{ fill: "var(--heading)", fontSize: 28, fontWeight: 600 }}>
        {center}
      </text>
      <text x="90" y="110" textAnchor="middle" style={{ fill: "var(--muted)", fontSize: 12 }}>
        {sub}
      </text>
    </svg>
  );
}

export function Heatmap({ grid, cols, onCell }: { grid: number[][]; cols: readonly string[]; onCell?: (row: number, col: number) => void }) {
  const { W } = useUi();
  const hit = useHit();
  const padL = 40;
  const padT = 22;
  const cw = (W - padL - 4) / cols.length;
  const ch = 30;
  const h = padT + 7 * ch + 4;
  const max = Math.max(1, ...grid.flat());
  return (
    <svg className="ppd-chart" viewBox={`0 0 ${W} ${h}`} role="img" aria-label="Chats by day and time">
      {cols.map((c, j) => (
        <text key={c} x={padL + j * cw + cw / 2} y="14" textAnchor="middle">
          {c}
        </text>
      ))}
      {grid.map((row, i) => (
        <g key={i}>
          <text x={padL - 8} y={padT + i * ch + ch / 2 + 4} textAnchor="end">
            {DOW[i]}
          </text>
          {row.map((v, j) => {
            const a = v ? 0.18 + 0.82 * (v / max) : 0;
            return (
              <g
                key={j}
                className="ppd-hit"
                {...hit(
                  <>
                    <b>
                      {DOW[i]}, {cols[j]}
                    </b>
                    <br />
                    <span className="k">chats:</span> <b>{v}</b>
                  </>,
                  onCell && v ? () => onCell(i, j) : undefined,
                )}
              >
                <rect className="cell" x={padL + j * cw + 2} y={padT + i * ch + 2} width={cw - 4} height={ch - 4} rx="6" fill={v ? `rgb(118 41 252 / ${a.toFixed(2)})` : "rgb(28 19 52)"} />
                {v > 0 && (
                  <text x={padL + j * cw + cw / 2} y={padT + i * ch + ch / 2 + 4} textAnchor="middle" style={{ fill: "#fff", fontWeight: 600 }}>
                    {v}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      ))}
    </svg>
  );
}

export function Histogram({ bins, h = 180, color = "#9152ff", unit = "", noun = "chats", width }: { bins: { label: string; v: number }[]; h?: number; color?: string; unit?: string; noun?: string; width?: number }) {
  const ui = useUi();
  const W = width ?? ui.W;
  const hit = useHit();
  const padT = 16;
  const padB = 24;
  const padL = 12;
  const iw = W - padL * 2;
  const ih = h - padB - padT;
  const max = Math.max(1, ...bins.map((b) => b.v));
  const bw = iw / Math.max(1, bins.length);
  return (
    <svg className="ppd-chart" viewBox={`0 0 ${W} ${h}`} role="img" aria-label="Distribution">
      {bins.map((b, i) => {
        const hh = (b.v / max) * ih;
        return (
          <g
            key={b.label}
            className="ppd-hit"
            {...hit(
              <>
                <b>
                  {b.label}
                  {unit}
                </b>
                <br />
                <b>{b.v}</b> <span className="k">{noun}</span>
              </>,
            )}
          >
            <rect x={padL + i * bw} y={padT} width={bw} height={ih} fill="transparent" />
            <rect className="bar" x={padL + i * bw + 3} y={padT + ih - hh} width={bw - 6} height={Math.max(0, hh)} rx="4" fill={color} />
            <text x={padL + i * bw + bw / 2} y={h - 6} textAnchor="middle">
              {b.label}
            </text>
            {b.v > 0 && (
              <text x={padL + i * bw + bw / 2} y={padT + ih - hh - 5} textAnchor="middle" style={{ fill: "var(--ink)" }}>
                {b.v}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

export type HBarRow = { label: string; v: number; note?: string; color?: string; tip?: ReactNode; onClick?: () => void };

export function HBars({ rows, color = "linear-gradient(90deg,#7629fc,#9152ff)" }: { rows: HBarRow[]; color?: string }) {
  const hit = useHit();
  const m = Math.max(1, ...rows.map((r) => r.v));
  return (
    <div className="ppd-hbars">
      {rows.map((r) => (
        <div key={r.label} className="ppd-hb" {...hit(r.tip ?? null, r.onClick)}>
          <span>{r.label}</span>
          <div className="t">
            <div className="f" style={{ width: `${r.v ? Math.max(3, (r.v / m) * 100) : 0}%`, background: r.color ?? color }} />
          </div>
          <span className="n num">
            <b>{r.v}</b>
            {r.note ? ` · ${r.note}` : ""}
          </span>
        </div>
      ))}
    </div>
  );
}

/** A number card: value, change against the previous period, optional sparkline. */
export function Kpi({
  label,
  value,
  prev,
  series,
  tone,
  color = "#9152ff",
  fmt = (v: number) => String(v),
  unit = "",
  invert = false,
  onClick,
  empty = false,
}: {
  label: string;
  value: number;
  prev?: number | null;
  series?: number[];
  tone?: "warn" | "good";
  color?: string;
  fmt?: (v: number) => string;
  unit?: string;
  invert?: boolean;
  onClick?: () => void;
  /** no data: shows a dash */
  empty?: boolean;
}) {
  const { range } = useUi();
  const hit = useHit();
  const show = (v: number) => (empty ? "–" : `${fmt(v)}${unit}`);
  let delta: ReactNode = null;
  if (!empty && prev !== null && prev !== undefined) {
    const diff = Math.round((value - prev) * 10) / 10;
    const good = invert ? diff < 0 : diff > 0;
    delta =
      diff === 0 ? (
        <span>same as previous {range} days</span>
      ) : (
        <>
          <span className={good ? "up" : "down"}>
            {diff > 0 ? "▲" : "▼"} {fmt(Math.abs(diff))}
            {unit}
          </span>{" "}
          vs previous {range} days
        </>
      );
  }
  return (
    <div
      className="ppd-kpi"
      {...hit(
        <>
          <b>{label}</b>
          <br />
          <span className="k">This period:</span> <b>{show(value)}</b>
          {prev !== null && prev !== undefined && (
            <>
              <br />
              <span className="k">Previous {range} days:</span> <b>{show(prev)}</b>
            </>
          )}
        </>,
        onClick,
      )}
    >
      <span className="l">{label}</span>
      <span className={`v num ${empty ? "" : (tone ?? "")}`}>{show(value)}</span>
      <span className="d">{delta}</span>
      {series && <Sparkline values={series} color={color} />}
    </div>
  );
}

"use client";

import { useMemo } from "react";
import { INDIA_STATES, INDIA_VIEWBOX } from "./india-geo";
import type { StateRow } from "./data";
import { fmt, pct, ratio } from "./lib";

export type MapMetric = "users" | "mqr" | "vsat";

// DB state name -> map shape. Normalise both sides (lowercase, & -> and, drop non-letters).
const norm = (s: string) => s.toLowerCase().replace(/&/g, "and").replace(/[^a-z]/g, "");

// The sign-up form uses today's names; this (older) map draws the merged UT as its two old parts,
// so both parts take the merged UT's colour.
const SHAPE_ALIAS: Record<string, string> = {
  dadraandnagarhaveli: "dadraandnagarhavelianddamananddiu",
  damananddiu: "dadraandnagarhavelianddamananddiu",
};
// every DB name the map can colour; anything else (e.g. Ladakh, drawn inside J&K's outline) is listed under the map
const DRAWN = new Set([...INDIA_STATES.map((s) => norm(s.name)), ...Object.values(SHAPE_ALIAS)]);

/** The value a state is coloured by, and the label shown in its tooltip. */
function valueOf(metric: MapMetric, r: StateRow): number {
  if (metric === "mqr") return ratio(r.mqr, r.users) * 100;
  if (metric === "vsat") return ratio(r.vsat_early, r.users) * 100;
  return r.users;
}
const METRIC_LABEL: Record<MapMetric, string> = { users: "users", mqr: "MQR %", vsat: "VSAT early %" };

/** A light→blue colour ramp. t in [0,1]. */
function ramp(t: number): string {
  const c = Math.max(0, Math.min(1, t));
  const lerp = (a: number, b: number) => Math.round(a + (b - a) * c);
  return `rgb(${lerp(0x16, 0x2f)},${lerp(0x24, 0x9b)},${lerp(0x3f, 0xff)})`;
}
const NO_DATA = "#141825";

/**
 * India choropleth for the States tab. Colours each state by the chosen metric from the
 * same rows the bars use. Clicking a state with data calls onPick (opens the people drawer),
 * exactly like clicking its bar. States with no sign-ups are greyed; "Unknown" is not on the
 * map (shown as a chip beside it). Boundaries are illustrative, not an official map.
 */
export function StateMap({ rows, metric, onPick, unknown, total }: {
  rows: StateRow[]; metric: MapMetric; onPick: (state: string) => void; unknown?: StateRow; total: number;
}) {
  const byName = useMemo(() => {
    const m = new Map<string, StateRow>();
    rows.forEach((r) => { if (r.state !== "Unknown") m.set(norm(r.state), r); });
    return m;
  }, [rows]);

  const offMap = useMemo(() => rows.filter((r) => r.state !== "Unknown" && r.users > 0 && !DRAWN.has(norm(r.state))), [rows]);
  const max = useMemo(() => Math.max(1, ...rows.filter((r) => r.state !== "Unknown").map((r) => valueOf(metric, r))), [rows, metric]);
  // sqrt spread for counts (one big state would wash the rest out); linear for percentages
  const scale = (v: number) => (metric === "users" ? Math.sqrt(v / max) : v / max);
  const tip = (r: StateRow) => metric === "users"
    ? `${r.state}: ${fmt(r.users)} users`
    : `${r.state}: ${metric === "mqr" ? pct(r.mqr, r.users) : pct(r.vsat_early, r.users)} ${METRIC_LABEL[metric]} (${fmt(r.users)} users)`;

  return (
    <div>
      <style>{`.insMap path{transition:fill .15s,stroke .15s}.insMap path[data-has="1"]{cursor:pointer}.insMap path[data-has="1"]:hover{stroke:#fff;stroke-width:1.4}`}</style>
      {/* fills its column width (height follows); its column is sized in the States tab, so the map,
          the legend and the Unknown chip all share the same width and left edge */}
      <svg className="insMap" viewBox={INDIA_VIEWBOX} role="img" aria-label={`India map coloured by ${METRIC_LABEL[metric]} per state`} style={{ width: "100%", height: "auto", display: "block" }}>
        {INDIA_STATES.map((s) => {
          const r = byName.get(norm(s.name)) ?? byName.get(SHAPE_ALIAS[norm(s.name)] ?? "");
          const fill = r ? ramp(scale(valueOf(metric, r))) : NO_DATA;
          return (
            <path key={s.id} d={s.path} fill={fill} stroke="#0a0c14" strokeWidth={0.8}
              data-has={r ? "1" : "0"} onClick={r ? () => onPick(r.state) : undefined}>
              <title>{r ? tip(r) : `${s.name}: no sign-ups`}</title>
            </path>
          );
        })}
      </svg>
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-[12px] text-white/55">
        <span>Fewer</span>
        <span className="h-2.5 w-40 rounded-full" style={{ background: `linear-gradient(90deg, ${[0, 0.25, 0.5, 0.75, 1].map((t) => ramp(metric === "users" ? Math.sqrt(t) : t)).join(",")})` }} />
        <span>More</span>
        <span className="text-white/35">· grey = no sign-ups · hover a state for its number</span>
      </div>
      {offMap.length > 0 && (
        <div className="mt-2 text-[12px] text-white/55">
          Not drawn on this map:{" "}
          {offMap.map((r, i) => (
            <span key={r.state}>{i > 0 && ", "}
              <button type="button" onClick={() => onPick(r.state)} className="underline decoration-white/25 underline-offset-2 hover:text-white">
                {r.state} ({fmt(r.users)})
              </button>
            </span>
          ))}
        </div>
      )}
      {unknown && unknown.users > 0 && (
        <button type="button" onClick={() => onPick("Unknown")}
          className="mt-3 flex w-full items-center gap-2 rounded-xl border border-dashed border-white/20 px-3 py-2 text-left text-[12.5px] text-white/70 transition-colors hover:bg-white/[0.05]">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-white/45" aria-hidden>
            <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" /><line x1="4" y1="22" x2="4" y2="15" />
          </svg>
          <span><b className="text-white">Unknown: {fmt(unknown.users)}</b> ({pct(unknown.users, total)}) — no state on their profile, so not on the map. Click to see them.</span>
        </button>
      )}
    </div>
  );
}

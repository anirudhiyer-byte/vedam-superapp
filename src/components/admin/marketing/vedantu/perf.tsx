"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { VdList, VdRow } from "@/lib/growth/vedantu";
import {
  anyPerfFilter, cellOf, DRILL_PAGE, drillCsv, drillFileName, drillParams, filterDrill, filterPerfRows, fmtCount, fmtPct, fmtShortInr,
  nextDrillSort, NO_PERF_FILTER, perfKpis, perfOptions, rangeError, sortDrill,
  type DrillSort, type PerfFilter, type VdDrill, type VdDrillScope, type VdDrillType,
} from "@/lib/growth/vedantu-perf";
import { call, type Client } from "./api";
import { useFitText } from "./listing";
import { Icon, type IconName } from "../consultants/icons";
import { Loading, Modal, ModalHead } from "../consultants/perf-ui";

/**
 * Growth → Marketing Channels → Vedantu Channel → Vedantu Performance. Admin only.
 *
 * As the vedamcrm360 Vedantu Performance page: the cards are the totals of the Vedantu Listing rows (growth_vd_list,
 * 0136 — live numbers, no Refresh), narrowed by From / To (Live Date), Campaign and Channel. Leads / Payments /
 * Enrolments open the people behind them (growth_vd_perf_drill, 0137: same rule as the Listing, each person once),
 * with search, a filter per column, sort, 50 a page and a CSV download (admins only, formula-safe).
 */
const OR = "#F97D03", PK = "#E80074", CY = "#00CFE5", LV = "#8A18FF";

type DrillTarget = { type: VdDrillType; scope: VdDrillScope; label: string; color: string; card: number; f: PerfFilter };

export function VedantuPerformance({ sb }: { sb: Client }) {
  const [rows, setRows] = useState<VdRow[] | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [f, setF] = useState<PerfFilter>(NO_PERF_FILTER);
  const [drill, setDrill] = useState<DrillTarget | null>(null);

  const load = useCallback(async () => {
    setLoadErr("");
    const r = await call<VdList>(sb, "growth_vd_list", { view: "active" });
    if (r.error || !r.data) { setLoadErr(r.error ?? "Could not load the Vedantu rows."); return; }
    setRows(r.data.rows ?? []);
  }, [sb]);
  useEffect(() => { void load(); }, [load]);

  const all = useMemo(() => rows ?? [], [rows]);
  const badRange = rangeError(f);
  const filtered = useMemo(() => (badRange ? [] : filterPerfRows(all, f)), [all, f, badRange]);
  const k = useMemo(() => perfKpis(filtered), [filtered]);
  const campaigns = useMemo(() => perfOptions(all, "campaign"), [all]);
  const channels = useMemo(() => perfOptions(all, "channel"), [all]);
  const clickable = filtered.some((r) => !!r.utm_link?.trim());
  const ld = rows === null;
  const set = (patch: Partial<PerfFilter>) => setF((x) => ({ ...x, ...patch }));
  const open = (type: VdDrillType, scope: VdDrillScope, label: string, color: string, card: number) =>
    clickable && setDrill({ type, scope, label, color, card, f });

  return (
    <div className="vcn-page">
      <div className="vcn-head">
        <div>
          <h1 className="vcn-h1">Vedantu Performance</h1>
          <p className="vcn-sub">{ld ? "Loading…" : `${all.length.toLocaleString("en-IN")} videos · UTM-attributed · click any leads/payments/enrolment number to drill`}</p>
        </div>
      </div>

      {loadErr && (
        <div className="vcn-banner err" role="alert"><Icon n="alert" /><div>{loadErr}</div>
          <button type="button" className="vcn-sbtn" onClick={() => void load()}><Icon n="refresh" size="s" /> Try again</button>
        </div>
      )}

      <div className="vvp-bar" role="search">
        <div className="vvp-bar-in">
          <div className="vvp-f">
            <label htmlFor="vvp-from">From</label>
            <div className="vvp-date"><Icon n="calendar" size="s" />
              <input id="vvp-from" className="vcn-in" type="date" value={f.from} max={f.to || undefined} onChange={(e) => set({ from: e.target.value })} />
            </div>
          </div>
          <div className="vvp-f">
            <label htmlFor="vvp-to">To</label>
            <div className="vvp-date"><Icon n="calendar" size="s" />
              <input id="vvp-to" className="vcn-in" type="date" value={f.to} min={f.from || undefined} onChange={(e) => set({ to: e.target.value })} />
            </div>
          </div>
          <div className="vvp-f">
            <label htmlFor="vvp-cp">Campaign</label>
            <select id="vvp-cp" className="vcn-sel cp" value={f.campaign} onChange={(e) => set({ campaign: e.target.value })}>
              <option value="">All campaigns</option>{campaigns.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="vvp-f">
            <label htmlFor="vvp-ch">Channel</label>
            <select id="vvp-ch" className="vcn-sel ch" value={f.channel} onChange={(e) => set({ channel: e.target.value })}>
              <option value="">All channels</option>{channels.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          {anyPerfFilter(f) && <button type="button" className="vcn-sbtn" onClick={() => setF(NO_PERF_FILTER)}><Icon n="x" size="s" /> Clear</button>}
          <div className="vvp-n" aria-live="polite">{ld ? "…" : `${filtered.length.toLocaleString("en-IN")} of ${all.length.toLocaleString("en-IN")} videos`}</div>
          {badRange && <p className="vvp-rerr" role="alert">{badRange}</p>}
        </div>
      </div>

      <div className="vvp-k6" aria-busy={ld}>
        <Card label="Total unique videos" v={ld ? null : fmtCount(k.uniqueVideos)} color={OR} icon="video" />
        <Card label="Total UTM" v={ld ? null : fmtCount(k.uniqueUtms)} color={PK} icon="link" />
        <Card label="Total views" v={ld ? null : fmtCount(k.totalViews)} color={CY} icon="eye" />
        <Card label="Total spend" v={ld ? null : fmtShortInr(k.totalSpend)} color={LV} icon="wallet" />
        <Card label="CPL" sub="Cost per lead" v={ld ? null : fmtShortInr(k.cpl)} color={PK} />
        <Card label="CPP" sub="Cost per payment" v={ld ? null : fmtShortInr(k.cpp)} color={LV} />
      </div>

      <div className="vvp-k4" aria-busy={ld}>
        <Dual label="Leads" icon="users" clickable={clickable && !ld}
          left={{ sub: "In window", v: ld ? null : fmtCount(k.leadsWin), color: OR, go: () => open("leads", "in_window", "Leads (In Window)", OR, k.leadsWin) }}
          right={{ sub: "All time", v: ld ? null : fmtCount(k.leadsAll), color: PK, go: () => open("leads", "all_time", "Leads (All Time)", PK, k.leadsAll) }} />
        <Dual label="Payments" icon="card" clickable={clickable && !ld}
          left={{ sub: "In window", v: ld ? null : fmtCount(k.payWin), color: LV, go: () => open("payments", "in_window", "Payments (In Window)", LV, k.payWin) }}
          right={{ sub: "All time", v: ld ? null : fmtCount(k.payAll), color: CY, go: () => open("payments", "all_time", "Payments (All Time)", CY, k.payAll) }} />
        <Card label="Enrolments" sub="All time" v={ld ? null : fmtCount(k.enrollments)} color={PK} icon="grad"
          onClick={clickable && !ld ? () => open("enrollments", "all_time", "Enrolments", PK, k.enrollments) : undefined} />
        <Card label="L2P" sub="Lead to payment" v={ld ? null : fmtPct(k.l2p)} color={OR} icon="trend" />
      </div>

      {!ld && filtered.length === 0 && !badRange && (
        <div className="vvp-empty">
          {all.length === 0 ? "No Vedantu rows yet." : "No videos match current filters."}
          <span>{all.length === 0 ? "Add rows in the Vedantu Listing to see their performance here." : "Adjust the filters above or add rows in the listing."}</span>
        </div>
      )}

      {drill && <DrillDialog sb={sb} t={drill} onClose={() => setDrill(null)} />}
    </div>
  );
}

// ───────────────────────────── cards ─────────────────────────────

function Value({ v, color }: { v: string | null; color: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useFitText(ref, v);
  return <div ref={ref} className={`vvp-v${v === null ? " ld" : ""}`} style={{ color: v === null ? undefined : color }} title={v ?? undefined}>{v ?? "…"}</div>;
}

function Card({ label, sub, v, color, icon, onClick }: { label: string; sub?: string; v: string | null; color: string; icon?: IconName; onClick?: () => void }) {
  const style = { ["--k" as string]: color } as CSSProperties;
  const body = (
    <>
      <div className="vvp-h"><span className="vvp-l">{label}</span>{icon && <Icon n={icon} size="s" />}</div>
      <Value v={v} color={color} />
      {sub && <div className="vvp-s">{sub}</div>}
      {onClick && <div className="vvp-dr" aria-hidden="true">Drill ↗</div>}
    </>
  );
  return onClick
    ? <button type="button" className="vvp-c" style={style} onClick={onClick} aria-label={`${label} ${sub ?? ""}: ${v ?? ""}. Open the list`}>{body}</button>
    : <div className="vvp-c" style={style}>{body}</div>;
}

type Side = { sub: string; v: string | null; color: string; go: () => void };
function Dual({ label, icon, left, right, clickable }: { label: string; icon: IconName; left: Side; right: Side; clickable: boolean }) {
  return (
    <div className="vvp-c" style={{ ["--k" as string]: left.color, ["--k2" as string]: right.color } as CSSProperties}>
      <div className="vvp-h"><span className="vvp-l">{label}</span><Icon n={icon} size="s" /></div>
      <div className="vvp-two">
        <Half label={label} side={left} clickable={clickable} />
        <Half label={label} side={right} clickable={clickable} />
      </div>
    </div>
  );
}

function Half({ label, side, clickable }: { label: string; side: Side; clickable: boolean }) {
  const body = (
    <>
      <div className="vvp-sl">{side.sub}</div>
      <Value v={side.v} color={side.color} />
      {clickable && <div className="vvp-dr" aria-hidden="true">Drill ↗</div>}
    </>
  );
  return clickable
    ? <button type="button" className="vvp-half" onClick={side.go} aria-label={`${label} ${side.sub}: ${side.v ?? ""}. Open the list`}>{body}</button>
    : <div className="vvp-half">{body}</div>;
}

// ───────────────────────────── drill ─────────────────────────────

function DrillDialog({ sb, t, onClose }: { sb: Client; t: DrillTarget; onClose: () => void }) {
  const [data, setData] = useState<VdDrill | null>(null);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const [colF, setColF] = useState<Record<string, string>>({});
  const [sort, setSort] = useState<DrillSort>(null);
  const [page, setPage] = useState(0);

  const load = useCallback(async () => {
    setErr(""); setData(null);
    const r = await call<VdDrill>(sb, "growth_vd_perf_drill", drillParams(t.type, t.scope, t.f));
    if (r.error || !r.data) { setErr(r.error ?? "Could not load the list."); return; }
    setData(r.data);
  }, [sb, t]);
  useEffect(() => { void load(); }, [load]);

  const columns = useMemo(() => data?.columns ?? [], [data]);
  const shown = useMemo(() => sortDrill(filterDrill(data?.students ?? [], q, colF), sort), [data, q, colF, sort]);
  useEffect(() => setPage(0), [q, colF, sort]);
  const pages = Math.max(1, Math.ceil(shown.length / DRILL_PAGE));
  const safe = Math.min(page, pages - 1);
  const pageRows = shown.slice(safe * DRILL_PAGE, (safe + 1) * DRILL_PAGE);
  const total = data?.students.length ?? 0;

  const download = () => {
    if (!shown.length) return;
    const blob = new Blob(["﻿" + drillCsv(columns, shown)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = drillFileName(t.label, shown.length); document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const sub = data
    ? `${data.total.toLocaleString("en-IN")} rows${shown.length !== total ? ` · ${shown.length.toLocaleString("en-IN")} after filters` : ""}`
    : undefined;

  return (
    <Modal label={t.label} onClose={onClose}>
      <div className="vvp-md" style={{ display: "contents", ["--k" as string]: t.color } as CSSProperties}>
        <ModalHead eyebrow="Vedantu" title={t.label} sub={sub} color={t.color} onClose={onClose} />
        <div className="vvp-tools" style={{ ["--k" as string]: t.color } as CSSProperties}>
          <div className="vcn-search">
            <Icon n="search" />
            <input className="vcn-in" type="search" placeholder="Search across all columns…" aria-label="Search across all columns"
              value={q} onChange={(e) => setQ(e.target.value)} maxLength={200} disabled={!data} />
          </div>
          <button type="button" className="vvp-x" onClick={download} disabled={!shown.length}>
            <Icon n="download" size="s" /> Export CSV{shown.length > 0 && <small>({shown.length.toLocaleString("en-IN")})</small>}
          </button>
        </div>
        {data && data.total !== t.card && (
          <div className="vvp-note" style={{ ["--k" as string]: t.color } as CSSProperties}>
            {data.truncated
              ? `Showing the newest 5,000 of ${data.total.toLocaleString("en-IN")} people. Narrow the filters to see the rest.`
              : `The card shows ${t.card.toLocaleString("en-IN")}: it adds the Listing rows up, and a person whose UTM is in two rows counts in both. This list shows each person once.`}
          </div>
        )}
        <div className="vcp-mb">
          {err ? (
            <div className="vcn-empty" role="alert"><b>Couldn&apos;t load the list.</b><span>{err}</span>
              <button type="button" className="vcn-sbtn" style={{ marginTop: 14 }} onClick={() => void load()}><Icon n="refresh" size="s" /> Try again</button>
            </div>
          ) : !data ? (
            <Loading text="Loading rows…" color={t.color} />
          ) : total === 0 ? (
            <div className="vvp-nomatch">No people in this list.</div>
          ) : (
            <table className="vvp-dt" aria-label={`${t.label} · Vedantu`}>
              <thead>
                <tr>
                  {columns.map((c) => {
                    const on = sort?.col === c;
                    return (
                      <th key={c} scope="col" aria-sort={on ? (sort?.dir === "asc" ? "ascending" : "descending") : "none"}>
                        <button type="button" className={on ? "on" : ""} onClick={() => setSort((s) => nextDrillSort(s, c))}>
                          {c}<Icon n={on ? (sort?.dir === "asc" ? "up" : "down") : "updown"} size="xs" />
                        </button>
                      </th>
                    );
                  })}
                </tr>
                <tr className="flt">
                  {columns.map((c) => (
                    <th key={c}>
                      <input placeholder="filter…" aria-label={`Filter ${c}`} value={colF[c] ?? ""} maxLength={100}
                        onChange={(e) => setColF((x) => ({ ...x, [c]: e.target.value }))} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r, i) => (
                  <tr key={`${cellOf(r.lead_id)}-${i}`}>
                    {columns.map((c) => { const v = cellOf(r[c]); return <td key={c} title={v || undefined}>{v || "—"}</td>; })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {data && total > 0 && shown.length === 0 && <div className="vvp-nomatch">No rows match the search or the column filters.</div>}
        </div>
        {data && shown.length > 0 && (
          <div className="vcn-pg">
            <div className="vcn-pg-l"><span className="vcn-pg-n">Showing {safe * DRILL_PAGE + 1}–{Math.min((safe + 1) * DRILL_PAGE, shown.length)} of {shown.length.toLocaleString("en-IN")}</span></div>
            <div className="vcn-pg-r">
              <button type="button" className="vcn-pb" onClick={() => setPage(0)} disabled={safe === 0} aria-label="First page"><Icon n="first" size="s" /></button>
              <button type="button" className="vcn-pb" onClick={() => setPage(Math.max(0, safe - 1))} disabled={safe === 0} aria-label="Previous page"><Icon n="left" size="s" /></button>
              <span className="vcn-pg-n">{safe + 1} / {pages}</span>
              <button type="button" className="vcn-pb" onClick={() => setPage(Math.min(pages - 1, safe + 1))} disabled={safe >= pages - 1} aria-label="Next page"><Icon n="right" size="s" /></button>
              <button type="button" className="vcn-pb" onClick={() => setPage(pages - 1)} disabled={safe >= pages - 1} aria-label="Last page"><Icon n="last" size="s" /></button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

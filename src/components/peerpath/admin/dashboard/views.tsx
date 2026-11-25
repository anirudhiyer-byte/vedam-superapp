"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { CopyLink, SeniorStatusAction, StatusPill } from "@/components/peerpath/admin/senior-status";
import { yearLabel } from "@/components/peerpath/ui";
import {
  avgRating,
  dailySeries,
  dashSeniorRows,
  DOW,
  flaggedFeedback,
  HEAT_BANDS,
  heatBand,
  heatGrid,
  holds,
  impactRange,
  inWindow,
  isDoneChat,
  isUpcomingChat,
  istDow,
  istHour,
  leadBins,
  leadHours,
  lowRated,
  median,
  payBinsFor,
  pct,
  rangeWindow,
  scopeChats,
  seniorInScope,
  trendGroups,
  weekBuckets,
  type DashChat,
  type DashSeniorRow,
  type TrendGroup,
} from "@/lib/peerpath/admin-dashboard";
import { blockedReasons, notBookedPeople } from "@/lib/peerpath/admin-insights";
import { LANGUAGES, TOPICS, ttsPath } from "@/lib/peerpath/constants";
import { AreaChart, Donut, Heatmap, HBars, Histogram, Kpi, Sparkline, StackedBars } from "./charts";
import { ChatItem, DStat, Empty, Pill, useChatDrawer, useHit, useUi } from "./ui";

const VIOLET = "#7629fc";
const ORANGE = "#f97d03";
const WARN = "#ff7a6e";

function Panel({ title, sub, right, children }: { title: string; sub?: React.ReactNode; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="ppd-panel">
      <div className="ppd-phead">
        <div>
          <h2>{title}</h2>
          {sub && <p className="ppd-sub">{sub}</p>}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

/** Chats in scope (campus, senior, type) for the current and the previous range. */
function useScope() {
  const { data, filters, now } = useUi();
  return useMemo(() => {
    const all = scopeChats(data, filters);
    const win = rangeWindow(now, filters.range);
    const prevWin = rangeWindow(now, filters.range, 1);
    return { all, win, prevWin, cur: all.filter((c) => inWindow(c.start, win)), prev: all.filter((c) => inWindow(c.start, prevWin)) };
  }, [data, filters, now]);
}

/* ================= Overview ================= */

export function OverviewView({ go }: { go: (v: "seniors") => void }) {
  const { data, filters, now, open } = useUi();
  const chatDrawer = useChatDrawer();
  const { all, win, cur, prev } = useScope();
  const days = `Last ${filters.range} days`;
  const done = cur.filter((c) => isDoneChat(c, now));
  const pdone = prev.filter((c) => isDoneChat(c, now));
  const ns = cur.filter((c) => c.status === "no_show_applicant");
  const pns = prev.filter((c) => c.status === "no_show_applicant");
  const rated = done.filter((c) => c.rating !== null);
  const avg = avgRating(rated);
  const pavg = avgRating(pdone.filter((c) => c.rating !== null));
  const upcoming = all.filter((c) => isUpcomingChat(c, now));
  const seniors = data.seniors.filter((s) => seniorInScope(s, filters));
  const live = seniors.filter((s) => s.status === "active");
  const pending = seniors.filter((s) => s.status === "pending");
  const notReady = live.filter((s) => s.hours === 0 || !s.hasMeet);
  const toMark = all.filter((c) => c.toMark);
  const failed = all.filter((c) => c.inviteFailed);
  const flagged = all.filter(flaggedFeedback);
  const next24 = upcoming.filter((c) => c.start <= now + 86_400_000).sort((a, b) => a.start - b.start);
  const series = dailySeries(all.filter(holds), win);
  const doneSeries = dailySeries(all.filter((c) => isDoneChat(c, now)), win);

  const seniorList = (title: string, sub: string, list: typeof seniors) =>
    open({ title, sub, body: <SeniorListBody ids={list.map((s) => s.id)} /> });
  const needs: [number, string, string, () => void, boolean][] = [
    [pending.length, "waiting for approval", "New seniors to check", () => seniorList("Waiting for approval", "Approve to make them live.", pending), true],
    [notReady.length, "live but not ready", "No weekly times or no Meet link", () => seniorList("Live but not ready", "Nobody can book them until both are set.", notReady), true],
    [toMark.length, "chats to mark", "Meet couldn't confirm these", () => chatDrawer(toMark, "Chats to mark", "Meet couldn't confirm them. Open a chat to mark it."), true],
    [failed.length, "Meet invites failed", "Invite didn't reach the applicant", () => chatDrawer(failed, "Meet invite failed", "Open a chat to resend the invite."), true],
    [flagged.length, "feedback to read", "Promise reported or 2★ or less", () => chatDrawer(flagged, "Feedback to read", "A reported promise, or a rating of 2 or less."), true],
    [next24.length, "chats in the next 24 hours", "Heads-up only", () => chatDrawer(next24, "Next 24 hours", "Confirmed chats starting soon."), false],
  ];
  const todo = needs.filter((n) => n[4]).reduce((a, n) => a + n[0], 0);
  const byCampus = (["Pune", "Gurugram"] as const).map((c, i) => {
    const l = done.filter((x) => data.seniors.find((s) => s.id === x.seniorId)?.campus === c);
    return { label: c, v: l.length, color: i ? ORANGE : VIOLET, onClick: () => chatDrawer(l, `${c} · done chats`, days) };
  });

  return (
    <>
      <div className="ppd-kpis">
        <Kpi label="Chats done" value={done.length} prev={pdone.length} series={doneSeries.map((p) => p.v)} onClick={() => chatDrawer(done, "Chats done", days)} />
        <Kpi label="Upcoming" value={upcoming.length} color={ORANGE} onClick={() => chatDrawer(upcoming, "Upcoming chats", "Confirmed, not started yet")} />
        <Kpi label="No-show rate" value={pct(ns.length, done.length + ns.length)} prev={pct(pns.length, pdone.length + pns.length)} unit="%" invert tone={pct(ns.length, done.length + ns.length) > 15 ? "warn" : undefined} empty={done.length + ns.length === 0} onClick={() => chatDrawer(ns, "No-shows", days)} />
        <Kpi label="Average rating" value={avg ?? 0} prev={pavg} unit="★" fmt={(v) => v.toFixed(1)} empty={avg === null} onClick={() => chatDrawer(rated, "Rated chats", days)} />
        <Kpi label="Live seniors" value={live.length} onClick={() => go("seniors")} />
      </div>
      <div className="ppd-grid ppd-g21">
        <Panel title="Chats per day" sub="Booked chats by start date (IST). Cancelled and moved chats left out." right={<span className="ppd-hint">Hover a day · click to open it</span>}>
          <AreaChart points={series} label="chats" onPoint={(i) => chatDrawer(series[i].list, series[i].title, "Chats that day")} />
        </Panel>
        <Panel title="Needs action" sub="Click a line to see the list." right={todo ? <Pill tone="warn">{todo} to do</Pill> : <Pill tone="good">All clear</Pill>}>
          <div className="ppd-needs">
            {needs.map(([n, l, s, fn, hot]) => (
              <button key={l} type="button" className={`ppd-need ${hot && n ? "hot" : ""}`} onClick={fn}>
                <b className="num">{n}</b>
                <span>{l}</span>
                <small>{s}</small>
              </button>
            ))}
          </div>
        </Panel>
      </div>
      <div className="ppd-grid ppd-g11">
        <Panel title="Done chats by campus" sub="Hover or click a slice.">
          <div className="ppd-row">
            <Donut parts={byCampus} center={done.length} sub="done chats" />
            <div className="ppd-legend" style={{ flexDirection: "column", gap: 10, fontSize: 14 }}>
              {byCampus.map((p) => (
                <span key={p.label}>
                  <i style={{ background: p.color }} />
                  {p.label} <b style={{ color: "var(--heading)" }}>{p.v}</b> ({pct(p.v, done.length)}%)
                </span>
              ))}
            </div>
          </div>
        </Panel>
        <Panel title="Next 24 hours" sub="Confirmed chats starting soon.">
          {next24.length ? (
            <div className="ppd-dlist">
              {next24.slice(0, 6).map((c) => (
                <ChatItem key={c.id} c={c} />
              ))}
            </div>
          ) : (
            <Empty>Nothing in the next 24 hours.</Empty>
          )}
        </Panel>
      </div>
    </>
  );
}

/** Drawer list of seniors (re-reads live data, so Approve / Pause shows the new status right away). */
function SeniorListBody({ ids }: { ids: string[] }) {
  const { seniorsById, openSenior, demo } = useUi();
  const list = ids.map((id) => seniorsById.get(id)).filter((s) => s !== undefined);
  if (!list.length) return <Empty>Nobody here.</Empty>;
  return (
    <div className="ppd-dlist">
      {list.map((s) => (
        <div key={s.id} className="ppd-ditem">
          <div className="ppd-av">{s.firstName[0]}</div>
          <button type="button" className="m" style={{ border: 0, background: "none", padding: 0, textAlign: "left", cursor: "pointer" }} onClick={() => openSenior(s.id)}>
            <b>{s.firstName}</b>
            <small>
              {s.campus} · {yearLabel(s.year)} · {s.hours}h/week{s.hasMeet ? "" : " · no Meet link"}
            </small>
          </button>
          <div className="when">
            <StatusPill status={s.status} />
            {!demo && <SeniorStatusAction id={s.id} status={s.status} />}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ================= Sessions ================= */

export function SessionsView() {
  const { filters, now, W } = useUi();
  const chatDrawer = useChatDrawer();
  const { all, cur } = useScope();
  const days = `Last ${filters.range} days`;
  const booked = cur.filter((c) => c.status !== "rescheduled");
  const done = cur.filter((c) => isDoneChat(c, now));
  const fb = done.filter((c) => c.rating !== null);
  const steps: [string, DashChat[], string][] = [
    ["Booked", booked, "Every chat booked (a moved chat counts once)"],
    ["Done", done, "Completed, or confirmed and already over"],
    ["Feedback", fb, "Done chats the applicant rated"],
  ];
  const weeks = weekBuckets(all, now, 10);
  const held = cur.filter(holds);
  const grid = heatGrid(held);
  const leads = leadHours(held);
  const medLead = median(leads);
  const checked = done.filter((c) => c.minutes !== null || c.auto !== null);
  const autoDone = checked.filter((c) => c.auto === "completed");
  const mins = median(checked.map((c) => c.minutes).filter((m): m is number => m !== null));
  const hit = useHit();

  return (
    <>
      <div className="ppd-grid ppd-g11">
        <Panel title="From booking to feedback" sub={`${days}. Click a step to see its chats.`}>
          {booked.length ? (
            <div className="ppd-funnel">
              {steps.map(([n, l, hint], i) => (
                <div
                  key={n}
                  className="ppd-fstep"
                  {...hit(
                    <>
                      <b>{n}</b>
                      <br />
                      {hint}
                      <br />
                      <b>{l.length}</b> <span className="k">({pct(l.length, booked.length)}% of booked)</span>
                    </>,
                    () => chatDrawer(l, n, days),
                  )}
                >
                  <div className="row">
                    <span style={{ color: "var(--heading)", fontWeight: 600 }}>{n}</span>
                    <span>
                      <b className="num">{l.length}</b>{" "}
                      <span className="ppd-hint">
                        {pct(l.length, booked.length)}%{i ? ` · ${pct(l.length, steps[i - 1][1].length)}% of ${steps[i - 1][0].toLowerCase()}` : ""}
                      </span>
                    </span>
                  </div>
                  <div className="track">
                    <div className="fill" style={{ width: `${Math.max(l.length ? 3 : 0, pct(l.length, booked.length))}%`, opacity: 1 - i * 0.15 }} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <Empty>No chats in this range.</Empty>
          )}
          <div className="ppd-chips">
            {(
              [
                ["Upcoming", all.filter((c) => isUpcomingChat(c, now))],
                ["Cancelled", cur.filter((c) => c.status === "cancelled")],
                ["No-show", cur.filter((c) => c.status === "no_show_applicant")],
                ["Moved", cur.filter((c) => c.status === "rescheduled")],
              ] as const
            ).map(([l, list]) => (
              <button key={l} type="button" className="ppd-chip" onClick={() => chatDrawer(list, l, days)}>
                {l} <b className="num">{list.length}</b>
              </button>
            ))}
          </div>
        </Panel>
        <Panel title="What Meet saw" sub="Done chats that Meet attendance checked.">
          {checked.length ? (
            <div className="ppd-row">
              <Donut
                parts={[
                  { label: "Completed automatically", v: autoDone.length, color: VIOLET, onClick: () => chatDrawer(autoDone, "Completed automatically", "Meet saw both people") },
                  { label: "Needed marking", v: checked.length - autoDone.length, color: ORANGE, onClick: () => chatDrawer(checked.filter((c) => c.auto !== "completed"), "Needed marking", "Meet couldn't confirm") },
                ]}
                center={`${pct(autoDone.length, checked.length)}%`}
                sub="automatic"
              />
              <div style={{ display: "grid", gap: 12 }}>
                <DStat label="Median time together" value={mins === null ? "–" : `${Math.round(mins)} min`} />
                <DStat label="Checked by Meet" value={checked.length} />
              </div>
            </div>
          ) : (
            <Empty>No Meet checks in this range yet.</Empty>
          )}
        </Panel>
      </div>
      <Panel
        title="Chats per week"
        sub="Last 10 weeks, Monday to Sunday (IST). Campus, senior and type filters apply."
        right={
          <div className="ppd-legend">
            <span><i style={{ background: VIOLET }} />Done</span>
            <span><i style={{ background: "#c084fc" }} />Upcoming</span>
            <span><i style={{ background: WARN }} />No-show</span>
            <span><i style={{ background: "#3a2d5c" }} />Cancelled</span>
          </div>
        }
      >
        <StackedBars
          groups={weeks}
          keys={[
            { key: "done", label: "Done", color: VIOLET },
            { key: "upcoming", label: "Upcoming", color: "#c084fc" },
            { key: "noShow", label: "No-show", color: WARN },
            { key: "cancelled", label: "Cancelled", color: "#3a2d5c" },
          ]}
          onBar={(g) => chatDrawer(g.list, g.title, "All chats that week")}
          width={W === 640 ? 960 : W}
        />
      </Panel>
      <div className="ppd-grid ppd-g21">
        <Panel title="When chats happen" sub={`Day and time (IST), last ${filters.range} days. Click a cell.`}>
          {held.length ? (
            <Heatmap
              grid={grid}
              cols={HEAT_BANDS}
              onCell={(i, j) => chatDrawer(held.filter((c) => istDow(c.start) === i && heatBand(istHour(c.start)) === j), `${DOW[i]}, ${HEAT_BANDS[j]}`, days)}
            />
          ) : (
            <Empty>No chats in this range.</Empty>
          )}
        </Panel>
        <Panel title="Booked how early" sub={`Time from booking to chat. Median ${medLead === null ? "–" : medLead < 48 ? `${Math.round(medLead)}h` : `${(medLead / 24).toFixed(1)} days`}.`}>
          <Histogram bins={leadBins(leads)} width={W === 640 ? 400 : W} h={240} />
        </Panel>
      </div>
    </>
  );
}

/* ================= Seniors ================= */

type SortKey = "name" | "status" | "hours" | "chats" | "done" | "noShows" | "rating" | "rec" | "seen";
const STATUS_ORDER = { active: 0, pending: 1, paused: 2 } as const;

export function SeniorsView() {
  const { data, filters, openSenior, open, now } = useUi();
  const hit = useHit();
  const [q, setQ] = useState("");
  const [topic, setTopic] = useState<string | null>(null);
  const [sort, setSort] = useState<[SortKey, 1 | -1]>(["chats", -1]);
  const rowsAll = useMemo(() => dashSeniorRows(data, filters), [data, filters]);
  const liveRows = rowsAll.filter((r) => r.s.status === "active");
  const flagged = liveRows.filter((r) => r.idle || r.notSeen || r.atCap || !r.ready);
  const hours = Math.round(liveRows.reduce((a, r) => a + r.s.hours, 0) * 10) / 10;
  const perWeek = liveRows.reduce((a, r) => a + r.mine.filter((c) => holds(c) && c.start >= now - 28 * 86_400_000 && c.start <= now).length, 0) / 4;
  let rows = rowsAll;
  if (topic) rows = rows.filter((r) => r.s.topics.includes(topic) || r.s.languages.includes(topic));
  if (q.trim()) rows = rows.filter((r) => r.s.firstName.toLowerCase().includes(q.trim().toLowerCase()));
  const [k, dir] = sort;
  const val = (r: DashSeniorRow): number | string =>
    ({ name: r.s.firstName.toLowerCase(), status: STATUS_ORDER[r.s.status], hours: r.s.hours, chats: r.chats, done: r.done, noShows: r.noShows, rating: r.rating ?? -1, rec: r.recommendPct ?? -1, seen: r.seenDays ?? 1e9 })[k];
  rows = [...rows].sort((a, b) => (val(a) > val(b) ? 1 : val(a) < val(b) ? -1 : 0) * dir);
  const maxH = Math.max(1, ...rows.map((r) => r.s.hours));
  const live = data.seniors.filter((s) => s.status === "active" && seniorInScope(s, filters));
  const cov = (names: readonly string[], pick: (s: (typeof live)[number]) => string[]) => names.map((n) => ({ n, c: live.filter((s) => pick(s).includes(n)).length }));
  const th = (key: SortKey, label: string) => (
    <th aria-sort={sort[0] === key ? (sort[1] > 0 ? "ascending" : "descending") : undefined}>
      <button type="button" onClick={() => setSort(sort[0] === key ? [key, sort[1] > 0 ? -1 : 1] : [key, key === "name" || key === "status" ? 1 : -1])}>
        {label}
        {sort[0] === key ? (sort[1] > 0 ? " ↑" : " ↓") : ""}
      </button>
    </th>
  );

  return (
    <>
      <div className="ppd-kpis">
        <Kpi label="Live seniors" value={liveRows.length} />
        <Kpi label="Hours offered / week" value={hours} unit="h" />
        <Kpi label="Chats / week" value={perWeek} fmt={(v) => v.toFixed(1)} />
        <Kpi
          label="Need a look"
          value={flagged.length}
          tone={flagged.length ? "warn" : undefined}
          onClick={() => open({ title: "Need a look", sub: "Live seniors who are idle, not seen for 14 days, at their weekly cap, or not ready.", body: <SeniorListBody ids={flagged.map((r) => r.s.id)} /> })}
        />
      </div>
      <Panel title="Seniors" sub="Click a row for the senior's details and actions. Click a column to sort." right={<input className="ppd-search" type="search" placeholder="Search seniors" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search seniors" />}>
        {topic && (
          <div>
            <button type="button" className="ppd-chip" aria-pressed="true" onClick={() => setTopic(null)}>
              Covers “{topic}” ✕
            </button>
          </div>
        )}
        <div className="ppd-tablewrap">
          <table>
            <thead>
              <tr>
                {th("name", "Senior")}
                {th("status", "Status")}
                {th("hours", "Hours / week")}
                {th("chats", `Chats (${filters.range}d)`)}
                <th>Trend</th>
                {th("done", "Done")}
                {th("noShows", "No-shows")}
                {th("rating", "Rating")}
                {th("rec", "Recommend")}
                {th("seen", "Last active")}
                <th>Flags</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.s.id} {...hit(null, () => openSenior(r.s.id))}>
                  <td>
                    <div className="ppd-who">
                      <div className="ppd-av">{r.s.firstName[0]}</div>
                      <div>
                        <b>{r.s.firstName}</b>
                        <small>
                          {r.s.campus} · {yearLabel(r.s.year)}
                        </small>
                      </div>
                    </div>
                  </td>
                  <td>
                    <StatusPill status={r.s.status} />
                  </td>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ width: 70, height: 6, borderRadius: 99, background: "var(--soft)", overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${(r.s.hours / maxH) * 100}%`, background: "linear-gradient(90deg,var(--v500),var(--v600))" }} />
                      </div>
                      <span className="num" style={{ color: r.s.hours ? "var(--ink)" : "var(--warn)" }}>{r.s.hours}h</span>
                    </div>
                  </td>
                  <td className="num">{r.chats}</td>
                  <td style={{ width: 110 }}>
                    <div style={{ width: 100 }}>
                      <Sparkline values={r.weekly} />
                    </div>
                  </td>
                  <td className="num">{r.done}</td>
                  <td className="num" style={r.noShows > 2 ? { color: "var(--warn)", fontWeight: 600 } : undefined}>{r.noShows}</td>
                  <td className="num">
                    {r.rating !== null ? (
                      <>
                        {r.rating.toFixed(1)}★ <small style={{ color: "var(--muted)" }}>({r.reviews})</small>
                      </>
                    ) : (
                      "–"
                    )}
                  </td>
                  <td className="num">{r.recommendPct === null ? "–" : `${r.recommendPct}%`}</td>
                  <td>{r.seenDays === null ? "never" : r.seenDays ? `${r.seenDays}d ago` : "today"}</td>
                  <td style={{ whiteSpace: "normal", minWidth: 130 }}>
                    <SeniorFlags r={r} />
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={11}>
                    <Empty>{rowsAll.length ? "No seniors match." : "No seniors yet. Share the “Become a senior” page with current students."}</Empty>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>
      <div className="ppd-grid ppd-g11">
        {(
          [
            ["Topics covered", cov(TOPICS, (s) => s.topics)],
            ["Languages covered", cov(LANGUAGES, (s) => s.languages)],
          ] as const
        ).map(([t, list]) => (
          <Panel key={t} title={t} sub={`${list.filter((x) => x.c < 2).length} with fewer than 2 live seniors. Click one to filter the table.`}>
            <div className="ppd-chips">
              {list.map((x) => (
                <button key={x.n} type="button" className={`ppd-chip ${x.c < 2 ? "thin" : ""}`} aria-pressed={topic === x.n} onClick={() => setTopic(topic === x.n ? null : x.n)}>
                  {x.n} <b className="num">{x.c}</b>
                </button>
              ))}
            </div>
          </Panel>
        ))}
      </div>
    </>
  );
}

function SeniorFlags({ r }: { r: DashSeniorRow }) {
  if (r.s.status !== "active") return <span className="ppd-hint">–</span>;
  const f = [
    !r.ready && <Pill key="r" tone="warn">{r.s.hours ? "No Meet link" : "No times"}</Pill>,
    r.atCap && <Pill key="c" tone="orange">At cap</Pill>,
    r.idle && <Pill key="i" tone="warn">Idle</Pill>,
    r.notSeen && <Pill key="n" tone="muted">Not seen 14d</Pill>,
  ].filter(Boolean);
  return f.length ? <span style={{ display: "inline-flex", flexWrap: "wrap", gap: 4 }}>{f}</span> : <span style={{ color: "var(--good)", fontSize: 12 }}>All good</span>;
}

/** Drawer for one senior: numbers, weekly trend, actions, latest chats. Re-reads live data on every render. */
export function SeniorPanel({ id }: { id: string }) {
  const { data, filters, demo } = useUi();
  const r = useMemo(() => dashSeniorRows(data, { ...filters, campus: "All", seniors: [id] })[0], [data, filters, id]);
  if (!r) return <Empty>This senior is no longer in the list.</Empty>;
  const s = r.s;
  const notes = [!r.ready && "Not ready: needs weekly times and a Meet link.", r.atCap && "At this week's cap.", r.idle && `No chats in the last ${filters.range} days.`, r.notSeen && (r.seenDays === null ? "Never signed in to the portal." : `Not seen for ${r.seenDays} days.`)].filter(Boolean);
  return (
    <>
      <div className="ppd-actions">
        <StatusPill status={s.status} />
        {demo ? (
          <span className="ppd-hint">Actions are off for sample data.</span>
        ) : (
          <>
            <SeniorStatusAction id={s.id} status={s.status} />
            {s.portalPath && <CopyLink path={s.portalPath} />}
            <Link className="ppd-btn" href={`${ttsPath.admin}?s=${s.id}`}>
              Full page
            </Link>
            <Link className="ppd-btn" href={ttsPath.senior(s.id)}>
              Public profile
            </Link>
          </>
        )}
      </div>
      <div className="ppd-dstats">
        <DStat label={`Chats (${filters.range}d)`} value={r.chats} />
        <DStat label="Rating" value={r.rating !== null ? `${r.rating.toFixed(1)}★` : "–"} />
        <DStat label="This week" value={s.weeklyCap ? `${r.thisWeek}/${s.weeklyCap}` : r.thisWeek} />
      </div>
      <div className="ppd-panel" style={{ padding: 14 }}>
        <span className="ppd-hint">Chats per week, last 8 weeks</span>
        <AreaChart width={380} h={170} label="chats" points={r.weekly.map((v, i) => ({ v, label: i === 7 ? "now" : `-${7 - i}w`, title: i === 7 ? "This week" : `${7 - i} weeks ago` }))} />
      </div>
      {(s.topics.length > 0 || s.languages.length > 0) && (
        <div className="ppd-chips">
          {[...s.topics, ...s.languages].map((l) => (
            <span key={l} className="ppd-chip">
              {l}
            </span>
          ))}
        </div>
      )}
      {notes.length > 0 && <div className="ppd-note">{notes.join(" ")}</div>}
      <h4 style={{ margin: "4px 0 0", fontSize: 14, color: "var(--heading)" }}>Latest chats</h4>
      {r.mine.length ? (
        <div className="ppd-dlist">
          {[...r.mine]
            .sort((a, b) => b.start - a.start)
            .slice(0, 12)
            .map((c) => (
              <ChatItem key={c.id} c={c} showSenior={false} />
            ))}
        </div>
      ) : (
        <Empty>No chats yet.</Empty>
      )}
    </>
  );
}

/* ================= Quality ================= */

export function QualityView() {
  const { data, filters, now, openSenior } = useUi();
  const chatDrawer = useChatDrawer();
  const hit = useHit();
  const { all, cur, prev } = useScope();
  const days = `Last ${filters.range} days`;
  const done = cur.filter((c) => isDoneChat(c, now));
  const pdone = prev.filter((c) => isDoneChat(c, now));
  const fb = done.filter((c) => c.rating !== null);
  const pfb = pdone.filter((c) => c.rating !== null);
  const avg = avgRating(fb);
  const pavg = avgRating(pfb);
  const rec = fb.filter((c) => c.recommend);
  const prom = fb.filter((c) => c.promise);
  const flagged = fb.filter(flaggedFeedback);
  if (!fb.length) {
    return (
      <Panel title="Quality">
        <Empty>No feedback in this range{done.length ? `. ${done.length} done chats are waiting for a review.` : "."}</Empty>
      </Panel>
    );
  }
  const trend = weekBuckets(
    all.filter((c) => c.rating !== null),
    now,
    10,
  ).map((w) => ({ v: avgRating(w.list) ?? 0, label: w.label, title: w.title, list: w.list, extra: (<><br /><span className="k">reviews:</span> <b>{w.list.length}</b></>) }));
  const low = lowRated(fb, data.seniors);
  return (
    <>
      <div className="ppd-kpis">
        <Kpi label="Reviews" value={fb.length} prev={pfb.length} onClick={() => chatDrawer(fb, "Reviews", days)} />
        <Kpi label="Feedback rate" value={pct(fb.length, done.length)} prev={pct(pfb.length, pdone.length)} unit="%" />
        <Kpi label="Average rating" value={avg ?? 0} prev={pavg} unit="★" fmt={(v) => v.toFixed(1)} />
        <Kpi label="Would recommend" value={pct(rec.length, fb.length)} prev={pfb.length ? pct(pfb.filter((c) => c.recommend).length, pfb.length) : null} unit="%" tone="good" />
        <Kpi label="Promise reports" value={prom.length} prev={pfb.filter((c) => c.promise).length} invert tone={prom.length ? "warn" : undefined} onClick={() => chatDrawer(prom, "Promise reports", "The applicant says the senior promised something")} />
      </div>
      <div className="ppd-grid ppd-g11">
        <Panel title="Ratings" sub="Click a row to see those chats.">
          <HBars
            rows={[5, 4, 3, 2, 1].map((st) => {
              const l = fb.filter((c) => c.rating === st);
              return {
                label: `${st} ★`,
                v: l.length,
                note: `${pct(l.length, fb.length)}%`,
                color: st <= 2 ? WARN : st === 3 ? "linear-gradient(90deg,#f97d03,#e80074)" : undefined,
                tip: (
                  <>
                    <b>
                      {st} star{st > 1 ? "s" : ""}
                    </b>
                    <br />
                    <b>{l.length}</b> reviews
                  </>
                ),
                onClick: () => chatDrawer(l, `${st}★ reviews`, days),
              };
            })}
          />
        </Panel>
        <Panel title="Average rating per week" sub="Last 10 weeks. Click a week.">
          <AreaChart h={200} label="average ★" color={ORANGE} maxTop={5} steps={5} points={trend} onPoint={(i) => chatDrawer(trend[i].list, trend[i].title, "Rated chats")} />
        </Panel>
      </div>
      <div className="ppd-grid ppd-g11">
        <Panel title="Low-rated seniors" sub="At least 2 reviews and an average of 3.5 or less in this range.">
          {low.length ? (
            <div className="ppd-dlist">
              {low.map((x) => (
                <div key={x.s.id} className="ppd-ditem" style={{ borderColor: "rgb(255 122 110 / .35)" }} {...hit(null, () => openSenior(x.s.id))}>
                  <div className="ppd-av">{x.s.firstName[0]}</div>
                  <div className="m">
                    <b>{x.s.firstName}</b>
                    <small>
                      {x.s.campus} · {x.n} reviews
                    </small>
                  </div>
                  <div className="when" style={{ color: "var(--warn)", fontSize: 15 }}>
                    {x.avg.toFixed(1)}★
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <Empty>Nobody is low-rated.</Empty>
          )}
        </Panel>
        <Panel title="Feedback to read" sub="A reported promise, or a rating of 2 or less. Open a chat to read the note.">
          {flagged.length ? (
            <div className="ppd-dlist">
              {[...flagged]
                .sort((a, b) => b.start - a.start)
                .slice(0, 8)
                .map((c) => (
                  <ChatItem key={c.id} c={c} />
                ))}
            </div>
          ) : (
            <Empty>Nothing flagged.</Empty>
          )}
        </Panel>
      </div>
    </>
  );
}

/* ================= Impact (pp_admin_insights, counts only) ================= */

const MODE_TEXT: Record<string, string> = {
  off: "Booking is closed",
  registered: "Open to VSAT-registered applicants",
  paid: "Open to applicants who paid the VSAT fee",
};
const MEANS: Record<string, string> = {
  "Not registered for VSAT": "They don't have a VSAT application yet. The popup sends them to register.",
  "Slot taken": "Someone else took the time while they were booking. More slots at popular times would help.",
  "Payment pending": "Only in “paid” mode: they registered but haven't paid the VSAT fee.",
  "Not signed in": "They pressed Confirm without signing in.",
  "No email": "No email on their application or login, so the Meet invite can't be sent.",
  "Limit reached": "They already have the most chats allowed.",
  "Too many tries": "Too many booking tries in a short time.",
  "Booking closed": "Booking was switched off when they tried.",
  "System error": "Something failed on our side. Check the logs if this grows.",
  Other: "A broken or out-of-date request, e.g. an old link.",
};

export function ImpactView() {
  const { data, filters, open } = useUi();
  const imp = data.impact[filters.campus];
  const r = impactRange(imp, filters.range);
  const hit = useHit();
  if (!imp || !r) {
    return (
      <Panel title="Impact">
        <Empty>Impact numbers could not be loaded. Please refresh.</Empty>
      </Panel>
    );
  }
  const { demand: d, outcome: o } = r;
  const notBooked = notBookedPeople(d);
  const reasons = blockedReasons(d.blocked);
  const split: [string, number, string][] = [
    ["Paid after the chat", o.paid_after, "linear-gradient(90deg,#f97d03,#e80074)"],
    ["Paid before the chat", o.paid_before, VIOLET],
    ["Not paid yet", o.not_paid, "#2a1f48"],
  ];
  return (
    <>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
        <Pill tone="violet">● {MODE_TEXT[imp.mode] ?? `Mode: ${imp.mode}`}</Pill>
        <span className="ppd-hint">
          Booking tries are kept 90 days. Only signed-in chats count after the chat.
          {filters.seniors.length || filters.type !== "All" ? " The senior and type filters don't apply on this page." : ""}
        </span>
      </div>
      <div className="ppd-kpis">
        <Kpi label="Tried to book" value={d.people} />
        <Kpi label="Booked" value={d.people_booked} tone="good" />
        <Kpi label="Tried but didn't book" value={notBooked} tone={notBooked ? "warn" : undefined} />
        <Kpi label="Paid after the chat" value={o.paid_after} tone="good" />
        <Kpi label="Enrolled" value={o.enrolled} tone="good" />
      </div>
      <div className="ppd-grid ppd-g11">
        <Panel title="Why people were stopped" sub="People per reason. Click one for what it means.">
          {reasons.length ? (
            <HBars
              rows={reasons.map((x) => ({
                label: x.label,
                v: x.people,
                note: `${x.attempts} tries`,
                color: x.label === "System error" ? WARN : x.label === "Other" ? VIOLET : "linear-gradient(90deg,#f97d03,#e80074)",
                tip: (
                  <>
                    <b>{x.label}</b>
                    <br />
                    <b>{x.people}</b> people · {x.attempts} tries
                  </>
                ),
                onClick: () =>
                  open({
                    title: x.label,
                    sub: `${x.people} people · ${x.attempts} tries in the last ${filters.range} days`,
                    body: (
                      <>
                        <div className="ppd-note">{MEANS[x.label] ?? MEANS.Other}</div>
                        <div className="ppd-dstats">
                          <DStat label="People" value={x.people} />
                          <DStat label="Tries" value={x.attempts} />
                          <DStat label="Share of tried" value={`${pct(x.people, d.people)}%`} />
                        </div>
                      </>
                    ),
                  }),
              }))}
            />
          ) : (
            <Empty>Nobody was stopped.</Empty>
          )}
          <p className="ppd-hint">One person can be stopped for more than one reason, so these bars can add up to more than “Tried but didn&apos;t book”.</p>
        </Panel>
        <Panel title="After the chat" sub={`${o.applicants} signed-in applicants had a chat in this range.`}>
          <div className="ppd-split">
            {split.map(([l, v, c]) =>
              v ? (
                <div
                  key={l}
                  style={{ width: `${pct(v, o.applicants)}%`, background: c }}
                  {...hit(
                    <>
                      <b>{l}</b>
                      <br />
                      <b>{v}</b> <span className="k">({pct(v, o.applicants)}%)</span>
                    </>,
                  )}
                />
              ) : null,
            )}
          </div>
          <div className="ppd-legend">
            {split.map(([l, v, c]) => (
              <span key={l}>
                <i style={{ background: c }} />
                {l} <b style={{ color: "var(--heading)" }}>{v}</b> ({pct(v, o.applicants)}%)
              </span>
            ))}
          </div>
          <div className="ppd-dstats">
            <DStat label="Chat → pay, median" value={o.median_days_to_pay === null ? "–" : `${o.median_days_to_pay.toFixed(1)} d`} />
            <DStat label="Chat → enroll, median" value={o.median_days_to_enroll === null ? "–" : `${o.median_days_to_enroll.toFixed(1)} d`} />
            <DStat label="Enrolled after" value={o.enrolled_after} />
          </div>
        </Panel>
      </div>
      <ImpactTrends medianDays={o.median_days_to_pay} />
    </>
  );
}

const MUTED = "#3a2d5c";

/** The "over time" part of Impact (pp_admin_impact_trend, counts only). */
function ImpactTrends({ medianDays }: { medianDays: number | null }) {
  const { data, filters, now, open, W } = useUi();
  const trend = data.trend?.[filters.campus] ?? null;
  const groups = useMemo(() => trendGroups(trend, now, filters.range), [trend, now, filters.range]);
  if (!trend) {
    return (
      <Panel title="Over time">
        <Empty>The trends could not be loaded. Please refresh.</Empty>
      </Panel>
    );
  }
  const per = filters.range === 90 ? "week" : "day";
  // 30 daily bars: label every third one so the dates stay readable
  const shown = groups.map((g, i) => (groups.length > 16 && (groups.length - 1 - i) % 3 ? { ...g, label: "" } : g));
  const total = (k: "tries" | "booked" | "chats" | "paidAfter") => groups.reduce((a, g) => a + g[k], 0);
  const tries = total("tries");
  const booked = total("booked");
  const chats = total("chats");
  const paid = total("paidAfter");
  const bins = payBinsFor(trend, filters.range);
  const binTotal = bins.reduce((a, b) => a + b.v, 0);
  const openGroup = (g: TrendGroup) =>
    open({
      title: g.title,
      sub: per === "week" && g.days < 7 ? `Only ${g.days} of its days are in the last ${filters.range} days.` : undefined,
      body: (
        <>
          <div className="ppd-dstats">
            <DStat label="Booking tries" value={g.tries} />
            <DStat label="Booked" value={`${g.booked} · ${pct(g.booked, g.tries)}%`} />
            <DStat label="Didn't book" value={g.stopped} />
          </div>
          <div className="ppd-dstats">
            <DStat label="First chats" value={g.chats} />
            <DStat label="Paid after" value={`${g.paidAfter} · ${pct(g.paidAfter, g.chats)}%`} />
            <DStat label="Not paid yet" value={g.notPaid} />
          </div>
          <div className="ppd-note">
            Tries are not people: one person can try more than once. First chats count each signed-in applicant once, on the day their first chat in the last 90 days
            ended.
          </div>
        </>
      ),
    });
  return (
    <>
      <Panel
        title="Booking tries over time"
        sub={`${tries} tries, ${booked} booked (${pct(booked, tries)}%) in the last ${filters.range} days. One bar per ${per} (IST). Click a bar.`}
        right={
          <div className="ppd-legend">
            <span><i style={{ background: VIOLET }} />Booked</span>
            <span><i style={{ background: WARN }} />Didn&apos;t book</span>
          </div>
        }
      >
        {tries ? (
          <StackedBars
            groups={shown}
            keys={[
              { key: "booked", label: "Booked", color: VIOLET },
              { key: "stopped", label: "Didn't book", color: WARN },
            ]}
            onBar={openGroup}
            width={W === 640 ? 960 : W}
            label={`Booking tries per ${per}`}
          />
        ) : (
          <Empty>No booking tries in this range.</Empty>
        )}
      </Panel>
      <div className="ppd-grid ppd-g21">
        <Panel
          title="First chats and paying after"
          sub={`${chats} first chats, ${paid} paid after (${pct(paid, chats)}%). Recent chats have had less time to pay.`}
          right={
            <div className="ppd-legend">
              <span><i style={{ background: ORANGE }} />Paid after</span>
              <span><i style={{ background: MUTED }} />Not yet</span>
            </div>
          }
        >
          {chats ? (
            <StackedBars
              groups={shown}
              keys={[
                { key: "paidAfter", label: "Paid after", color: ORANGE },
                { key: "notPaid", label: "Not yet", color: MUTED },
              ]}
              onBar={openGroup}
              label={`First chats per ${per}`}
            />
          ) : (
            <Empty>No first chats in this range.</Empty>
          )}
        </Panel>
        <Panel
          title="Days from chat to paying"
          sub={`People who paid after their first chat in this range. Median ${medianDays === null ? "–" : `${medianDays.toFixed(1)} days`}.`}
        >
          {binTotal ? <Histogram bins={bins} width={W === 640 ? 320 : W} h={220} color={ORANGE} noun="people" /> : <Empty>Nobody paid after a chat in this range yet.</Empty>}
        </Panel>
      </div>
    </>
  );
}


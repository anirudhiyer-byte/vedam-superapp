import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { TtsNav } from "@/components/peerpath/tts-nav";
import { CopyLink, SeniorStatusAction, StatusPill } from "@/components/peerpath/admin/senior-status";
import { EmptyState, yearLabel } from "@/components/peerpath/ui";
import { AdminTabList, AdminTabPanel, AdminTabsProvider, KeepTabLink } from "@/components/peerpath/admin/admin-tabs";
import { IconCalendar, IconCheck, IconFlag, IconInfo, IconStar, IconUsers, IconVideo } from "@/components/peerpath/icons";
import { filterAdminByCampus, parseCampus } from "@/lib/peerpath/admin-filter";
import {
  coverage,
  inviteFailed,
  isCapped,
  isDone,
  isLive,
  isUpcoming,
  IST_BANDS,
  IST_DAYS,
  needsActionCounts,
  needsMarking,
  parseTab,
  qualityStats,
  seniorRows,
  seniorTotals,
  sessionFunnel,
  sessionReality,
  weeklyCounts,
  whenGrid,
  type AdminTab,
  type CoverageItem,
} from "@/lib/peerpath/admin-insights";
import { CAMPUS_INFO, CAMPUSES, ttsPath, type Campus } from "@/lib/peerpath/constants";
import { isAdminUser, loadAdmin } from "@/lib/peerpath/server";
import { fmtDay, fmtTime } from "@/lib/peerpath/slots";
import type { AdminBooking, AdminData, BookingStatus, SeniorPrivate } from "@/lib/peerpath/types";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "PeerPath admin — Talk to a Senior · Vedam", robots: { index: false, follow: false } };

const BOOKING_LABEL: Record<BookingStatus, string> = {
  confirmed: "Booked",
  completed: "Done",
  cancelled: "Cancelled",
  rescheduled: "Moved",
  no_show_applicant: "Applicant no-show",
};
const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const hm = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};

function Stat({ label, value, note, tone = "default" }: { label: string; value: string | number; note?: string; tone?: "default" | "warn" }) {
  return (
    <div className="pp-card flex flex-col gap-1 p-4 sm:p-5">
      <p className="text-[13px] font-medium text-pp-muted">{label}</p>
      <p className={`text-[28px] font-bold leading-tight ${tone === "warn" && Number(value) > 0 ? "text-[#FF7A6E]" : "text-pp-heading"}`}>{value}</p>
      {note && <p className="text-[12px] text-pp-muted">{note}</p>}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="rounded-xl border border-dashed border-pp-line px-4 py-8 text-center text-[14px] text-pp-muted">{text}</p>;
}

/** One item of the "Needs action" strip. Red when there is something to do. */
function ActionItem({ label, value, warn = true }: { label: string; value: number; warn?: boolean }) {
  const hot = warn && value > 0;
  return (
    <div className={`flex items-center gap-2.5 rounded-xl px-3 py-2.5 ${hot ? "bg-[#FF7A6E]/10 ring-1 ring-inset ring-[#FF7A6E]/25" : "bg-pp-soft/60"}`}>
      <span className={`text-[22px] font-bold leading-none tabular-nums ${hot ? "text-[#FF7A6E]" : "text-pp-heading"}`}>{value}</span>
      <span className="text-[13px] leading-tight text-pp-muted">{label}</span>
    </div>
  );
}

type CardStats = { live: number; upcoming: number; done: number };

/** One campus filter card: the page reloads with ?campus=… (All has no query) and keeps the open tab. */
function CampusCard({ href, active, title, sub, image, stats }: { href: string; active: boolean; title: string; sub: string; image?: string; stats: CardStats }) {
  const nums: [string, number][] = [
    ["Live", stats.live],
    ["Upcoming", stats.upcoming],
    ["Done", stats.done],
  ];
  return (
    <KeepTabLink
      href={href}
      current={active}
      className={`pp-card flex min-h-[72px] items-center gap-3 p-3 transition ${active ? "border-pp-violet-500 bg-pp-violet-50" : "hover:border-pp-violet-200"}`}
    >
      {image ? (
        // 40px static thumbnail from /public (same files the finder uses); next/image adds nothing here
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image} alt="" width={40} height={40} className="h-10 w-10 flex-none rounded-lg object-cover" />
      ) : (
        <span aria-hidden className="grid h-10 w-10 flex-none place-items-center rounded-lg bg-pp-violet-100 text-pp-violet-700">
          <IconUsers className="h-5 w-5" />
        </span>
      )}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={`flex items-center gap-1.5 text-[15px] font-semibold ${active ? "text-pp-violet-700" : "text-pp-heading"}`}>
          {title}
          {active && <IconCheck className="h-4 w-4" />}
        </span>
        <span className="truncate text-[12px] text-pp-muted">{sub}</span>
      </span>
      <dl className="flex flex-none gap-3 text-right">
        {nums.map(([label, n]) => (
          <div key={label}>
            <dt className="text-[10px] uppercase tracking-wide text-pp-muted">{label}</dt>
            <dd className="text-[16px] font-bold leading-tight text-pp-heading">{n}</dd>
          </div>
        ))}
      </dl>
    </KeepTabLink>
  );
}

function seniorStats(d: AdminData, s: SeniorPrivate, now: number) {
  const mine = d.bookings.filter((b) => b.seniorId === s.id);
  const ratings = mine.map((b) => d.feedback[b.id]?.rating).filter((r): r is number => typeof r === "number");
  return {
    upcoming: mine.filter((b) => isUpcoming(b, now)).length,
    done: mine.filter((b) => isDone(b, now)).length,
    noShows: mine.filter((b) => b.status === "no_show_applicant").length,
    rating: ratings.length ? (ratings.reduce((a, r) => a + r, 0) / ratings.length).toFixed(1) : null,
    ratingCount: ratings.length,
    hasTimes: (d.rules[s.id] ?? []).length > 0,
  };
}

function BookingTable({ d, rows }: { d: AdminData; rows: AdminBooking[] }) {
  const name = (id: string) => d.seniors.find((s) => s.id === id);
  return (
    <div className="pp-card overflow-x-auto">
      <table className="w-full min-w-[820px] text-left text-[14px]">
        <thead className="border-b border-pp-line text-[12px] uppercase tracking-wide text-pp-muted">
          <tr>
            <th className="px-4 py-3 font-semibold">When</th>
            <th className="px-4 py-3 font-semibold">Senior</th>
            <th className="px-4 py-3 font-semibold">Applicant</th>
            <th className="px-4 py-3 font-semibold">Type</th>
            <th className="px-4 py-3 font-semibold">Status</th>
            <th className="px-4 py-3 font-semibold">Feedback</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-pp-line">
          {rows.map((b) => {
            const s = name(b.seniorId);
            const f = d.feedback[b.id];
            return (
              <tr key={b.id} className="align-top">
                <td className="px-4 py-3 whitespace-nowrap">
                  <Link href={ttsPath.booked(b.id)} className="hover:text-pp-violet-700">
                    {fmtDay(b.start)}, {fmtTime(b.start)}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  {s ? (
                    <Link href={`${ttsPath.admin}?s=${s.id}`} className="hover:text-pp-violet-700">
                      {s.firstName} <span className="text-pp-muted">· {s.campus}</span>
                    </Link>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-4 py-3">
                  <p>{b.name}</p>
                  <p className="text-[12px] text-pp-muted">
                    {b.email} · {b.phone ?? "—"}
                  </p>
                  {b.question && <p className="mt-1 max-w-[320px] text-[12px] text-pp-muted">“{b.question}”</p>}
                </td>
                <td className="px-4 py-3">{b.type}</td>
                <td className="px-4 py-3">
                  {BOOKING_LABEL[b.status]}
                  {b.autoResult === "completed" && b.status === "completed" && <p className="text-[12px] text-pp-muted">auto, from Meet</p>}
                  {needsMarking(b) && (
                    <p className="text-[12px] font-semibold text-[#FF7A6E]">Needs marking</p>
                  )}
                  {inviteFailed(b) && (
                    <p className="text-[12px] text-[#FF7A6E]" title={b.meetError ?? undefined}>Invite not sent yet</p>
                  )}
                </td>
                <td className="px-4 py-3">
                  {f ? (
                    <span className={f.promiseMade || f.rating <= 2 ? "font-semibold text-[#FF7A6E]" : ""}>
                      {f.rating}★{f.promiseMade ? " · promise" : ""}
                    </span>
                  ) : (
                    <span className="text-pp-muted">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SeniorDetail({ d, s, now }: { d: AdminData; s: SeniorPrivate; now: number }) {
  const st = seniorStats(d, s, now);
  const rules = d.rules[s.id] ?? [];
  const blocks = d.blocks[s.id] ?? [];
  const set = d.settings[s.id];
  const rows = d.bookings.filter((b) => b.seniorId === s.id);
  return (
    <section className="flex flex-col gap-4">
      <Link href={ttsPath.admin} className="text-[14px] font-semibold text-pp-violet-600 hover:text-pp-violet-700">
        ← All seniors
      </Link>
      <div className="pp-card flex flex-col gap-5 p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-[24px] font-bold text-pp-heading">{s.firstName}</h2>
              <StatusPill status={s.status} />
            </div>
            <p className="text-[14px] text-pp-muted">
              {yearLabel(s.year)} · {s.campus} · {s.contactEmail}
            </p>
            <p className="text-[13px] text-pp-muted">
              Joined {fmtDay(s.createdAt)} · Last active {s.lastActiveAt ? fmtDay(s.lastActiveAt) : "never"}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {s.token && <CopyLink path={ttsPath.portal(s.token)} />}
            {s.status === "active" && (
              <Link href={ttsPath.senior(s.id)} className="pp-btn-secondary min-h-[36px] px-3 text-[13px]">
                Public profile
              </Link>
            )}
            <SeniorStatusAction id={s.id} status={s.status} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Stat label="Upcoming" value={st.upcoming} />
          <Stat label="Done" value={st.done} />
          <Stat label="No-shows" value={st.noShows} tone="warn" />
          <Stat label="Rating" value={st.rating ?? "–"} note={st.ratingCount ? `${st.ratingCount} review${st.ratingCount === 1 ? "" : "s"}` : undefined} />
          <Stat label="Meet link" value={s.meetLink ? "Set" : "Missing"} tone={s.meetLink ? "default" : "warn"} />
        </div>
        {s.bio && <p className="whitespace-pre-line text-[15px] text-pp-ink">{s.bio}</p>}
        <div className="grid gap-5 md:grid-cols-3">
          <div>
            <h3 className="pp-eyebrow mb-2">Weekly times (IST)</h3>
            {rules.length ? (
              <ul className="flex flex-col gap-1 text-[14px]">
                {rules.map((r, i) => (
                  <li key={i}>
                    {DAY[r.weekday]} {hm(r.from)}–{hm(r.to)} <span className="text-pp-muted">· {r.type}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[14px] text-[#FF7A6E]">No times set</p>
            )}
          </div>
          <div>
            <h3 className="pp-eyebrow mb-2">Days off</h3>
            {blocks.length ? (
              <ul className="flex flex-col gap-1 text-[14px]">
                {blocks.map((b, i) => (
                  <li key={i}>
                    {b.from === b.to ? b.from : `${b.from} → ${b.to}`}
                    {b.reason ? <span className="text-pp-muted"> · {b.reason}</span> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[14px] text-pp-muted">None</p>
            )}
          </div>
          <div>
            <h3 className="pp-eyebrow mb-2">Limits</h3>
            {set && (
              <p className="text-[14px]">
                {set.dailyCap}/day · {set.weeklyCap}/week · {set.minNoticeHours}h notice{set.paused ? " · paused by senior" : ""}
              </p>
            )}
          </div>
        </div>
      </div>
      <h3 className="text-[17px] font-semibold text-pp-heading">Chats</h3>
      {rows.length ? <BookingTable d={d} rows={rows} /> : <Empty text="No chats yet." />}
    </section>
  );
}

/* ===================== Insights tabs (2A-2 / 2A-3) =====================
   Only senior first names appear here: no applicant name, email, phone or question. */

const pct = (n: number, of: number) => (of > 0 ? Math.round((n / of) * 100) : 0);
const fmtHours = (h: number) => `${Number.isInteger(h) ? h : h.toFixed(1)}h`;
const fmtLead = (h: number | null) => (h === null ? "–" : h < 48 ? `${Math.round(h)}h` : `${(h / 24).toFixed(1)} days`);
function ago(iso: string | null, now: number) {
  if (!iso) return "never";
  const days = Math.floor((now - new Date(iso).getTime()) / 86_400_000);
  return days <= 0 ? "today" : days === 1 ? "yesterday" : `${days}d ago`;
}

/** Big number card with an icon chip and a soft glow; tone colours the number. */
function Kpi({ label, value, sub, icon, tone = "default" }: { label: string; value: string | number; sub?: string; icon?: ReactNode; tone?: "default" | "warn" | "good" }) {
  const color = tone === "warn" ? "text-[#FF7A6E]" : tone === "good" ? "text-[#4ADE80]" : "text-pp-heading";
  return (
    <div className="pp-card relative flex flex-col gap-1.5 overflow-hidden p-4 sm:p-5">
      <span aria-hidden className="pointer-events-none absolute -right-10 -top-10 h-28 w-28 rounded-full bg-pp-violet-500/15 blur-2xl" />
      <div className="flex items-center gap-2">
        {icon && <span className="grid h-7 w-7 place-items-center rounded-lg bg-pp-violet-100 text-pp-violet-700">{icon}</span>}
        <p className="text-[13px] font-medium text-pp-muted">{label}</p>
      </div>
      <p className={`text-[30px] font-bold leading-tight tracking-tight ${color}`}>{value}</p>
      {sub && <p className="text-[12px] text-pp-muted">{sub}</p>}
    </div>
  );
}

/** A titled card section. */
function Panel({ title, sub, right, children, className = "" }: { title: string; sub?: string; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`pp-card flex min-w-0 flex-col gap-5 p-5 sm:p-6 ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[17px] font-semibold text-pp-heading">{title}</h2>
          {sub && <p className="mt-0.5 text-[13px] text-pp-muted">{sub}</p>}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

/** Horizontal bar; the number is always shown as text too. */
function HBar({ label, value, max, note, tone = "violet", labelClass = "w-[84px] sm:w-[104px]" }: { label: ReactNode; value: number; max: number; note?: string; tone?: "violet" | "warn" | "orange"; labelClass?: string }) {
  const w = max > 0 ? Math.max(value > 0 ? 3 : 0, (value / max) * 100) : 0;
  const fill = tone === "warn" ? "bg-[#FF7A6E]" : tone === "orange" ? "bg-gradient-to-r from-pp-orange-500 to-[#E80074]" : "bg-gradient-to-r from-pp-violet-500 to-pp-violet-600";
  return (
    <div className="flex items-center gap-3">
      <span className={`flex-none text-[13px] text-pp-muted ${labelClass}`}>{label}</span>
      <span className="relative h-2.5 flex-1 overflow-hidden rounded-full bg-pp-soft">
        <span className={`ppa-bar-x absolute inset-y-0 left-0 rounded-full ${fill}`} style={{ width: `${w}%` }} />
      </span>
      <span className="w-[64px] flex-none text-right text-[13px] font-semibold tabular-nums text-pp-heading">
        {value}
        {note && <span className="ml-1 font-normal text-pp-muted">{note}</span>}
      </span>
    </div>
  );
}

/** Progress ring (SVG). value 0–100 or null. */
function Ring({ value, id, label, size = 112 }: { value: number | null; id: string; label: string; size?: number }) {
  const r = 42;
  const c = 2 * Math.PI * r;
  const v = value ?? 0;
  return (
    <div className="relative grid flex-none place-items-center" style={{ width: size, height: size }} role="img" aria-label={`${label}: ${value === null ? "no data" : `${value}%`}`}>
      <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="rgb(145 82 255)" />
            <stop offset="100%" stopColor="rgb(249 125 3)" />
          </linearGradient>
        </defs>
        <circle cx="50" cy="50" r={r} fill="none" stroke="rgb(28 19 52)" strokeWidth="10" />
        {value !== null && v > 0 && <circle cx="50" cy="50" r={r} fill="none" stroke={`url(#${id})`} strokeWidth="10" strokeLinecap="round" strokeDasharray={`${(c * v) / 100} ${c}`} />}
      </svg>
      <span className="absolute text-[22px] font-bold text-pp-heading">{value === null ? "–" : `${value}%`}</span>
    </div>
  );
}

function SoftEmpty({ text }: { text: string }) {
  return <p className="rounded-xl border border-dashed border-pp-line px-4 py-6 text-center text-[14px] text-pp-muted">{text}</p>;
}

function SessionsTab({ v, now }: { v: AdminData; now: number }) {
  const f = sessionFunnel(v, now);
  const weeks = weeklyCounts(v, now);
  const r = sessionReality(v, now);
  const w = whenGrid(v);
  const maxWeek = Math.max(1, ...weeks.map((x) => x.count));
  const maxCell = Math.max(1, ...w.grid.flat());
  const stages: [string, number, string][] = [
    ["Booked", f.booked, "Every chat booked (a moved chat counts once)"],
    ["Done", f.done, "Completed, or confirmed and already over"],
    ["Feedback", f.feedback, "Done chats with feedback from the applicant"],
  ];
  return (
    <>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <Panel title="From booking to feedback" sub="Share of booked chats that reached each step.">
          {f.booked === 0 ? (
            <SoftEmpty text="No chats booked yet." />
          ) : (
            <ol className="flex flex-col gap-3">
              {stages.map(([name, n, hint], i) => {
                const p = pct(n, f.booked);
                return (
                  <li key={name} className="flex flex-col gap-1.5">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-[14px] font-semibold text-pp-heading" title={hint}>
                        {name}
                      </span>
                      <span className="text-[13px] tabular-nums text-pp-muted">
                        <b className="text-[18px] text-pp-heading">{n}</b> · {p}%
                        {i > 1 && stages[i - 1][1] > 0 && <span className="ml-2 hidden text-pp-violet-700 sm:inline">{pct(n, stages[i - 1][1])}% of {stages[i - 1][0].toLowerCase()}</span>}
                      </span>
                    </div>
                    <span className="relative h-9 overflow-hidden rounded-xl bg-pp-soft">
                      <span
                        className="ppa-bar-x absolute inset-y-0 left-0 rounded-xl bg-gradient-to-r from-pp-violet-500 via-pp-violet-600 to-[#c084fc]"
                        style={{ width: `${Math.max(n > 0 ? 4 : 0, p)}%`, opacity: 1 - i * 0.18, animationDelay: `${i * 90}ms` }}
                      />
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
          <ul className="flex flex-wrap gap-2 text-[13px]">
            {(
              [
                ["Upcoming", f.upcoming, false],
                ["Cancelled", f.cancelled, false],
                ["No-show", f.noShow, f.noShow > 0],
                ["Moved", f.moved, false],
              ] as [string, number, boolean][]
            ).map(([k, n, warn]) => (
              <li key={k} className={`rounded-full border px-3 py-1 ${warn ? "border-[#FF7A6E]/40 text-[#FF7A6E]" : "border-pp-line text-pp-muted"}`}>
                {k} <b className={warn ? "" : "text-pp-heading"}>{n}</b>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="Chats per week" sub="Last 8 weeks, Monday to Sunday (IST). Cancelled and moved chats left out.">
          <div className="flex min-h-[188px] flex-1 items-end gap-1.5 sm:gap-2.5" role="list" aria-label="Chats per week">
            {weeks.map((x, i) => {
              const last = i === weeks.length - 1;
              return (
                <div key={x.start} role="listitem" className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1.5" aria-label={`Week of ${x.label}: ${x.count}`}>
                  <span className={`text-[12px] font-semibold tabular-nums ${x.count ? "text-pp-heading" : "text-pp-muted"}`}>{x.count}</span>
                  <span className="relative flex w-full flex-1 items-end overflow-hidden rounded-lg bg-pp-soft/60">
                    <span
                      className={`ppa-bar-y w-full rounded-lg ${last ? "bg-gradient-to-t from-pp-orange-500 to-[#E80074]" : "bg-gradient-to-t from-pp-violet-500 to-pp-violet-600"}`}
                      style={{ height: `${x.count ? Math.max(6, (x.count / maxWeek) * 100) : 0}%`, animationDelay: `${i * 45}ms` }}
                    />
                  </span>
                  <span className={`truncate text-[10px] sm:text-[11px] ${last ? "font-semibold text-pp-orange-700" : "text-pp-muted"}`}>{last ? "This wk" : x.label}</span>
                </div>
              );
            })}
          </div>
        </Panel>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <Panel title="What Meet saw" sub="Done chats that have Meet attendance data.">
          {r.checked === 0 ? (
            <SoftEmpty text="No Meet attendance data yet." />
          ) : (
            <div className="flex flex-wrap items-center gap-6">
              <Ring value={r.autoPct} id="ring-auto" label="Completed automatically" />
              <dl className="grid flex-1 grid-cols-2 gap-4">
                <div>
                  <dt className="text-[12px] text-pp-muted">Completed automatically</dt>
                  <dd className="text-[20px] font-bold text-pp-heading">
                    {r.autoCompleted}
                    <span className="text-[13px] font-normal text-pp-muted"> of {r.checked}</span>
                  </dd>
                </div>
                <div>
                  <dt className="text-[12px] text-pp-muted">Median time together</dt>
                  <dd className="text-[20px] font-bold text-pp-heading">{r.medianMinutes === null ? "–" : `${Math.round(r.medianMinutes)} min`}</dd>
                </div>
              </dl>
            </div>
          )}
          <div className="mt-auto grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-pp-soft px-4 py-3">
              <p className="text-[12px] text-pp-muted">To mark</p>
              <p className={`text-[22px] font-bold ${r.toMark ? "text-[#FF7A6E]" : "text-pp-heading"}`}>{r.toMark}</p>
            </div>
            <div className="rounded-xl bg-pp-soft px-4 py-3">
              <p className="text-[12px] text-pp-muted">Invite failed</p>
              <p className={`text-[22px] font-bold ${r.inviteFailed ? "text-[#FF7A6E]" : "text-pp-heading"}`}>{r.inviteFailed}</p>
            </div>
          </div>
        </Panel>

        <Panel
          title="When chats happen"
          sub="Day and time (IST). Cancelled and moved chats left out."
          right={
            <div className="rounded-xl bg-pp-soft px-3 py-2 text-right">
              <p className="text-[11px] text-pp-muted">Booking → chat (median)</p>
              <p className="text-[16px] font-bold text-pp-heading">{fmtLead(w.medianLeadHours)}</p>
            </div>
          }
        >
          {w.total === 0 ? (
            <SoftEmpty text="No chats to show yet." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[300px] table-fixed border-separate border-spacing-1 text-[12px]">
                <thead>
                  <tr>
                    <th className="w-10 sm:w-12" />
                    {IST_BANDS.map((b) => (
                      <th key={b} scope="col" className="pb-1 font-medium text-pp-muted">
                        {b}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {IST_DAYS.map((day, di) => (
                    <tr key={day}>
                      <th scope="row" className="pr-1 text-left font-medium text-pp-muted">
                        {day}
                      </th>
                      {w.grid[di].map((n, bi) => (
                        <td
                          key={bi}
                          className={`h-9 rounded-lg text-center font-semibold tabular-nums ${n ? "text-white" : "text-pp-muted/60"}`}
                          style={{ backgroundColor: n ? `rgba(118, 41, 252, ${0.22 + 0.78 * (n / maxCell)})` : "rgb(28 19 52)" }}
                        >
                          {n}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-3 flex items-center justify-end gap-2 text-[11px] text-pp-muted">
                Fewer
                {[0.22, 0.48, 0.74, 1].map((a) => (
                  <span key={a} className="h-3 w-5 rounded" style={{ backgroundColor: `rgba(118, 41, 252, ${a})` }} />
                ))}
                More
              </div>
            </div>
          )}
        </Panel>
      </div>
    </>
  );
}

function Badge({ children, tone }: { children: ReactNode; tone: "warn" | "orange" | "muted" }) {
  const cls = tone === "warn" ? "bg-[#FF7A6E]/12 text-[#FF7A6E] ring-[#FF7A6E]/30" : tone === "orange" ? "bg-pp-orange-50 text-pp-orange-700 ring-pp-orange-500/30" : "bg-pp-soft text-pp-muted ring-pp-line";
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${cls}`}>{children}</span>;
}

function Coverage({ title, items }: { title: string; items: CoverageItem[] }) {
  const thin = items.filter((x) => x.thin).length;
  return (
    <Panel title={title} sub={thin ? `${thin} with fewer than 2 live seniors` : "Every item has at least 2 live seniors"}>
      <ul className="flex flex-wrap gap-2">
        {items.map((x) => (
          <li
            key={x.name}
            className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-[13px] ${x.thin ? "border-[#FF7A6E]/35 bg-[#FF7A6E]/[0.06] text-pp-ink" : "border-pp-violet-200/60 bg-pp-violet-50 text-pp-heading"}`}
          >
            {x.name}
            <span className={`grid h-5 min-w-[20px] place-items-center rounded-full px-1 text-[11px] font-bold ${x.thin ? "bg-[#FF7A6E]/20 text-[#FF7A6E]" : "bg-pp-violet-500 text-white"}`}>{x.seniors}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function SeniorsTab({ v, now }: { v: AdminData; now: number }) {
  const rows = seniorRows(v, now);
  const t = seniorTotals(v, now);
  const cov = coverage(v);
  const maxH = Math.max(1, ...rows.map((r) => r.hours));
  const flagged = rows.filter((r) => r.idle || r.notSeen || r.atCap).length;
  const badges = (r: (typeof rows)[number]) => (
    <>
      {r.atCap && <Badge tone="orange">At weekly cap</Badge>}
      {r.idle && <Badge tone="warn">Idle</Badge>}
      {r.notSeen && <Badge tone="muted">Not seen 14d</Badge>}
    </>
  );
  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Kpi label="Live seniors" value={t.live} icon={<IconUsers className="h-4 w-4" />} />
        <Kpi label="Hours / week" value={fmtHours(t.hours)} sub="Sum of weekly times" icon={<IconCalendar className="h-4 w-4" />} />
        <Kpi label="Chats / week" value={t.avgChatsPerWeek} sub="Average, last 4 weeks" icon={<IconVideo className="h-4 w-4" />} />
        <Kpi label="Need a look" value={flagged} sub="Idle, not seen or at cap" tone={flagged ? "warn" : "default"} icon={<IconFlag className="h-4 w-4" />} />
      </div>

      <Panel title="Live seniors" sub="Chats in the last 30 days, all-time done and no-shows, feedback from applicants.">
        {rows.length === 0 ? (
          <SoftEmpty text="No live seniors yet." />
        ) : (
          <>
            <ul className="flex flex-col gap-3 md:hidden">
              {rows.map((r) => (
                <li key={r.id} className="rounded-xl border border-pp-line bg-pp-soft/40 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <Link href={`${ttsPath.admin}?s=${r.id}`} className="flex items-center gap-3">
                      <span aria-hidden className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-pp-violet-500 to-[#E80074] text-[14px] font-bold text-white">
                        {r.firstName.slice(0, 1)}
                      </span>
                      <span>
                        <span className="block font-semibold text-pp-heading">{r.firstName}</span>
                        <span className="block text-[12px] text-pp-muted">
                          {r.campus} · active {ago(r.lastActiveAt, now)}
                        </span>
                      </span>
                    </Link>
                    <span className="text-right text-[13px] font-semibold text-pp-heading">{r.rating === null ? "–" : `${r.rating}★`}</span>
                  </div>
                  <dl className="mt-3 grid grid-cols-4 gap-2 text-center">
                    {(
                      [
                        ["Hours", fmtHours(r.hours)],
                        ["30d", r.chats30],
                        ["Done", r.done],
                        ["No-show", r.noShows],
                      ] as [string, string | number][]
                    ).map(([k, n]) => (
                      <div key={k} className="rounded-lg bg-pp-card px-1 py-2">
                        <dt className="whitespace-nowrap text-[10px] uppercase text-pp-muted">{k}</dt>
                        <dd className="text-[15px] font-bold text-pp-heading">{n}</dd>
                      </div>
                    ))}
                  </dl>
                  <div className="mt-3 flex flex-wrap gap-1.5">{badges(r)}</div>
                </li>
              ))}
            </ul>

            <div className="-mx-5 hidden overflow-x-auto md:block sm:-mx-6">
              <table className="w-full min-w-[880px] text-left text-[14px]">
                <thead className="border-y border-pp-line text-[11px] uppercase tracking-wide text-pp-muted">
                  <tr>
                    <th className="px-6 py-3 font-semibold">Senior</th>
                    <th className="px-3 py-3 font-semibold">Hours / week</th>
                    <th className="px-3 py-3 text-right font-semibold">Chats 30d</th>
                    <th className="px-3 py-3 text-right font-semibold">Done</th>
                    <th className="px-3 py-3 text-right font-semibold">No-shows</th>
                    <th className="px-3 py-3 text-right font-semibold">Rating</th>
                    <th className="px-3 py-3 text-right font-semibold">Recommend</th>
                    <th className="px-3 py-3 font-semibold">Last active</th>
                    <th className="px-6 py-3 font-semibold">Flags</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-pp-line">
                  {rows.map((r) => (
                    <tr key={r.id} className="transition-colors hover:bg-pp-soft/50">
                      <td className="px-6 py-3">
                        <Link href={`${ttsPath.admin}?s=${r.id}`} className="group flex items-center gap-3">
                          <span aria-hidden className="grid h-8 w-8 flex-none place-items-center rounded-full bg-gradient-to-br from-pp-violet-500 to-[#E80074] text-[13px] font-bold text-white">
                            {r.firstName.slice(0, 1)}
                          </span>
                          <span>
                            <span className="block font-semibold text-pp-heading group-hover:text-pp-violet-700">{r.firstName}</span>
                            <span className="block text-[12px] text-pp-muted">{r.campus}</span>
                          </span>
                        </Link>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2">
                          <span className="relative h-1.5 w-20 overflow-hidden rounded-full bg-pp-soft">
                            <span className="ppa-bar-x absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-pp-violet-500 to-pp-violet-600" style={{ width: `${(r.hours / maxH) * 100}%` }} />
                          </span>
                          <span className={`tabular-nums ${r.hours ? "text-pp-heading" : "text-[#FF7A6E]"}`}>{fmtHours(r.hours)}</span>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">{r.chats30}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{r.done}</td>
                      <td className={`px-3 py-3 text-right tabular-nums ${r.noShows > 1 ? "font-semibold text-[#FF7A6E]" : ""}`}>{r.noShows}</td>
                      <td className="px-3 py-3 text-right tabular-nums">
                        {r.rating === null ? <span className="text-pp-muted">–</span> : `${r.rating}★`}
                        {r.reviews > 0 && <span className="ml-1 text-[12px] text-pp-muted">({r.reviews})</span>}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">{r.recommendPct === null ? <span className="text-pp-muted">–</span> : `${r.recommendPct}%`}</td>
                      <td className="px-3 py-3 text-pp-muted">{ago(r.lastActiveAt, now)}</td>
                      <td className="px-6 py-3">
                        <div className="flex flex-wrap gap-1.5">
                          {badges(r)}
                          {!r.idle && !r.notSeen && !r.atCap && <span className="text-[12px] text-[#4ADE80]">All good</span>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Coverage title="Topics covered" items={cov.topics} />
        <Coverage title="Languages covered" items={cov.languages} />
      </div>
    </>
  );
}

function QualityTab({ v, now }: { v: AdminData; now: number }) {
  const q = qualityStats(v, now);
  const maxDist = Math.max(1, ...q.dist);
  if (q.reviews === 0) {
    return (
      <Panel title="Quality" sub="Ratings and reports from applicants after their chat.">
        <SoftEmpty text={q.done ? `No feedback yet. ${q.done} done chat${q.done === 1 ? "" : "s"} waiting for a review.` : "No feedback yet."} />
      </Panel>
    );
  }
  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Kpi label="Reviews" value={q.reviews} sub={`From ${q.done} done chat${q.done === 1 ? "" : "s"}`} icon={<IconStar className="h-4 w-4" />} />
        <Kpi label="Feedback rate" value={q.feedbackRate === null ? "–" : `${q.feedbackRate}%`} sub="Done chats with feedback" icon={<IconInfo className="h-4 w-4" />} />
        <Kpi label="Average rating" value={q.avgRating === null ? "–" : `${q.avgRating}★`} sub="Out of 5" tone={q.avgRating !== null && q.avgRating <= 3 ? "warn" : "default"} icon={<IconStar className="h-4 w-4" />} />
        <Kpi label="Promise reports" value={q.promises} sub="Applicant says a promise was made" tone={q.promises ? "warn" : "default"} icon={<IconFlag className="h-4 w-4" />} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <Panel title="Ratings" sub="How applicants rated their chat.">
          <div className="flex flex-col gap-3">
            {[5, 4, 3, 2, 1].map((star) => {
              const n = q.dist[star - 1];
              return (
                <HBar
                  key={star}
                  label={
                    <span className="inline-flex items-center gap-1">
                      {star} <IconStar className="h-3.5 w-3.5 text-pp-orange-500" />
                    </span>
                  }
                  value={n}
                  max={maxDist}
                  note={`${pct(n, q.reviews)}%`}
                  tone={star <= 2 ? "warn" : star === 3 ? "orange" : "violet"}
                  labelClass="w-9"
                />
              );
            })}
          </div>
        </Panel>

        <Panel title="Would recommend" sub="Applicants who would recommend their senior.">
          <div className="flex items-center gap-6">
            <Ring value={q.recommendPct} id="ring-recommend" label="Would recommend" size={128} />
            <p className="text-[14px] leading-relaxed text-pp-muted">
              <b className="text-pp-heading">{Math.round(((q.recommendPct ?? 0) / 100) * q.reviews)}</b> of <b className="text-pp-heading">{q.reviews}</b> reviews say yes.
            </p>
          </div>
        </Panel>
      </div>

      <Panel title="Low-rated seniors" sub="At least 2 reviews and an average of 3.0 or less. Worst first.">
        {q.lowRated.length === 0 ? (
          <SoftEmpty text="No low-rated seniors." />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {q.lowRated.map((s) => (
              <li key={s.id}>
                <Link href={`${ttsPath.admin}?s=${s.id}`} className="flex items-center justify-between gap-3 rounded-xl border border-[#FF7A6E]/30 bg-[#FF7A6E]/[0.05] px-4 py-3 transition hover:border-[#FF7A6E]/60">
                  <span className="font-semibold text-pp-heading">{s.firstName}</span>
                  <span className="text-[13px] text-pp-muted">
                    <b className="text-[#FF7A6E]">{s.rating}★</b> · {s.reviews} reviews →
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}

/** One href builder for the admin page; only whitelisted values go in. */
function adminHref(campus: Campus | null, tab: AdminTab) {
  const q = new URLSearchParams();
  if (campus) q.set("campus", campus);
  if (tab !== "overview") q.set("tab", tab);
  const s = q.toString();
  return s ? `${ttsPath.admin}?${s}` : ttsPath.admin;
}

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ s?: string; campus?: string; tab?: string }> }) {
  const { s: focus, campus: campusParam, tab: tabParam } = await searchParams;
  // Both calls start together (one round-trip saved). pp_admin_all checks admin inside the database and returns
  // nothing for anyone else, and the page still shows data only when isAdminUser() is true.
  const [admin, data] = await Promise.all([isAdminUser(), loadAdmin()]);
  const d = admin ? data : null;

  if (!admin || !d) {
    return (
      <>
        <TtsNav label="Admin" />
        <div className="mx-auto max-w-[720px] px-4 py-10 sm:px-6">
          <EmptyState title="Admins only" body={admin ? "Could not load admin data. Please refresh." : "Please sign in with your @vedam.org account to see PeerPath admin."}>
            {!admin && (
              <Link href="/login" className="pp-btn-primary mt-2">
                Sign in
              </Link>
            )}
          </EmptyState>
        </div>
      </>
    );
  }

  const now = Date.now();
  // ?s= (one senior's page) wins: ?campus= is ignored then and the page is the full, unfiltered one.
  const hasFocus = typeof focus === "string" && focus !== "";
  const campus = hasFocus ? null : parseCampus(campusParam);
  const v = filterAdminByCampus(d, campus);
  const done = v.bookings.filter((b) => isDone(b, now)).length;
  const noShows = v.bookings.filter((b) => b.status === "no_show_applicant").length;
  const fb = Object.values(v.feedback);
  const avg = fb.length ? (fb.reduce((a, f) => a + f.rating, 0) / fb.length).toFixed(1) : "–";
  const promise = fb.filter((f) => f.promiseMade).length;
  const active = v.seniors.filter(isLive).length;
  const pending = v.seniors.filter((s) => s.status === "pending");
  const upcoming = v.bookings.filter((b) => isUpcoming(b, now));
  const flags = v.bookings
    .filter((b) => v.feedback[b.id] && (v.feedback[b.id].promiseMade || v.feedback[b.id].rating <= 2))
    .map((b) => ({ b, f: v.feedback[b.id], s: v.seniors.find((x) => x.id === b.seniorId) }));
  const focused = hasFocus ? d.seniors.find((x) => x.id === focus) : undefined;
  const total = done + noShows;
  const na = needsActionCounts(v, now);
  // card numbers always come from the unfiltered data, so they stay the same when you switch campus
  const cardStats = (c: Campus | null): CardStats => {
    const x = filterAdminByCampus(d, c);
    return { live: x.seniors.filter(isLive).length, upcoming: x.bookings.filter((b) => isUpcoming(b, now)).length, done: x.bookings.filter((b) => isDone(b, now)).length };
  };

  const tab: AdminTab = hasFocus ? "overview" : parseTab(tabParam);
  const actionTotal = na.waitingApproval + na.notReady + na.toMark + na.inviteFailed;

  const overviewStats = (
    <section aria-label="Overview" className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-6">
      <Stat label="Upcoming chats" value={upcoming.length} />
      <Stat label="Chats done" value={done} />
      <Stat label="No-show rate" value={total ? `${Math.round((noShows / total) * 100)}%` : "–"} note={`${noShows} no-shows`} />
      <Stat label="Average rating" value={avg} note={fb.length ? `${fb.length} review${fb.length === 1 ? "" : "s"}` : undefined} />
      <Stat label="Promise flags" value={promise} note="From feedback" tone="warn" />
      <Stat label="Live seniors" value={active} note={pending.length ? `${pending.length} waiting for approval` : undefined} />
    </section>
  );

  const overviewLists = (
    <>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-8 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <section className="flex min-w-0 flex-col gap-3">
          <h2 className="text-[19px] font-semibold text-pp-heading">Seniors</h2>
          {v.seniors.length === 0 ? (
            <Empty text={campus ? `No seniors at ${campus} yet.` : "No seniors yet. Share the “Become a senior” page with current students."} />
          ) : (
            <div className="pp-card overflow-x-auto">
              <table className="w-full min-w-[820px] text-left text-[14px]">
                <thead className="border-b border-pp-line text-[12px] uppercase tracking-wide text-pp-muted">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Senior</th>
                    <th className="px-4 py-3 font-semibold">Status</th>
                    <th className="px-4 py-3 font-semibold">Upcoming</th>
                    <th className="px-4 py-3 font-semibold">Done</th>
                    <th className="px-4 py-3 font-semibold">Rating</th>
                    <th className="px-4 py-3 font-semibold">No-shows</th>
                    <th className="px-4 py-3 font-semibold">Setup</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-pp-line">
                  {v.seniors.map((s) => {
                    const st = seniorStats(v, s, now);
                    return (
                      <tr key={s.id}>
                        <td className="px-4 py-3">
                          <Link href={`${ttsPath.admin}?s=${s.id}`} className="font-semibold text-pp-heading hover:text-pp-violet-700">
                            {s.firstName}
                          </Link>
                          <p className="text-[12px] text-pp-muted">
                            {s.campus} · {yearLabel(s.year)}
                          </p>
                        </td>
                        <td className="px-4 py-3"><StatusPill status={s.status} /></td>
                        <td className="px-4 py-3">{st.upcoming}</td>
                        <td className="px-4 py-3">{st.done}</td>
                        <td className="px-4 py-3">{st.rating ? `${st.rating} (${st.ratingCount})` : "–"}</td>
                        <td className={`px-4 py-3 ${st.noShows > 1 ? "font-semibold text-[#FF7A6E]" : ""}`}>{st.noShows}</td>
                        <td className="px-4 py-3 text-[12px]">
                          <span className={st.hasTimes ? "text-[#4ADE80]" : "text-[#FF7A6E]"}>{st.hasTimes ? "Times ✓" : "No times"}</span>
                          <br />
                          <span className={s.meetLink ? "text-[#4ADE80]" : "text-[#FF7A6E]"}>{s.meetLink ? "Meet ✓" : "No Meet link"}</span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-2">
                            {s.token && <CopyLink path={ttsPath.portal(s.token)} />}
                            <SeniorStatusAction id={s.id} status={s.status} />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="flex min-w-0 flex-col gap-3">
          <h2 className="flex items-center gap-2 text-[19px] font-semibold text-pp-heading">
            <IconFlag className="h-5 w-5 text-[#FF7A6E]" /> Needs a look
          </h2>
          <p className="-mt-1 text-[13px] text-pp-muted">Feedback with a reported promise or a rating of 2 or less.</p>
          {flags.length === 0 ? (
            <Empty text="Nothing flagged." />
          ) : (
            <ul className="flex flex-col gap-3">
              {flags.map(({ b, f, s }) => (
                <li key={b.id} className="pp-card p-4">
                  <p className="text-[14px] font-semibold text-pp-heading">
                    {s?.firstName ?? "Senior"} ↔ {b.name}
                  </p>
                  <p className="text-[12px] text-pp-muted">
                    {fmtDay(b.start)}, {fmtTime(b.start)} · {f.rating}★{f.promiseMade ? " · promise reported" : ""} · {b.email}
                  </p>
                  {f.note && <p className="mt-2 text-[14px] text-pp-ink">{f.note}</p>}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-[19px] font-semibold text-pp-heading">Recent chats</h2>
        {v.bookings.length === 0 ? <Empty text="No chats booked yet." /> : <BookingTable d={v} rows={v.bookings.slice(0, 40)} />}
      </section>
    </>
  );

  return (
    <>
      <TtsNav label="Admin" />
      <AdminTabsProvider initial={tab}>
        <div className="mx-auto flex max-w-[1240px] flex-col gap-8 px-4 py-6 sm:px-6 lg:py-10">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-[28px] font-bold text-pp-heading">Talk to a Senior: admin</h1>
              <p className="text-[16px] text-pp-muted">Sessions, quality and safety at a glance. Live from the database.</p>
              {campus && <p className="mt-1 text-[14px] font-semibold text-pp-violet-700">Showing: {campus}</p>}
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href={ttsPath.home} className="pp-btn-secondary">Applicant view</Link>
              <Link href={ttsPath.join} className="pp-btn-primary">Add a senior</Link>
            </div>
          </div>

          <nav aria-label="Filter by campus" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <CampusCard href={adminHref(null, "overview")} active={campus === null} title="All" sub="All campuses" stats={cardStats(null)} />
            {CAMPUSES.map((c) => (
              <CampusCard key={c} href={adminHref(c, "overview")} active={campus === c} title={c} sub={CAMPUS_INFO[c].university} image={CAMPUS_INFO[c].image} stats={cardStats(c)} />
            ))}
          </nav>

          {hasFocus ? (
            // one senior's page: no tabs and no new sections
            <>
              {overviewStats}
              {focused ? <SeniorDetail d={d} s={focused} now={now} /> : overviewLists}
            </>
          ) : (
            <>
              <div className="flex flex-col gap-3">
                <AdminTabList
                  label="Admin sections"
                  items={[
                    { id: "overview", label: "Overview", href: adminHref(campus, "overview"), icon: <IconInfo className="h-4 w-4" />, badge: actionTotal },
                    { id: "sessions", label: "Sessions", href: adminHref(campus, "sessions"), icon: <IconVideo className="h-4 w-4" /> },
                    { id: "seniors", label: "Seniors", href: adminHref(campus, "seniors"), icon: <IconUsers className="h-4 w-4" /> },
                    { id: "quality", label: "Quality", href: adminHref(campus, "quality"), icon: <IconStar className="h-4 w-4" /> },
                  ]}
                />
                {isCapped(d) && <p className="text-[13px] text-pp-muted">Based on the latest 2,000 chats.</p>}
              </div>

              <AdminTabPanel id="overview">
                <section aria-label="Needs action" className="pp-card flex flex-col gap-4 p-4 sm:p-5">
                  <div className="flex items-center justify-between gap-3">
                    <h2 className="text-[15px] font-semibold text-pp-heading">Needs action</h2>
                    {actionTotal === 0 ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-[#0f2e1c] px-2.5 py-1 text-[12px] font-semibold text-[#4ADE80]">
                        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-[#4ADE80]" /> All clear
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-[#FF7A6E]/10 px-2.5 py-1 text-[12px] font-semibold text-[#FF7A6E]">
                        <span aria-hidden className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#FF7A6E]" /> {actionTotal} to do
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                    <ActionItem label="waiting for approval" value={na.waitingApproval} />
                    <ActionItem label="live but not ready" value={na.notReady} />
                    <ActionItem label="to mark" value={na.toMark} />
                    <ActionItem label="invite failed" value={na.inviteFailed} />
                    <ActionItem label="chats in next 24h" value={na.next24h} warn={false} />
                  </div>
                </section>
                {overviewStats}
                {overviewLists}
              </AdminTabPanel>
              <AdminTabPanel id="sessions">
                <SessionsTab v={v} now={now} />
              </AdminTabPanel>
              <AdminTabPanel id="seniors">
                <SeniorsTab v={v} now={now} />
              </AdminTabPanel>
              <AdminTabPanel id="quality">
                <QualityTab v={v} now={now} />
              </AdminTabPanel>
            </>
          )}
        </div>
      </AdminTabsProvider>
    </>
  );
}

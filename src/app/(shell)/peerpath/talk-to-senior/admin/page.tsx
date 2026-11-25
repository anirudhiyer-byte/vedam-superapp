import type { Metadata } from "next";
import Link from "next/link";
import { TtsNav } from "@/components/peerpath/tts-nav";
import { AdminDashboard } from "@/components/peerpath/admin/dashboard/dashboard";
import { CopyLink, SeniorStatusAction, StatusPill } from "@/components/peerpath/admin/senior-status";
import { EmptyState, yearLabel } from "@/components/peerpath/ui";
import { parseCampusKey, parseRange, toDashboardData } from "@/lib/peerpath/admin-dashboard";
import { allowDemo, demoAdminData, demoInsights, demoTrend } from "@/lib/peerpath/admin-demo"; // SAMPLE DATA (remove before production)
import { inviteFailed, isDone, isUpcoming, needsMarking, parseTab } from "@/lib/peerpath/admin-insights";
import { ttsPath } from "@/lib/peerpath/constants";
import { isAdminUser, loadAdmin, loadAdminInsights, loadImpactTrend } from "@/lib/peerpath/server";
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
      <Link href={`${ttsPath.admin}?tab=seniors`} className="text-[14px] font-semibold text-pp-violet-600 hover:text-pp-violet-700">
        ← Back to the dashboard
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

type Search = { s?: string; campus?: string; tab?: string; days?: string; demo?: string };

export default async function AdminPage({ searchParams }: { searchParams: Promise<Search> }) {
  const { s: focus, campus, tab, days, demo: demoParam } = await searchParams;
  const hasFocus = typeof focus === "string" && focus !== "";
  // SAMPLE DATA (remove before production): ?demo=1 shows made-up data, never on production.
  const demo = demoParam === "1" && !hasFocus && allowDemo(process.env.VERCEL_ENV);
  // All calls start together. pp_admin_all, pp_admin_insights and pp_admin_impact_trend check admin inside the
  // database and return nothing for anyone else; the page still shows data only when isAdminUser() is true.
  const skipInsights = hasFocus || demo;
  const [admin, data, insAll, insPune, insGurugram, trAll, trPune, trGurugram] = await Promise.all([
    isAdminUser(),
    demo ? Promise.resolve(null) : loadAdmin(),
    skipInsights ? Promise.resolve(null) : loadAdminInsights(null),
    skipInsights ? Promise.resolve(null) : loadAdminInsights("Pune"),
    skipInsights ? Promise.resolve(null) : loadAdminInsights("Gurugram"),
    skipInsights ? Promise.resolve(null) : loadImpactTrend(null),
    skipInsights ? Promise.resolve(null) : loadImpactTrend("Pune"),
    skipInsights ? Promise.resolve(null) : loadImpactTrend("Gurugram"),
  ]);
  const now = Date.now();
  const d = admin ? (demo ? demoAdminData(now) : data) : null;

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

  if (hasFocus) {
    // one senior's full page (contact email, weekly times, days off, limits, every chat with applicant details)
    const focused = d.seniors.find((x) => x.id === focus);
    return (
      <>
        <TtsNav label="Admin" />
        <div className="mx-auto flex max-w-[1240px] flex-col gap-8 px-4 py-6 sm:px-6 lg:py-10">
          {focused ? (
            <SeniorDetail d={d} s={focused} now={now} />
          ) : (
            <EmptyState title="Senior not found" body="This senior may have been removed.">
              <Link href={ttsPath.admin} className="pp-btn-primary mt-2">
                Back to the dashboard
              </Link>
            </EmptyState>
          )}
        </div>
      </>
    );
  }

  // The browser gets counts, times, statuses and senior first names only: no applicant names, emails,
  // phones, questions or feedback notes (toDashboardData copies whitelisted fields).
  const ins = demo ? demoInsights() : { All: insAll, Pune: insPune, Gurugram: insGurugram };
  const trend = demo ? demoTrend(now) : { All: trAll, Pune: trPune, Gurugram: trGurugram }; // SAMPLE DATA branch: remove "demo ? demoTrend(now) :" before production
  const dash = toDashboardData(d, now, ins, demo, trend);
  return <AdminDashboard data={dash} initialView={parseTab(tab)} initialFilters={{ range: parseRange(days), campus: parseCampusKey(campus) }} />;
}

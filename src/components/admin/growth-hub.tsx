"use client";

import Link from "next/link";

/**
 * Growth — the marketing/growth analytics module hub, surfaced under Admin.
 *
 * Every module we've built so far is listed here. Only the ones with `live: true`
 * are navigable right now (Events + Code Sprint go live first); the rest render as
 * disabled "Coming soon" cards until they're wired in.
 *
 * To take a module live later: build its prototype into `public/growth/<key>.html`,
 * add a route at `src/app/(admin)/admin/growth/<key>/page.tsx` (mirror events/codesprint),
 * then flip `live: true` + set `href` below.
 */

type Mod = {
  key: string;
  label: string;
  desc: string;
  href?: string;
  live?: boolean;
  icon: string; // inline <path> markup
};

const I = {
  season: '<path d="M3 3v18h18"/><path d="M7 15l4-5 3 3 5-7"/>',
  cohort: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 4v16"/>',
  vsat: '<path d="M22 3L2 11l6 2 2 6 4-5 5 4z"/>',
  call: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2 4.2 2 2 0 0 1 4 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.6a16 16 0 0 0 6 6l1.1-1.1a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.7.7A2 2 0 0 1 22 16.9z"/>',
  infl: '<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3 3-5 6-5s6 2 6 5"/><path d="M16 5a3 3 0 0 1 0 6"/>',
  tele: '<path d="M22 3L2 11l6 2 2 6 4-5 5 4z"/>',
  cons: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  pred: '<circle cx="12" cy="12" r="9"/><path d="M15 9l-2 5-4 1 2-5z"/>',
  sprint: '<path d="M9 8l-5 4 5 4M15 8l5 4-5 4"/>',
  event: '<rect x="3" y="4.5" width="18" height="16.5" rx="2.5"/><path d="M3 9.5h18M8 3v3M16 3v3"/>',
};

const GROUPS: { title: string; mods: Mod[] }[] = [
  {
    title: "Overview",
    mods: [
      { key: "season", label: "Season Dashboard", desc: "Leads · paid · enrolments for the active admissions season.", icon: I.season },
      { key: "cohort", label: "Payment Cohort", desc: "Day-wise payment cohort matrix and conversion.", icon: I.cohort },
      { key: "vsat", label: "VSAT Campaign Report", desc: "Campaign-level VSAT registration performance.", icon: I.vsat },
    ],
  },
  {
    title: "Operations",
    mods: [
      { key: "calling", label: "Calling Log", desc: "Tele-calling activity and outcome tracker.", icon: I.call },
    ],
  },
  {
    title: "Marketing Channels",
    mods: [
      { key: "influencers", label: "Influencers", desc: "Influencer listing + performance across creators.", icon: I.infl },
      { key: "telegram", label: "Telegram Channel", desc: "Telegram listing + performance.", icon: I.tele },
      { key: "consultants", label: "Consultants Channel", desc: "Consultant listing + performance.", icon: I.cons },
      { key: "predictor", label: "College Predictor", desc: "Cost & CPL + UTM listing and dashboards.", icon: I.pred },
      { key: "codesprint", label: "Code Sprint", desc: "Cost & CPL + UTM listing and dashboards.", icon: I.sprint, live: true, href: "/admin/growth/codesprint" },
      { key: "events", label: "Events", desc: "Events listing + performance.", icon: I.event, live: true, href: "/admin/growth/events" },
    ],
  },
];

function Svg({ inner }: { inner: string }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{ __html: inner }} />
  );
}

function Card({ m }: { m: Mod }) {
  const inner = (
    <>
      <div className="flex items-start justify-between gap-3">
        <span className={["grid h-10 w-10 place-items-center rounded-xl", m.live ? "bg-brand-gradient text-white" : "bg-surface-warm text-muted"].join(" ")}>
          <Svg inner={m.icon} />
        </span>
        {m.live ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-wide text-emerald-300">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Live
          </span>
        ) : (
          <span className="rounded-full border border-white/15 px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-wide text-muted">Coming soon</span>
        )}
      </div>
      <h3 className="mt-4 font-display text-base font-bold text-heading">{m.label}</h3>
      <p className="mt-1 font-body text-sm text-muted">{m.desc}</p>
      {m.live && <span className="mt-3 inline-block font-mono text-xs text-accent">open →</span>}
    </>
  );

  if (m.live && m.href) {
    return (
      <Link href={m.href} className="group rounded-2xl border border-border bg-surface p-5 transition-all hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-[0_12px_40px_-12px_rgba(138,24,255,0.45)]">
        {inner}
      </Link>
    );
  }
  return (
    <div className="cursor-not-allowed rounded-2xl border border-border bg-surface p-5 opacity-60" title="Coming soon">
      {inner}
    </div>
  );
}

export function GrowthHub() {
  const total = GROUPS.reduce((s, g) => s + g.mods.length, 0);
  const live = GROUPS.reduce((s, g) => s + g.mods.filter((m) => m.live).length, 0);

  return (
    <div className="relative overflow-hidden">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10"
        style={{ background: "radial-gradient(680px 420px at 88% -8%, var(--glow-violet), transparent 60%), radial-gradient(520px 400px at -5% 100%, var(--glow-orange), transparent 60%)" }} />

      <div className="mx-auto max-w-6xl px-6 py-12">
        <Link href="/admin" className="font-mono text-xs text-accent hover:underline">← Admin overview</Link>
        <span className="mt-4 inline-flex items-center gap-2 font-mono text-xs font-semibold lowercase tracking-[0.12em] text-accent">
          <span className="h-1.5 w-1.5 rounded-full bg-primary" style={{ boxShadow: "0 0 0 3px rgba(249,125,3,.22)" }} />// growth
        </span>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-4xl font-extrabold tracking-tight text-heading">Growth</h1>
            <p className="mt-2 max-w-xl font-body text-sm text-muted">Marketing &amp; admissions growth dashboards. {live} live · {total - live} rolling out.</p>
          </div>
          <span className="rounded-xl border border-border bg-surface px-4 py-2 font-mono text-xs text-muted">{live}/{total} modules live</span>
        </div>

        {GROUPS.map((g) => (
          <section key={g.title} className="mt-9">
            <h2 className="mb-3 font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">{g.title}</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {g.mods.map((m) => <Card key={m.key} m={m} />)}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

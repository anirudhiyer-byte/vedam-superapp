"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

type Stat = { id: string; event_code: string; name: string; category: string | null; status: string; starts_at: string | null; featured: boolean; registered: number; viewers: number; dropoff: number };
const istDay = (s: string) => new Date(s).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const fmtDate = (s: string | null) => s ? new Date(s).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" }) : "—";

export function AdminHome() {
  const [supabase] = useState(() => createClient());
  const [stats, setStats] = useState<Stat[]>([]);
  const [trend, setTrend] = useState<[string, number][]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.rpc("event_manage_stats");
      setStats((data as Stat[]) ?? []);
      const since = new Date(Date.now() - 13 * 864e5).toISOString().slice(0, 10);
      const { data: regs } = await supabase.from("event_registrations").select("created_at").gte("created_at", since + "T00:00:00Z");
      const m = new Map<string, number>();
      for (let i = 13; i >= 0; i--) m.set(istDay(new Date(Date.now() - i * 864e5).toISOString()), 0);
      (regs ?? []).forEach((r) => { const d = istDay(r.created_at as string); if (m.has(d)) m.set(d, (m.get(d) || 0) + 1); });
      setTrend(Array.from(m.entries()));
      setLoading(false);
    })();
  }, [supabase]);

  const now = Date.now();
  const kpis = useMemo(() => ({
    events: stats.length,
    upcoming: stats.filter((e) => e.status !== "draft" && (!e.starts_at || new Date(e.starts_at).getTime() >= now)).length,
    registered: stats.reduce((s, e) => s + Number(e.registered), 0),
    dropoff: stats.reduce((s, e) => s + Number(e.dropoff), 0),
  }), [stats, now]);
  const recent = stats.slice(0, 5);
  const trendMax = Math.max(1, ...trend.map(([, v]) => v));
  const trendTotal = trend.reduce((s, [, v]) => s + v, 0);

  return (
    <div className="relative overflow-hidden">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10"
        style={{ background: "radial-gradient(680px 420px at 88% -8%, var(--glow-violet), transparent 60%), radial-gradient(520px 400px at -5% 100%, var(--glow-orange), transparent 60%)" }} />
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 opacity-50"
        style={{ backgroundImage: "radial-gradient(var(--dot) 1px, transparent 1.4px)", backgroundSize: "26px 26px", WebkitMaskImage: "radial-gradient(circle at 82% 12%, #000, transparent 62%)", maskImage: "radial-gradient(circle at 82% 12%, #000, transparent 62%)" }} />

      <div className="mx-auto max-w-6xl px-6 py-12">
        <span className="inline-flex items-center gap-2 font-mono text-xs font-semibold lowercase tracking-[0.12em] text-accent">
          <span className="h-1.5 w-1.5 rounded-full bg-primary" style={{ boxShadow: "0 0 0 3px rgba(249,125,3,.22)" }} />// command center
        </span>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
          <h1 className="font-display text-4xl font-extrabold tracking-tight text-heading">Welcome back.</h1>
          <div className="flex flex-wrap gap-2">
            <Link href="/admin/events/new" className="rounded-xl bg-brand-gradient px-5 py-2.5 text-sm font-semibold text-white">+ New event</Link>
            <Link href="/admin/analytics" className="rounded-xl border border-border-strong px-5 py-2.5 text-sm font-semibold text-foreground hover:bg-surface-warm">Analytics</Link>
            <Link href="/admin/faqs" className="rounded-xl border border-border-strong px-5 py-2.5 text-sm font-semibold text-foreground hover:bg-surface-warm">FAQs</Link>
            <Link href="/admin/comms" className="rounded-xl border border-border-strong px-5 py-2.5 text-sm font-semibold text-foreground hover:bg-surface-warm">Comms hub</Link>
            <Link href="/admin/dropoffs" className="rounded-xl border border-border-strong px-5 py-2.5 text-sm font-semibold text-foreground hover:bg-surface-warm">Drop-offs</Link>
            <Link href="/admin/automations" className="rounded-xl border border-border-strong px-5 py-2.5 text-sm font-semibold text-foreground hover:bg-surface-warm">Automations</Link>
          </div>
        </div>

        {/* KPIs */}
        <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi label="Total events" value={kpis.events} loading={loading} />
          <Kpi label="Upcoming" value={kpis.upcoming} loading={loading} />
          <Kpi label="Total registrations" value={kpis.registered} accent loading={loading} />
          <Kpi label="Drop-off" value={kpis.dropoff} loading={loading} />
        </div>

        <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_320px] lg:items-start">
          {/* recent events */}
          <div className="rounded-2xl border border-border bg-surface p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-display text-base font-bold text-heading">Recent events</h2>
              <Link href="/admin/events" className="font-mono text-xs text-accent hover:underline">manage all →</Link>
            </div>
            {loading ? (
              <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-14 animate-pulse rounded-xl bg-surface-warm" />)}</div>
            ) : recent.length === 0 ? (
              <p className="py-6 text-center font-body text-sm text-muted">No events yet. <Link href="/admin/events/new" className="font-semibold text-accent">Create your first →</Link></p>
            ) : (
              <div className="divide-y divide-border">
                {recent.map((e) => (
                  <Link key={e.id} href={`/admin/events/${e.id}`} className="flex items-center gap-3 py-3 transition-colors hover:bg-surface-warm/40">
                    <span className={e.featured ? "text-primary" : "text-muted/30"}>{e.featured ? "★" : "☆"}</span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-display text-sm font-bold text-heading">{e.name}</div>
                      <div className="font-mono text-[11px] text-muted">{fmtDate(e.starts_at)} · {e.status}</div>
                    </div>
                    <div className="flex gap-4 font-mono text-xs">
                      <span className="text-primary">{e.registered} reg</span>
                      <span className="hidden text-muted sm:inline">{e.dropoff} drop</span>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* 14-day trend */}
          <div className="rounded-2xl border border-border bg-surface p-5">
            <div className="flex items-baseline justify-between">
              <h2 className="font-display text-base font-bold text-heading">Last 14 days</h2>
              <span className="font-mono text-xs text-muted">{trendTotal} regs</span>
            </div>
            <div className="mt-4 flex h-32 items-end gap-1">
              {trend.map(([d, v]) => (
                <div key={d} className="flex flex-1 flex-col items-center gap-1" title={`${d}: ${v}`}>
                  <div className="w-full rounded-t bg-brand-gradient" style={{ height: `${(v / trendMax) * 100}px`, minHeight: v ? 3 : 0 }} />
                </div>
              ))}
            </div>
            <div className="mt-2 flex justify-between font-mono text-[10px] text-muted">
              <span>{trend.length ? fmtDate(trend[0][0]) : ""}</span><span>{trend.length ? fmtDate(trend[trend.length - 1][0]) : ""}</span>
            </div>
            <Link href="/admin/analytics" className="mt-4 block rounded-xl bg-surface-warm px-4 py-2.5 text-center font-body text-sm font-semibold text-heading hover:opacity-90">Open analytics →</Link>
          </div>
        </div>
      </div>
    </div>
  );
}

function Kpi({ label, value, accent, loading }: { label: string; value: number; accent?: boolean; loading?: boolean }) {
  return (
    <div className={["rounded-2xl border border-border p-4", accent ? "bg-brand-gradient text-white" : "bg-surface"].join(" ")}>
      <div className={["font-mono text-[10px] font-semibold uppercase tracking-wide", accent ? "text-white/80" : "text-muted"].join(" ")}>{label}</div>
      <div className={["mt-1 font-display text-2xl font-extrabold", accent ? "text-white" : "text-heading"].join(" ")}>{loading ? "—" : value.toLocaleString("en-IN")}</div>
    </div>
  );
}

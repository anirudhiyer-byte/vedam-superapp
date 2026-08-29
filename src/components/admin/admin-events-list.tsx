"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

type Stat = {
  id: string; event_code: string; name: string; category: string | null; status: string;
  starts_at: string | null; featured: boolean; registered: number; viewers: number; dropoff: number;
};

const fmtDate = (s: string | null) => s ? new Date(s).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" }) : "—";

export function AdminEventsList() {
  const [supabase] = useState(() => createClient());
  const [rows, setRows] = useState<Stat[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"all" | "upcoming" | "past" | "draft">("all");
  const [copied, setCopied] = useState<string | null>(null);

  async function load() {
    const { data } = await supabase.rpc("event_manage_stats");
    setRows((data as Stat[]) ?? []);
    setLoading(false);
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const now = Date.now();
  const filtered = useMemo(() => rows.filter((e) => {
    if (tab === "draft") return e.status === "draft";
    if (tab === "upcoming") return e.status !== "draft" && (!e.starts_at || new Date(e.starts_at).getTime() >= now);
    if (tab === "past") return e.status !== "draft" && e.starts_at && new Date(e.starts_at).getTime() < now;
    return true;
  }), [rows, tab, now]);

  const totals = useMemo(() => {
    const registered = rows.reduce((s, e) => s + Number(e.registered), 0);
    const viewers = rows.reduce((s, e) => s + Number(e.viewers), 0);
    return { events: rows.length, registered, viewers, dropoff: rows.reduce((s, e) => s + Number(e.dropoff), 0),
      rate: viewers ? Math.round((registered / viewers) * 100) : null };
  }, [rows]);

  async function toggleFeatured(e: Stat) {
    await supabase.from("events").update({ featured: !e.featured }).eq("id", e.id);
    setRows((rs) => rs.map((r) => r.id === e.id ? { ...r, featured: !r.featured } : r).sort((a, b) => Number(b.featured) - Number(a.featured)));
  }
  async function toggleStatus(e: Stat) {
    const next = e.status === "open" ? "draft" : "open";
    await supabase.from("events").update({ status: next }).eq("id", e.id);
    setRows((rs) => rs.map((r) => r.id === e.id ? { ...r, status: next } : r));
  }
  async function remove(e: Stat) {
    if (!confirm(`Delete "${e.name}"? This removes its registrations too.`)) return;
    await supabase.from("events").delete().eq("id", e.id);
    setRows((rs) => rs.filter((r) => r.id !== e.id));
  }
  function copyLink(e: Stat) {
    navigator.clipboard.writeText(`${window.location.origin}/events/${e.event_code}`).then(() => {
      setCopied(e.id); setTimeout(() => setCopied(null), 1500);
    });
  }

  const chip = "rounded-lg px-3.5 py-2 font-mono text-xs font-semibold transition-colors";

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <span className="font-mono text-xs font-semibold lowercase tracking-[0.12em] text-accent">// manage</span>
          <h1 className="mt-2 font-display text-3xl font-extrabold tracking-tight text-heading">Events</h1>
          <p className="mt-1 font-body text-sm text-muted">Every event, its funnel, and quick actions — all in one place.</p>
        </div>
        <Link href="/admin/events/new" className="rounded-xl bg-brand-gradient px-5 py-2.5 text-sm font-semibold text-white">+ New event</Link>
      </div>

      {/* summary */}
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Events" value={totals.events} />
        <Kpi label="Total registered" value={totals.registered} accent />
        <Kpi label="Reg. rate (registered / viewers)" text={totals.rate == null ? "—" : `${totals.rate}%`} />
        <Kpi label="Drop-off (viewed, didn't register)" value={totals.dropoff} />
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {(["all", "upcoming", "past", "draft"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={[chip, tab === t ? "bg-brand-gradient text-white" : "border border-border-strong bg-surface text-muted hover:text-foreground"].join(" ")}>
            {t}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-20 animate-pulse rounded-2xl border border-border bg-surface" />)}</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border-strong bg-surface p-10 text-center">
          <p className="font-display text-lg font-bold text-heading">Nothing here yet</p>
          <p className="mt-1 font-body text-sm text-muted">{tab === "all" ? "Create your first event to get started." : `No ${tab} events.`}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((e) => (
            <div key={e.id} className="rounded-2xl border border-border bg-surface p-4 transition-shadow hover:shadow-[0_18px_40px_-24px_rgba(43,19,92,0.35)]">
              <div className="flex flex-wrap items-start gap-4">
                <button onClick={() => toggleFeatured(e)} title={e.featured ? "Unfeature" : "Feature (show first)"}
                  className={["mt-0.5 text-lg leading-none transition-transform hover:scale-110", e.featured ? "text-primary" : "text-muted/40"].join(" ")}>
                  {e.featured ? "★" : "☆"}
                </button>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/admin/events/${e.id}`} className="truncate font-display text-base font-bold text-heading hover:text-accent">{e.name}</Link>
                    {e.category && <span className="rounded-full bg-surface-warm px-2 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wide text-accent">{e.category}</span>}
                    <span className={["rounded-full px-2 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wide", e.status === "open" ? "bg-brand-gradient text-white" : "bg-surface-warm text-muted"].join(" ")}>{e.status}</span>
                  </div>
                  <div className="mt-1 font-mono text-xs text-muted">{e.event_code} · {fmtDate(e.starts_at)}</div>

                  {/* funnel stats */}
                  <div className="mt-3 flex flex-wrap gap-4">
                    <Stat3 k="Registered" v={e.registered} strong />
                    <Stat3 k="Viewers" v={e.viewers} />
                    <Stat3 k="Drop-off" v={e.dropoff} />
                    <Stat3text k="Reg. rate" v={Number(e.viewers) ? `${Math.round((Number(e.registered) / Number(e.viewers)) * 100)}%` : "—"} />
                  </div>
                </div>

                {/* actions */}
                <div className="flex shrink-0 flex-wrap gap-2">
                  <button onClick={() => copyLink(e)} className="rounded-md border border-border px-2.5 py-1.5 font-mono text-xs text-muted hover:text-foreground">{copied === e.id ? "copied ✓" : "🔗 link"}</button>
                  <button onClick={() => toggleStatus(e)} className="rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-muted hover:text-foreground">{e.status === "open" ? "Unpublish" : "Publish"}</button>
                  <Link href={`/admin/events/${e.id}`} className="rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-surface-warm">Edit</Link>
                  <button onClick={() => remove(e)} className="rounded-md border border-red-400/40 px-2.5 py-1.5 text-xs font-medium text-red-500 hover:bg-red-500/5">Delete</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Kpi({ label, value, text, accent }: { label: string; value?: number; text?: string; accent?: boolean }) {
  return (
    <div className={["rounded-2xl border border-border p-4", accent ? "bg-brand-gradient text-white" : "bg-surface"].join(" ")}>
      <div className={["font-mono text-[10px] font-semibold uppercase tracking-wide", accent ? "text-white/80" : "text-muted"].join(" ")}>{label}</div>
      <div className={["mt-1 font-display text-2xl font-extrabold", accent ? "text-white" : "text-heading"].join(" ")}>{text ?? (value ?? 0).toLocaleString("en-IN")}</div>
    </div>
  );
}
function Stat3text({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <div className="font-mono text-[10px] uppercase tracking-wide text-muted">{k}</div>
      <div className="font-display text-lg font-bold text-accent">{v}</div>
    </div>
  );
}
function Stat3({ k, v, strong }: { k: string; v: number; strong?: boolean }) {
  return (
    <div>
      <div className="font-mono text-[10px] uppercase tracking-wide text-muted">{k}</div>
      <div className={["font-display text-lg font-bold", strong ? "text-primary" : "text-heading"].join(" ")}>{Number(v).toLocaleString("en-IN")}</div>
    </div>
  );
}

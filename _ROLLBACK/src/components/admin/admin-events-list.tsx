"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

type Stat = {
  id: string; event_code: string; name: string; category: string | null; status: string;
  starts_at: string | null; featured: boolean; capacity: number | null;
  registered: number; viewers: number; dropoff: number;
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
    setRows((data as Stat[]) ?? []); setLoading(false);
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
    return { events: rows.length, registered, dropoff: rows.reduce((s, e) => s + Number(e.dropoff), 0), rate: viewers ? Math.round((registered / viewers) * 100) : null };
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
    navigator.clipboard.writeText(`${window.location.origin}/events/${e.event_code}`).then(() => { setCopied(e.id); setTimeout(() => setCopied(null), 1500); });
  }

  const chip = "rounded-lg px-3.5 py-2 font-mono text-xs font-semibold transition-colors";
  const iconBtn = "grid h-8 w-8 place-items-center rounded-lg border border-border text-muted transition-colors hover:bg-surface-warm hover:text-foreground";

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <span className="font-mono text-xs font-semibold lowercase tracking-[0.12em] text-accent">// manage</span>
          <h1 className="mt-2 font-display text-3xl font-extrabold tracking-tight text-heading">Events</h1>
          <p className="mt-1 font-body text-sm text-muted">Live registration health across every event.</p>
        </div>
        <Link href="/admin/events/new" className="rounded-xl bg-brand-gradient px-5 py-2.5 text-sm font-semibold text-white">+ New event</Link>
      </div>

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Active events" value={totals.events} />
        <Kpi label="Total registrations" value={totals.registered} accent />
        <Kpi label="Reg. rate (registered / viewers)" text={totals.rate == null ? "—" : `${totals.rate}%`} />
        <Kpi label="Drop-off (viewed, didn't register)" value={totals.dropoff} />
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {(["all", "upcoming", "past", "draft"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={[chip, tab === t ? "bg-brand-gradient text-white" : "border border-border-strong bg-surface text-muted hover:text-foreground"].join(" ")}>{t}</button>
        ))}
      </div>

      {loading ? (
        <div className="h-64 animate-pulse rounded-2xl border border-border bg-surface" />
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border-strong bg-surface p-10 text-center">
          <p className="font-display text-lg font-bold text-heading">Nothing here yet</p>
          <p className="mt-1 font-body text-sm text-muted">{tab === "all" ? "Create your first event to get started." : `No ${tab} events.`}</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border bg-surface">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-border">
                {["", "Event", "Category", "Date", "Registered", "Drop-off", "Event ID", ""].map((h, i) => (
                  <th key={i} className="whitespace-nowrap px-3 py-3 font-mono text-[10px] font-semibold uppercase tracking-wider text-muted">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => {
                const pct = e.capacity && e.capacity > 0 ? Math.min(100, Math.round((Number(e.registered) / e.capacity) * 100)) : null;
                return (
                  <tr key={e.id} className="border-b border-border last:border-0 hover:bg-surface-warm/30">
                    <td className="px-3 py-3">
                      <button onClick={() => toggleFeatured(e)} title={e.featured ? "Unfeature" : "Feature"} className={["text-base leading-none transition-transform hover:scale-110", e.featured ? "text-primary" : "text-muted/30"].join(" ")}>{e.featured ? "★" : "☆"}</button>
                    </td>
                    <td className="max-w-[240px] px-3 py-3">
                      <Link href={`/admin/events/${e.id}`} className="block truncate font-display font-bold text-heading hover:text-accent">{e.name}</Link>
                      <button onClick={() => toggleStatus(e)} className={["mt-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide", e.status === "open" ? "text-accent" : "text-muted"].join(" ")}>{e.status === "open" ? "● published" : "○ draft"}</button>
                    </td>
                    <td className="px-3 py-3">{e.category ? <span className="whitespace-nowrap rounded-full bg-brand-gradient px-2.5 py-1 font-mono text-[9px] font-bold uppercase tracking-wide text-white">{e.category}</span> : <span className="text-muted">—</span>}</td>
                    <td className="whitespace-nowrap px-3 py-3 font-mono text-xs text-muted">{fmtDate(e.starts_at)}</td>
                    <td className="min-w-[130px] px-3 py-3">
                      <div className="font-display text-sm font-bold text-heading">{Number(e.registered).toLocaleString("en-IN")}{e.capacity ? <span className="font-mono text-xs font-normal text-muted">/{e.capacity.toLocaleString("en-IN")}</span> : null}</div>
                      {pct != null && <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-surface-warm"><div className="h-full rounded-full bg-brand-gradient" style={{ width: `${pct}%` }} /></div>}
                    </td>
                    <td className="px-3 py-3 font-display text-sm font-bold text-[#E80074]">{Number(e.dropoff).toLocaleString("en-IN")}</td>
                    <td className="whitespace-nowrap px-3 py-3 font-mono text-[11px] text-muted">{e.event_code}</td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-1.5">
                        <button onClick={() => copyLink(e)} title="Copy deep link" className={iconBtn}>{copied === e.id ? "✓" : "🔗"}</button>
                        <Link href={`/admin/events/${e.id}`} title="Edit" className={iconBtn}>✎</Link>
                        <button onClick={() => remove(e)} title="Delete" className="grid h-8 w-8 place-items-center rounded-lg border border-red-400/40 text-red-500 transition-colors hover:bg-red-500/5">🗑</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Kpi({ label, value, text, accent }: { label: string; value?: number; text?: string; accent?: boolean }) {
  return (
    <div className={["rounded-2xl border border-border p-4", accent ? "bg-brand-gradient text-white" : "bg-surface"].join(" ")}>
      <div className={["font-display text-3xl font-extrabold", accent ? "text-white" : "text-heading"].join(" ")}>{text ?? (value ?? 0).toLocaleString("en-IN")}</div>
      <div className={["mt-1 font-body text-xs", accent ? "text-white/80" : "text-muted"].join(" ")}>{label}</div>
    </div>
  );
}

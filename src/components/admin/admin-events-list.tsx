"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { EventRow } from "@/lib/events";
import { eventDateLabel } from "@/lib/events";

type Row = EventRow & { reg_count?: number };

export function AdminEventsList() {
  const [supabase] = useState(() => createClient());
  const [events, setEvents] = useState<Row[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  async function load() {
    const { data } = await supabase.from("events").select("*").order("created_at", { ascending: false });
    if (data) {
      setEvents(data as Row[]);
      const { data: regs } = await supabase.from("event_registrations").select("event_code");
      if (regs) {
        const c: Record<string, number> = {};
        regs.forEach((r) => { c[r.event_code] = (c[r.event_code] || 0) + 1; });
        setCounts(c);
      }
    }
    setLoading(false);
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  async function remove(e: Row) {
    if (!confirm(`Delete "${e.name}"? This removes its registrations too.`)) return;
    await supabase.from("events").delete().eq("id", e.id);
    load();
  }
  async function toggleStatus(e: Row) {
    const next = e.status === "open" ? "draft" : "open";
    await supabase.from("events").update({ status: next }).eq("id", e.id);
    load();
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-heading">Events</h1>
          <p className="mt-1 font-body text-sm text-muted">Host and manage every Vedam event.</p>
        </div>
        <Link href="/admin/events/new" className="rounded-xl bg-brand-gradient px-5 py-2.5 text-sm font-semibold text-white">+ New event</Link>
      </div>

      {loading ? (
        <div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-16 animate-pulse rounded-xl border border-border bg-surface" />)}</div>
      ) : events.length === 0 ? (
        <p className="font-body text-sm text-muted">No events yet. Create your first one.</p>
      ) : (
        <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
          {events.map((e) => (
            <div key={e.id} className="flex items-center gap-4 p-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Link href={`/admin/events/${e.id}`} className="truncate font-display text-sm font-semibold text-heading hover:text-accent">{e.name}</Link>
                  <span className={[
                    "rounded-full px-2 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wide",
                    e.status === "open" ? "bg-brand-gradient text-white" : "bg-surface-warm text-muted",
                  ].join(" ")}>{e.status}</span>
                </div>
                <p className="mt-0.5 truncate font-body text-xs text-muted">
                  {e.event_code} · {eventDateLabel(e)} · {counts[e.event_code] || 0} registered
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <button onClick={() => toggleStatus(e)} className="rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-muted hover:text-foreground">
                  {e.status === "open" ? "Unpublish" : "Publish"}
                </button>
                <Link href={`/admin/events/${e.id}`} className="rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-surface-warm">Edit</Link>
                <button onClick={() => remove(e)} className="rounded-md border border-red-400/40 px-2.5 py-1.5 text-xs font-medium text-red-500 hover:bg-red-500/5">Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

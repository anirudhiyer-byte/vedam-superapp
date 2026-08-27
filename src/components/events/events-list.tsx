"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { EventRow } from "@/lib/events";
import { EventCard } from "@/components/events/event-card";

export function EventsList() {
  const [supabase] = useState(() => createClient());
  const [events, setEvents] = useState<EventRow[]>([]);
  const [regs, setRegs] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");

  useEffect(() => {
    let active = true;
    (async () => {
      const { data } = await supabase
        .from("events").select("*").neq("status", "draft").order("starts_at", { ascending: true });
      if (active && data) setEvents(data as EventRow[]);

      const { data: u } = await supabase.auth.getUser();
      if (u.user) {
        const { data: r } = await supabase.from("event_registrations").select("event_code").eq("user_id", u.user.id);
        if (active && r) setRegs(Object.fromEntries(r.map((x) => [x.event_code, true])));
      }
      if (active) setLoading(false);
    })();
    return () => { active = false; };
  }, [supabase]);

  const filtered = useMemo(() => {
    const terms = q.toLowerCase().split(/[,;\n]/).map((t) => t.trim()).filter(Boolean);
    if (!terms.length) return events;
    return events.filter((e) => {
      const hay = `${e.name} ${e.host ?? ""} ${e.category ?? ""} ${e.blurb ?? ""}`.toLowerCase();
      return terms.some((t) => hay.includes(t));
    });
  }, [events, q]);

  return (
    <div className="mx-auto max-w-6xl px-6 py-10 sm:px-10 lg:px-16">
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight text-heading">Events</h1>
          <p className="mt-1 font-body text-sm text-muted">Workshops, webinars, and meetups across the Vedam ecosystem.</p>
        </div>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search events…"
          className="w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-foreground outline-none focus:border-[color:rgb(var(--accent))] sm:w-64"
        />
      </div>

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => <div key={i} className="h-72 animate-pulse rounded-2xl border border-border bg-surface" />)}
        </div>
      ) : filtered.length === 0 ? (
        <p className="font-body text-sm text-muted">No events{q ? " match your search" : " yet — check back soon"}.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((e) => <EventCard key={e.id} event={e} registered={regs[e.event_code]} />)}
        </div>
      )}
    </div>
  );
}

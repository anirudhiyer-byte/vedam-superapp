"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { EventRow } from "@/lib/events";
import { eventDateLabel, eventTimeLabel, isOffline, pointsTotalPossible } from "@/lib/events";
import { EventCard } from "@/components/events/event-card";
import Link from "next/link";

export function EventsList() {
  const [supabase] = useState(() => createClient());
  const [events, setEvents] = useState<EventRow[]>([]);
  const [regs, setRegs] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("All");
  const [view, setView] = useState<"upcoming" | "past" | "featured">("upcoming");

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

  const categories = useMemo(
    () => ["All", ...Array.from(new Set(events.map((e) => e.category).filter(Boolean) as string[]))],
    [events]
  );

  const now = Date.now();
  const filtered = useMemo(() => {
    const terms = q.toLowerCase().split(/[,;\n]/).map((t) => t.trim()).filter(Boolean);
    return events.filter((e) => {
      const t = e.starts_at ? new Date(e.starts_at).getTime() : null;
      if (view === "past" && !(t != null && t < now)) return false;
      if (view === "upcoming" && !(t == null || t >= now)) return false;
      if (view === "featured" && !e.featured) return false;
      if (cat !== "All" && e.category !== cat) return false;
      if (!terms.length) return true;
      const hay = `${e.name} ${e.host ?? ""} ${e.category ?? ""} ${e.blurb ?? ""}`.toLowerCase();
      return terms.some((t2) => hay.includes(t2));
    });
  }, [events, q, cat, view, now]);

  // featured hero only makes sense in the upcoming view
  const featured = view === "upcoming" ? (filtered.find((e) => e.featured) || filtered[0]) : undefined;
  const rest = featured ? filtered.filter((e) => e !== featured) : filtered;

  return (
    <div className="relative overflow-hidden">
      {/* ambient brand glows + dotted grid, matching the landing language */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10"
        style={{ background: "radial-gradient(680px 420px at 85% -5%, var(--glow-violet), transparent 60%), radial-gradient(520px 400px at -5% 100%, var(--glow-orange), transparent 60%)" }} />
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 opacity-60"
        style={{ backgroundImage: "radial-gradient(var(--dot) 1px, transparent 1.4px)", backgroundSize: "26px 26px", WebkitMaskImage: "radial-gradient(circle at 80% 15%, #000, transparent 65%)", maskImage: "radial-gradient(circle at 80% 15%, #000, transparent 65%)" }} />

      <div className="mx-auto max-w-6xl px-6 py-12 sm:px-10 lg:px-16">
        <span className="inline-flex items-center gap-2 font-mono text-xs font-semibold lowercase tracking-[0.12em] text-accent">
          <span className="h-1.5 w-1.5 rounded-full bg-primary" style={{ boxShadow: "0 0 0 3px rgba(249,125,3,.22)" }} />
          // upcoming at vedam
        </span>
        <h1 className="mt-3 font-display text-4xl font-extrabold leading-[1.02] tracking-tight text-heading sm:text-5xl">
          Events that <span className="text-brand-gradient">level you up.</span>
        </h1>
        <p className="mt-3 max-w-[44ch] font-body text-base text-muted">
          Bootcamps, sprints, and live sessions for JEE aspirants. Show up, learn, earn points, and collect certificates — all on one account.
        </p>

        <div className="mt-6 flex flex-wrap gap-2">
          {(["upcoming", "past", "featured"] as const).map((v) => (
            <button key={v} onClick={() => setView(v)}
              className={["rounded-lg px-4 py-2 font-mono text-xs font-semibold capitalize transition-colors",
                view === v ? "bg-brand-gradient text-white" : "border border-border-strong bg-surface text-muted hover:text-foreground"].join(" ")}>
              {v}
            </button>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <div className="flex flex-1 items-center gap-2 rounded-xl border border-border bg-surface px-3.5 py-2.5 sm:max-w-xs">
            <span className="text-muted">⌕</span>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search events…"
              className="w-full bg-transparent font-body text-sm text-foreground outline-none" />
          </div>
          <div className="flex flex-wrap gap-2">
            {categories.map((c) => (
              <button key={c} onClick={() => setCat(c)}
                className={["rounded-full px-4 py-2 font-mono text-xs font-semibold transition-colors",
                  cat === c ? "bg-brand-gradient text-white" : "border border-border-strong bg-surface text-muted hover:text-foreground"].join(" ")}>
                {c}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => <div key={i} className="h-64 animate-pulse rounded-2xl border border-border bg-surface" />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="mt-10 rounded-2xl border border-dashed border-border-strong bg-surface p-10 text-center">
            <p className="font-display text-lg font-bold text-heading">No {view === "upcoming" ? "upcoming" : view} events {q || cat !== "All" ? "match your filters" : "yet"}</p>
            <p className="mt-1 font-body text-sm text-muted">{q || cat !== "All" ? "Try clearing the search or category." : view === "past" ? "Past sessions will appear here after they wrap." : "New sessions drop regularly — check back soon."}</p>
          </div>
        ) : (
          <>
            {featured && <FeaturedEvent event={featured} registered={regs[featured.event_code]} />}
            {rest.length > 0 && (
              <>
                <div className="mb-4 mt-10 flex items-baseline gap-3">
                  <h2 className="font-display text-xl font-bold text-heading">More upcoming</h2>
                  <span className="font-mono text-xs text-muted">{rest.length} event{rest.length === 1 ? "" : "s"}</span>
                </div>
                <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                  {rest.map((e) => <EventCard key={e.id} event={e} registered={regs[e.event_code]} />)}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function FeaturedEvent({ event, registered }: { event: EventRow; registered?: boolean }) {
  const off = isOffline(event);
  const pts = pointsTotalPossible(event.points_config);
  return (
    <Link href={`/events/${event.event_code}`}
      className="relative mt-8 flex min-h-[280px] items-end overflow-hidden rounded-3xl text-white shadow-[0_18px_40px_-22px_rgba(43,19,92,0.5)]"
      style={{ background: event.banner_url ? `center/cover url(${event.banner_url})` : "linear-gradient(120deg,#3a1470,#8A18FF 60%,#F97D03)" }}>
      <div aria-hidden className="absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(43,19,92,.15), rgba(43,19,92,.85))" }} />
      <div aria-hidden className="absolute inset-0 opacity-25" style={{ backgroundImage: "radial-gradient(#fff 1px, transparent 1.4px)", backgroundSize: "22px 22px" }} />
      <div className="relative w-full p-8">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-white/25 bg-white/15 px-3 py-1 font-mono text-[11px] font-semibold backdrop-blur">
            {event.category || "Featured"}
          </span>
          <span className="rounded-full border border-white/25 bg-white/15 px-3 py-1 font-mono text-[11px] backdrop-blur">
            {off ? "● In person" : "● Online"}
          </span>
        </div>
        <h2 className="mt-4 max-w-[18ch] font-display text-3xl font-extrabold tracking-tight sm:text-4xl">{event.name}</h2>
        <div className="mt-3 flex flex-wrap gap-4 font-mono text-sm text-white/85">
          <span className="text-white">{eventDateLabel(event)} · {eventTimeLabel(event)}</span>
          {event.host && <span>with {event.host}</span>}
        </div>
        <div className="mt-5 flex items-center gap-3">
          <span className="rounded-xl bg-white px-5 py-2.5 font-display text-sm font-semibold text-[#2B135C]">
            {registered ? "You're registered →" : "Register free →"}
          </span>
          {pts > 0 && <span className="rounded-full px-3.5 py-2 font-mono text-xs font-bold text-[#3a2400]" style={{ background: "linear-gradient(120deg,#F97D03,#ffb15e)" }}>+{pts} pts</span>}
        </div>
      </div>
    </Link>
  );
}

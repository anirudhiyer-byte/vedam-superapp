"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { EventRow } from "@/lib/events";
import { eventDateLabel, eventTimeLabel, isOffline, pointsTotalPossible } from "@/lib/events";

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
      const { data } = await supabase.from("events").select("*").neq("status", "draft").order("starts_at", { ascending: true });
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

  const categories = useMemo(() => ["All", ...Array.from(new Set(events.map((e) => e.category).filter(Boolean) as string[]))], [events]);

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

  return (
    <div className="relative min-h-screen overflow-hidden bg-black text-white">
      <style>{`
        @keyframes ev-slide{0%{transform:translateX(-140px)}100%{transform:translateX(0)}}
        @keyframes ev-pulse{0%,100%{transform:scale(1.25)}18%{transform:scale(1)}}
        .ev-slide{animation:ev-slide 13s linear infinite alternate}
        .ev-pulse{animation:ev-pulse 2.4s ease-in-out infinite}
        @media (prefers-reduced-motion: reduce){.ev-slide,.ev-pulse{animation:none}}
      `}</style>

      {/* ===== HERO ===== */}
      <section className="relative overflow-hidden">
        <div aria-hidden className="ev-slide pointer-events-none absolute right-0 top-[-40px] z-0 h-[520px] w-[1100px] opacity-70"
          style={{ background: "radial-gradient(60% 60% at 70% 30%, rgba(0,207,229,.16), transparent 60%), radial-gradient(50% 50% at 95% 40%, rgba(194,0,219,.22), transparent 65%)", filter: "blur(30px)" }} />
        <div className="relative z-10 mx-auto max-w-[1500px] px-8 pb-8 pt-10 sm:px-14 sm:pt-14 lg:px-20">
          <h1 className="font-[family-name:var(--font-playfair)] italic" style={{ fontSize: "clamp(40px,6vw,60px)", fontWeight: 500, backgroundImage: "linear-gradient(110deg,#35e8fb 8%,#7b5cff 55%,#c200db 100%)", WebkitBackgroundClip: "text", backgroundClip: "text", WebkitTextFillColor: "transparent", color: "transparent", display: "inline-block" }}>Bootcamps</h1>
          <h2 className="mt-3 font-[family-name:var(--font-inter)] font-normal tracking-tight text-white" style={{ fontSize: "clamp(24px,3.2vw,34px)" }}>Explore AI. Build With It.</h2>
          <p className="mt-4 max-w-[900px] font-[family-name:var(--font-inter)] font-extralight leading-[1.4] text-[#afafaf]" style={{ fontSize: "clamp(15px,1.3vw,21px)" }}>
            Live, beginner-friendly, hands-on sessions where you experiment with AI, build projects and discover what&apos;s possible — all before you step into college.
          </p>
        </div>
      </section>

      {/* ===== LIST PANEL ===== */}
      <section className="relative z-10 mt-4 w-full bg-[#232323] py-8 sm:py-12">
        <div className="mx-auto max-w-[1500px] px-8 sm:px-14 lg:px-20">
          {/* tabs */}
          <div className="flex items-center gap-5 sm:gap-6">
            {(["upcoming", "past", "featured"] as const).map((v) => (
              <button key={v} onClick={() => setView(v)}
                className={["relative pb-1.5 font-[family-name:var(--font-inter)] text-[15px] capitalize transition-colors sm:text-lg", view === v ? "font-medium text-white" : "text-white/50 hover:text-white/80"].join(" ")}>
                {v}
                {view === v && <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full" style={{ background: "linear-gradient(90deg,#35e8fb,#c200db)" }} />}
              </button>
            ))}
          </div>

          {/* search + category pills */}
          <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative flex-1 sm:max-w-md">
              <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-white/40">⌕</span>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search Events"
                className="w-full rounded-lg border border-white/15 bg-white/[0.04] py-2.5 pl-10 pr-3.5 font-[family-name:var(--font-inter)] text-sm text-white placeholder:text-white/40 outline-none focus:border-[#00cfe5]/60"
                style={{ boxShadow: "0 0 0 1px transparent" }} />
            </div>
            <div className="flex flex-wrap gap-2">
              {categories.map((c) => (
                <button key={c} onClick={() => setCat(c)}
                  className={["rounded-lg border px-4 py-1.5 font-[family-name:var(--font-inter)] text-sm transition-colors",
                    cat === c ? "border-transparent bg-[#7629fc] text-white" : "border-white/15 bg-[#0e0e0e] text-white/80 hover:border-white/30"].join(" ")}>{c}</button>
              ))}
            </div>
          </div>

          {/* cards */}
          {loading ? (
            <div className="mt-8 grid gap-6 sm:grid-cols-2">{[0, 1].map((i) => <div key={i} className="h-[440px] animate-pulse rounded-[25px] border border-white/10 bg-white/[0.03]" />)}</div>
          ) : filtered.length === 0 ? (
            <div className="mt-10 rounded-2xl border border-dashed border-white/15 p-10 text-center">
              <p className="font-[family-name:var(--font-inter)] text-lg font-semibold text-white">No {view} events {q || cat !== "All" ? "match your filters" : "yet"}</p>
              <p className="mt-1 font-[family-name:var(--font-inter)] text-sm text-white/50">{q || cat !== "All" ? "Try clearing the search or category." : view === "past" ? "Past sessions appear here after they wrap." : "New sessions drop regularly — check back soon."}</p>
            </div>
          ) : (
            <div className="mt-7 grid gap-7 sm:grid-cols-2">
              {filtered.map((e) => <EventCard key={e.id} event={e} registered={regs[e.event_code]} />)}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function EventCard({ event, registered }: { event: EventRow; registered?: boolean }) {
  const off = isOffline(event);
  const pts = pointsTotalPossible(event.points_config);
  return (
    <Link href={`/events/${event.event_code}`}
      className="group relative block overflow-hidden rounded-[24px] border border-white/15 transition-all duration-300 hover:-translate-y-1.5 hover:border-[#7ad7ff]/60 hover:shadow-[0_0_70px_-10px_rgba(123,92,255,0.6)]"
      style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,0.18)" }}>
      {/* glossy shine sweep */}
      <span aria-hidden className="ld-shine pointer-events-none absolute inset-y-0 -left-full z-20 w-1/2 -skew-x-[18deg]" style={{ background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.12) 30%, rgba(255,255,255,0.5) 50%, rgba(255,255,255,0.12) 70%, transparent)" }} />
      {/* banner */}
      <div className="relative h-[200px] w-full overflow-hidden sm:h-[240px]" style={{ background: event.banner_url ? `center/cover url(${event.banner_url})` : "linear-gradient(120deg,#1a0b38,#2b135c)" }}>
        <div aria-hidden className="absolute inset-0" style={{ background: "linear-gradient(180deg, transparent 40%, rgba(0,0,0,0.45))" }} />
        <div className="absolute left-3 top-3 z-20 flex flex-wrap gap-2">
          {event.category && <span className="rounded-full border border-white/30 bg-black/45 px-3 py-1 font-mono text-[10px] font-semibold text-white backdrop-blur">{event.category}</span>}
          <span className="flex items-center gap-1.5 rounded-full border border-white/30 bg-black/45 px-3 py-1 font-mono text-[10px] text-white backdrop-blur"><span className="ev-pulse h-1.5 w-1.5 rounded-full" style={{ background: off ? "#ffd27a" : "#5ce38a" }} />{off ? "In person" : "Online"}</span>
        </div>
        {registered && <span className="absolute right-3 top-3 z-20 rounded-full bg-[#34c759] px-2.5 py-1 font-mono text-[10px] font-bold text-white">Registered</span>}
      </div>
      {/* GRADIENT info section — richer, premium, with a glossy top highlight */}
      <div className="relative z-[5] px-7 pb-6 pt-5" style={{ background: "linear-gradient(120deg,#2166ff 0%,#7b2ff2 48%,#d21ad6 100%)" }}>
        <span aria-hidden className="pointer-events-none absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(255,255,255,0.18), transparent 45%)" }} />
        <div className="relative font-[family-name:var(--font-inter)] text-xl font-bold uppercase leading-tight tracking-tight text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.3)] sm:text-2xl">{event.name}</div>
        <div className="relative mt-1.5 font-[family-name:var(--font-inter)] text-[13px] font-medium text-white/85">{eventDateLabel(event)} · {eventTimeLabel(event)}</div>
        <div className="relative mt-4 flex items-center justify-between gap-3">
          {event.host && <span className="truncate font-[family-name:var(--font-inter)] text-sm font-medium text-white">with {event.host}</span>}
          <div className="ml-auto flex items-end gap-6">
            {event.max_attendees != null && <div className="text-right"><div className="font-[family-name:var(--font-inter)] text-[10px] font-semibold uppercase tracking-wide text-white/70">Seats</div><div className="font-[family-name:var(--font-inter)] text-base font-extrabold text-white">{event.max_attendees}</div></div>}
            {pts > 0 && <div className="text-right"><div className="font-[family-name:var(--font-inter)] text-[10px] font-semibold uppercase tracking-wide text-white/70">Points</div><div className="font-[family-name:var(--font-inter)] text-base font-extrabold text-[#ffe27a]">+{pts}</div></div>}
          </div>
        </div>
      </div>
    </Link>
  );
}



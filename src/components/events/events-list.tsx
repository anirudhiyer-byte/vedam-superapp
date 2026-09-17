"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useProductGate } from "@/components/funnel/use-product-gate";
import { useResumeAction } from "@/lib/funnel/use-resume-action";
import type { EventRow } from "@/lib/events";
import { eventDateLabel, eventTimeLabel, isOffline, pointsTotalPossible } from "@/lib/events";

export function EventsList({ initialEvents = [] }: { initialEvents?: EventRow[] } = {}) {
  const [supabase] = useState(() => createClient());
  const router = useRouter();
  const { gate, Modals } = useProductGate();
  const [events, setEvents] = useState<EventRow[]>(initialEvents);
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

  const onRegister = (e: EventRow) => gate({ kind: "register_event", eventCode: e.event_code }, () => {
    router.push(`/events/${e.event_code}?register=1`);
  }, "Sign up to register for this bootcamp.");
  useResumeAction((a) => { if (a.kind === "register_event" && a.eventCode) router.push(`/events/${a.eventCode}?register=1`); });

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
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 z-[8] h-28" style={{ background: "linear-gradient(to bottom, #000 25%, rgba(0,0,0,0.5) 60%, transparent)" }} />
        <div aria-hidden className="ev-slide pointer-events-none absolute right-0 top-[-40px] z-0 h-[520px] w-[1100px] opacity-70"
          style={{ background: "radial-gradient(60% 60% at 70% 30%, rgba(0,207,229,.16), transparent 60%), radial-gradient(50% 50% at 95% 40%, rgba(194,0,219,.22), transparent 65%)", filter: "blur(30px)" }} />
        <div className="relative z-10 mx-auto max-w-[1500px] px-8 pb-4 pt-6 sm:px-14 sm:pt-7 lg:px-20">
          <h1 className="font-[family-name:var(--font-playfair)] italic" style={{ fontSize: "clamp(40px,6vw,60px)", fontWeight: 500, backgroundImage: "linear-gradient(110deg,#35e8fb 8%,#7b5cff 55%,#c200db 100%)", WebkitBackgroundClip: "text", backgroundClip: "text", WebkitTextFillColor: "transparent", color: "transparent", display: "inline-block" }}>Bootcamps</h1>
          <h2 className="mt-1.5 font-[family-name:var(--font-inter)] font-normal tracking-tight text-white" style={{ fontSize: "clamp(24px,3.2vw,34px)" }}>Explore AI. Build With It.</h2>
          <p className="mt-2 max-w-[900px] font-[family-name:var(--font-inter)] font-extralight leading-[1.4] text-[#afafaf]" style={{ fontSize: "clamp(15px,1.3vw,21px)" }}>
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
              {filtered.map((e) => <EventCard key={e.id} event={e} registered={regs[e.event_code]} onRegister={() => onRegister(e)} />)}
            </div>
          )}
        </div>
      </section>
      <Modals />
    </div>
  );
}

function EventCard({ event, registered, onRegister }: { event: EventRow; registered?: boolean; onRegister: () => void }) {
  const off = isOffline(event);
  const pts = pointsTotalPossible(event.points_config);
  return (
    <div className="group relative overflow-hidden rounded-[24px] border border-white/12 bg-[#120a26] shadow-[inset_0_1px_0_rgba(255,255,255,0.14)] transition-all duration-300 hover:-translate-y-1.5 hover:border-[#7ad7ff]/50 hover:shadow-[0_0_70px_-12px_rgba(123,92,255,0.6)]">
      {/* the card design template */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/bootcamp-card.webp" alt="" aria-hidden className="pointer-events-none absolute inset-0 h-full w-full object-cover" />
      <span aria-hidden className="ld-shine pointer-events-none absolute inset-y-0 -left-full z-30 w-1/2 -skew-x-[18deg]" style={{ background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.12) 30%, rgba(255,255,255,0.5) 50%, rgba(255,255,255,0.12) 70%, transparent)" }} />

      <div className="relative z-10 flex min-h-[420px] flex-col">
        {/* WHITE zone — Date & Time */}
        <div className="px-6 pt-6">
          <div className="font-[family-name:var(--font-inter)] text-[11px] font-bold uppercase tracking-wide text-[#8b8b8b]">Date &amp; Time</div>
          <div className="mt-0.5 font-[family-name:var(--font-inter)] text-[15px] font-semibold text-[#1c1c1c]">{eventDateLabel(event)} · {eventTimeLabel(event)}</div>
          {registered && <span className="mt-2 inline-block rounded-full bg-[#34c759] px-2.5 py-0.5 font-mono text-[10px] font-bold text-white">Registered ✓</span>}
        </div>

        {/* GRADIENT zone — details + buttons + seats/points */}
        <div className="mt-auto px-6 pb-6 pt-5 text-white">
          <div className="font-[family-name:var(--font-inter)] text-xl font-bold uppercase leading-tight tracking-tight drop-shadow-[0_1px_2px_rgba(0,0,0,0.3)] sm:text-[22px]">{event.name}</div>
          {event.host && <div className="mt-1.5 font-[family-name:var(--font-inter)] text-[14px] font-semibold text-white/90">with {event.host}</div>}
          <div className="mt-1 flex items-center gap-1.5 font-[family-name:var(--font-inter)] text-[13px] text-white/80"><span className="ev-pulse h-1.5 w-1.5 rounded-full" style={{ background: off ? "#ffd27a" : "#5ce38a" }} />{event.platform || (off ? "In person" : "Online")}</div>

          <div className="mt-4 flex gap-3">
            <Link href={`/events/${event.event_code}`} className="flex-1 rounded-lg border border-white/40 py-2.5 text-center font-[family-name:var(--font-inter)] text-sm font-semibold text-white backdrop-blur transition hover:bg-white/10">View</Link>
            <button onClick={onRegister} className="flex-1 rounded-lg py-2.5 text-center font-[family-name:var(--font-inter)] text-sm font-semibold text-white transition-opacity hover:opacity-90" style={{ background: "linear-gradient(96deg,#35e8fb,#7b5cff 55%,#c200db)" }}>{registered ? "Registered" : "Register Now"}</button>
          </div>

          <div className="mt-4 flex items-end justify-between">
            {event.max_attendees != null ? <div><div className="font-[family-name:var(--font-inter)] text-[11px] font-bold uppercase tracking-wide text-[#7ad7ff]">Seats</div><div className="font-[family-name:var(--font-inter)] text-lg font-extrabold">{event.max_attendees}</div></div> : <span />}
            {pts > 0 && <div className="text-right"><div className="font-[family-name:var(--font-inter)] text-[11px] font-bold uppercase tracking-wide text-[#ffd27a]">Points</div><div className="font-[family-name:var(--font-inter)] text-lg font-extrabold text-[#ffe27a]">+{pts}</div></div>}
          </div>
        </div>
      </div>
    </div>
  );
}




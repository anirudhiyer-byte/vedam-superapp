"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { EventRow } from "@/lib/events";
import { isOffline, eventDateLabel, eventTimeLabel, regClosed, pointsLine, pointsTotalPossible } from "@/lib/events";
import { RegistrationForm } from "@/components/events/registration-form";
import { ProjectSubmission } from "@/components/events/project-submission";

type Profile = { full_name: string | null; phone: string | null; email: string | null; grad_year: number | null; stream: string | null };

export function EventDetail({ code }: { code: string }) {
  const [supabase] = useState(() => createClient());
  const [event, setEvent] = useState<EventRow | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [registered, setRegistered] = useState(false);
  const [zoomJoinUrl, setZoomJoinUrl] = useState<string | null>(null);
  const [regInfo, setRegInfo] = useState<{ id: string; joined: boolean; github: string | null } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data: ev } = await supabase.from("events").select("*").eq("event_code", code).maybeSingle();
      if (active) setEvent((ev as EventRow) ?? null);
      if (ev) { try { await supabase.rpc("log_event_view", { p_event_id: (ev as EventRow).id }); } catch { /* best effort */ } }
      const { data: u } = await supabase.auth.getUser();
      if (u.user && active) {
        setUserId(u.user.id);
        const { data: p } = await supabase.from("profiles")
          .select("full_name, phone, email, grad_year, stream").eq("id", u.user.id).single();
        if (active) setProfile((p as Profile) ?? null);
        if (ev) {
          const { data: r } = await supabase.from("event_registrations")
            .select("id, zoom_join_url, joined, github_url").eq("event_id", (ev as EventRow).id).eq("user_id", u.user.id).maybeSingle();
          if (active) { setRegistered(!!r); setZoomJoinUrl((r as { zoom_join_url?: string } | null)?.zoom_join_url ?? null); if (r) setRegInfo({ id: (r as { id: string }).id, joined: !!(r as { joined?: boolean }).joined, github: (r as { github_url?: string } | null)?.github_url ?? null }); }
        }
      }
      if (active) setLoading(false);
    })();
    return () => { active = false; };
  }, [supabase, code]);

  if (loading) return <div className="mx-auto max-w-5xl px-6 py-16"><div className="h-72 animate-pulse rounded-3xl border border-border bg-surface" /></div>;
  if (!event) return (
    <div className="mx-auto max-w-3xl px-6 py-24 text-center">
      <h1 className="font-display text-2xl font-bold text-heading">Event not found</h1>
      <Link href="/events" className="mt-3 inline-block font-body text-sm font-semibold text-accent">← Back to events</Link>
    </div>
  );

  const off = isOffline(event);
  const joinUrl = zoomJoinUrl || event.join_link;
  const wa = event.whatsapp_community_url && /^https?:\/\//.test(event.whatsapp_community_url) ? event.whatsapp_community_url : null;
  const facts: { k: string; v: React.ReactNode }[] = [
    { k: "Date", v: eventDateLabel(event) },
    { k: off ? "Venue" : "Platform", v: eventTimeLabel(event) },
    { k: "Duration", v: event.duration_minutes ? `${event.duration_minutes} min` : "—" },
    { k: "Mode", v: off ? "In person" : "Online" },
  ];

  return (
    <div className="mx-auto max-w-5xl px-6 py-8 sm:px-8">
      <Link href="/events" className="font-mono text-xs text-muted hover:text-foreground">← all events</Link>

      {/* hero */}
      <div className="relative mt-4 flex min-h-[240px] items-end overflow-hidden rounded-3xl text-white shadow-[0_18px_40px_-22px_rgba(43,19,92,0.5)]"
        style={{ background: event.banner_url ? `center/cover url(${event.banner_url})` : "linear-gradient(120deg,#8A18FF,#3a1470 70%,#F97D03)" }}>
        <div aria-hidden className="absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(43,19,92,.1), rgba(43,19,92,.82))" }} />
        <div aria-hidden className="absolute inset-0 opacity-20" style={{ backgroundImage: "radial-gradient(#fff 1px, transparent 1.4px)", backgroundSize: "22px 22px" }} />
        <div className="relative w-full p-8">
          <span className="rounded-full border border-white/25 bg-white/15 px-3 py-1 font-mono text-[11px] font-semibold uppercase tracking-wide backdrop-blur">
            {event.category || "Vedam Event"}
          </span>
          <h1 className="mt-3 max-w-[20ch] font-display text-3xl font-extrabold tracking-tight sm:text-4xl">{event.name}</h1>
          {event.host && <p className="mt-2 font-mono text-sm text-white/85">Hosted by Vedam · with {event.host}</p>}
        </div>
      </div>

      <div className="mt-7 grid gap-7 lg:grid-cols-[1fr_340px] lg:items-start">
        {/* left: facts + content */}
        <div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {facts.map((f) => (
              <div key={f.k} className="rounded-2xl border border-border bg-surface p-4">
                <div className="font-mono text-[10px] uppercase tracking-wide text-muted">{f.k}</div>
                <div className="mt-1 font-display text-base font-bold text-heading">{f.v}</div>
              </div>
            ))}
          </div>

          {pointsLine(event.points_config).length > 0 && (
            <div className="mt-6 rounded-2xl border border-border bg-surface-warm p-4">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] font-semibold uppercase tracking-wide text-accent">Earn Vedam points</span>
                <span className="font-display text-sm font-bold text-heading">up to {pointsTotalPossible(event.points_config)} pts</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {pointsLine(event.points_config).map((x) => (
                  <span key={x.short} className="rounded-full border border-border bg-background px-2.5 py-1 font-body text-xs text-foreground">
                    {x.short} <b className="text-primary">+{x.pts}</b>
                  </span>
                ))}
              </div>
            </div>
          )}

          {event.blurb && <div className="mt-6"><h3 className="font-display text-lg font-bold text-heading">About this session</h3><p className="mt-2 font-body text-[15px] leading-relaxed text-foreground/90">{event.blurb}</p></div>}
          {event.details && <p className="mt-3 whitespace-pre-line font-body text-sm leading-relaxed text-muted">{event.details}</p>}

          {Array.isArray(event.schedule) && event.schedule.length > 0 && (
            <div className="mt-6">
              <h3 className="font-display text-lg font-bold text-heading">Schedule</h3>
              <div className="mt-2">
                {(event.schedule as { time?: string; title?: string }[]).map((s, i) => (
                  <div key={i} className="grid grid-cols-[92px_1fr] gap-4 border-t border-border py-3">
                    <span className="font-mono text-sm font-semibold text-accent">{s.time || ""}</span>
                    <span className="font-display font-semibold text-heading">{s.title || ""}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {wa && (
            <a href={wa} target="_blank" rel="noreferrer"
              className="mt-6 inline-block rounded-xl border border-border px-4 py-2.5 text-sm font-semibold text-foreground hover:bg-surface-warm">
              Join the WhatsApp community
            </a>
          )}
        </div>

        {/* right: sticky register card */}
        <div className="lg:sticky lg:top-20">
          <div className="rounded-2xl border border-border bg-surface p-6 shadow-[0_18px_40px_-22px_rgba(43,19,92,0.35)]">
            {registered ? (
              <div>
                <div className="flex items-center gap-2 rounded-xl border border-border bg-surface-warm px-4 py-3 font-display font-bold text-heading">🎉 You&apos;re registered</div>
                {!off && joinUrl && (
                  <a href={joinUrl} target="_blank" rel="noreferrer"
                    className="mt-3 block rounded-xl border border-dashed border-border-strong bg-surface-warm px-4 py-3 text-center font-mono text-sm text-accent">
                    🔗 {zoomJoinUrl ? "Your personal join link" : "Join link"}
                  </a>
                )}
                                <p className="mt-3 text-center font-body text-xs text-muted">We&apos;ve emailed your details + calendar invite.</p>
                {event.submission_enabled && regInfo?.joined && event.starts_at && new Date(event.starts_at).getTime() < Date.now() && (
                  <ProjectSubmission registrationId={regInfo.id} points={event.submission_points ?? 0} alreadyUrl={regInfo.github} />
                )}
              </div>
            ) : regClosed(event) ? (
              <p className="py-4 text-center font-body text-sm text-muted">Registration for this event has closed.</p>
            ) : !userId ? (
              <div className="text-center">
                {pointsTotalPossible(event.points_config) > 0 && (
                  <div className="mb-3 flex items-center justify-between rounded-xl bg-surface-warm px-4 py-3">
                    <span className="font-body text-sm text-muted">Earn up to</span>
                    <span className="font-mono text-sm font-bold text-primary">+{pointsTotalPossible(event.points_config)} pts</span>
                  </div>
                )}
                <h2 className="font-display text-lg font-bold text-heading">Register for this event</h2>
                <p className="mt-1 font-body text-sm text-muted">Log in to register — it takes a few seconds.</p>
                <Link href={`/login?next=/events/${event.event_code}`}
                  className="mt-4 inline-block w-full rounded-xl bg-brand-gradient px-6 py-3 text-sm font-semibold text-white">
                  Log in to register
                </Link>
              </div>
            ) : profile ? (
              <>
                {pointsTotalPossible(event.points_config) > 0 && (
                  <div className="mb-4 flex items-center justify-between rounded-xl bg-surface-warm px-4 py-3">
                    <span className="font-body text-sm text-muted">Earn up to</span>
                    <span className="font-mono text-sm font-bold text-primary">+{pointsTotalPossible(event.points_config)} pts</span>
                  </div>
                )}
                <h2 className="mb-4 font-display text-lg font-bold text-heading">Register</h2>
                <RegistrationForm event={event} profile={profile} userId={userId} onDone={() => setRegistered(true)} />
              </>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

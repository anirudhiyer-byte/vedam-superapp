"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { EventRow } from "@/lib/events";
import { isOffline, eventDateLabel, eventTimeLabel, regClosed, pointsLine, pointsTotalPossible } from "@/lib/events";
import { RegistrationForm } from "@/components/events/registration-form";
import { linkedInShareUrl } from "@/lib/events";

type Profile = { full_name: string | null; phone: string | null; email: string | null; grad_year: number | null; stream: string | null };

export function EventDetail({ code }: { code: string }) {
  const [supabase] = useState(() => createClient());
  const [event, setEvent] = useState<EventRow | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [registered, setRegistered] = useState(false);
  const [certId, setCertId] = useState<string | null>(null);
  const [shareDismissed, setShareDismissed] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data: ev } = await supabase.from("events").select("*").eq("event_code", code).maybeSingle();
      if (active) setEvent((ev as EventRow) ?? null);

      const { data: u } = await supabase.auth.getUser();
      if (u.user && active) {
        setUserId(u.user.id);
        const { data: p } = await supabase.from("profiles")
          .select("full_name, phone, email, grad_year, stream").eq("id", u.user.id).single();
        if (active) setProfile((p as Profile) ?? null);
        if (ev) {
          const { data: r } = await supabase.from("event_registrations")
            .select("id").eq("event_id", (ev as EventRow).id).eq("user_id", u.user.id).maybeSingle();
          if (active) setRegistered(!!r);
          if (r) {
            const { data: cert } = await supabase.from("certificates").select("id").eq("registration_id", r.id).maybeSingle();
            if (active && cert) setCertId(cert.id);
          }
        }
      }
      if (active) setLoading(false);
    })();
    return () => { active = false; };
  }, [supabase, code]);

  if (loading) return <div className="mx-auto max-w-3xl px-6 py-16"><div className="h-64 animate-pulse rounded-2xl border border-border bg-surface" /></div>;
  if (!event) return (
    <div className="mx-auto max-w-3xl px-6 py-24 text-center">
      <h1 className="font-display text-2xl font-bold text-heading">Event not found</h1>
      <Link href="/events" className="mt-3 inline-block font-body text-sm font-semibold text-accent">← Back to events</Link>
    </div>
  );

  const off = isOffline(event);
  const sharePts = Number((event.points_config as Record<string, number> | null)?.share_linkedin || 0);

  return (
    <div className="mx-auto max-w-3xl px-6 py-10 sm:px-8">
      <Link href="/events" className="font-body text-sm text-muted hover:text-foreground">← All events</Link>

      <div className="mt-4 overflow-hidden rounded-2xl border border-border bg-surface">
        {event.banner_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={event.banner_url} alt="" className="h-48 w-full object-cover" />
        )}
        <div className="p-6 sm:p-8">
          <span className="font-mono text-xs font-semibold uppercase tracking-[0.14em] text-accent">
            {event.category || "Vedam Event"} · {off ? "In person" : "Online"}
          </span>
          <h1 className="mt-2 font-display text-3xl font-bold tracking-tight text-heading">{event.name}</h1>
          {event.host && <p className="mt-1 font-body text-sm text-muted">with {event.host}</p>}

          <div className="mt-5 grid gap-3 rounded-xl border border-border bg-background p-4 sm:grid-cols-2">
            <Detail label="When" value={eventDateLabel(event)} />
            <Detail label={off ? "Where" : "Platform"} value={eventTimeLabel(event)} />
            {off && event.map_link && <Detail label="Directions" value={<a className="text-accent" href={event.map_link} target="_blank" rel="noreferrer">Open map</a>} />}
            {!off && event.join_link && <Detail label="Join" value={<a className="text-accent" href={event.join_link} target="_blank" rel="noreferrer">Join link</a>} />}
          </div>

          {pointsLine(event.points_config).length > 0 && (
            <div className="mt-5 rounded-xl border border-border bg-surface-warm p-4">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] font-semibold uppercase tracking-wide text-accent">Earn Vedam points</span>
                <span className="font-display text-sm font-bold text-heading">up to {pointsTotalPossible(event.points_config)} pts</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {pointsLine(event.points_config).map((x) => (
                  <span key={x.short} className="rounded-full border border-border bg-background px-2.5 py-1 font-body text-xs text-foreground">
                    {x.short} <b className="text-accent">+{x.pts}</b>
                  </span>
                ))}
              </div>
            </div>
          )}

          {event.blurb && <p className="mt-5 font-body text-base leading-relaxed text-foreground/90">{event.blurb}</p>}
          {event.details && <p className="mt-3 whitespace-pre-line font-body text-sm leading-relaxed text-muted">{event.details}</p>}

          {event.whatsapp_community_url && (
            <a href={event.whatsapp_community_url} target="_blank" rel="noreferrer"
              className="mt-5 inline-block rounded-lg border border-border px-4 py-2 text-sm font-semibold text-foreground hover:bg-surface-warm">
              Join the WhatsApp community
            </a>
          )}
        </div>
      </div>

      <div className="mt-6 rounded-2xl border border-border bg-surface p-6 sm:p-8">
        {registered ? (
          <div className="text-center">
            <h2 className="font-display text-xl font-bold text-heading">You&apos;re registered 🎉</h2>
            <p className="mt-2 font-body text-sm text-muted">Your spot is locked. We&apos;ll be in touch with the details.</p>
            {certId && !shareDismissed && (
              <div className="mt-5 flex items-center gap-3 rounded-xl border border-border bg-surface-warm p-4 text-left">
                <div className="min-w-0 flex-1">
                  <p className="font-body text-sm font-semibold text-foreground">Share your certificate on LinkedIn{sharePts > 0 ? <span className="text-accent"> · +{sharePts} pts</span> : null}</p>
                  <p className="mt-0.5 font-body text-xs text-muted">Show your network what you achieved.</p>
                </div>
                <a href={linkedInShareUrl(`${typeof window !== "undefined" ? window.location.origin : ""}/certificate?c=${certId}`)} target="_blank" rel="noreferrer"
                  className="shrink-0 rounded-lg bg-[#0A66C2] px-4 py-2 text-sm font-semibold text-white">Share</a>
                <button onClick={() => setShareDismissed(true)} aria-label="Dismiss" className="shrink-0 rounded-md px-2 py-1 text-muted hover:text-foreground">✕</button>
              </div>
            )}
          </div>
        ) : regClosed(event) ? (
          <p className="text-center font-body text-sm text-muted">Registration for this event has closed.</p>
        ) : !userId ? (
          <div className="text-center">
            <h2 className="font-display text-lg font-bold text-heading">Register for this event</h2>
            <p className="mt-1 font-body text-sm text-muted">Log in to register — it takes a few seconds.</p>
            <Link href={`/login?next=/events/${event.event_code}`}
              className="mt-4 inline-block rounded-xl bg-brand-gradient px-6 py-3 text-sm font-semibold text-white">
              Log in to register
            </Link>
          </div>
        ) : profile ? (
          <>
            <h2 className="mb-4 font-display text-lg font-bold text-heading">Register</h2>
            <RegistrationForm event={event} profile={profile} userId={userId} onDone={() => setRegistered(true)} />
          </>
        ) : null}
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="font-mono text-[10px] font-semibold uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-0.5 font-body text-sm font-medium text-foreground">{value}</div>
    </div>
  );
}

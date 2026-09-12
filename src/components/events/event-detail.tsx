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
  const [showRec, setShowRec] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data: ev } = await supabase.from("events").select("*").eq("event_code", code).maybeSingle();
      if (active) setEvent((ev as EventRow) ?? null);
      if (ev) { try { await supabase.rpc("log_event_view", { p_event_id: (ev as EventRow).id }); } catch { /* best effort */ } try { await supabase.rpc("record_bootcamp_view", { p_event: (ev as EventRow).id }); } catch { /* best effort — self-gates to logged-in + upcoming + not-registered */ } }
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

  const embedRecording = (url: string | null): string | null => {
    if (!url) return null;
    const drive = url.match(/drive\.google\.com\/file\/d\/([^/]+)/) || url.match(/[?&]id=([^&]+)/);
    if (url.includes("drive.google.com") && drive) return `https://drive.google.com/file/d/${drive[1]}/preview`;
    const yt = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([\w-]+)/);
    if (yt) return `https://www.youtube.com/embed/${yt[1]}`;
    return url;
  };

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
      <style>{`@keyframes ld-shine{0%{left:-70%}100%{left:170%}}.group:hover .ld-shine{animation:ld-shine 0.8s ease-out}`}</style>
      <Link href="/events" className="font-[family-name:var(--font-inter)] text-xs text-white/55 hover:text-white">← all events</Link>

      {/* hero */}
      <div className="relative mt-4 flex min-h-[240px] items-end overflow-hidden rounded-3xl border-2 border-[#00cfe5]/40 text-white shadow-[0_18px_40px_-22px_rgba(0,0,0,0.6)]"
        style={{ background: event.banner_url ? `center/cover url(${event.banner_url})` : "linear-gradient(120deg,#8A18FF,#3a1470 70%,#F97D03)" }}>
        <div aria-hidden className="absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(43,19,92,.1), rgba(43,19,92,.82))" }} />
        <div aria-hidden className="absolute inset-0 opacity-20" style={{ backgroundImage: "radial-gradient(#fff 1px, transparent 1.4px)", backgroundSize: "22px 22px" }} />
        <div className="relative w-full p-8">
          <span className="rounded-full border border-[#00cfe5]/50 bg-[#00cfe5]/10 px-3 py-1 font-mono text-[11px] font-semibold uppercase tracking-wide text-[#8fe9f5] backdrop-blur">
            {event.category || "Vedam Event"}
          </span>
          <h1 className="mt-3 max-w-[20ch] font-display text-3xl font-semibold tracking-tight sm:text-4xl">{event.name}</h1>
          {event.host && <p className="mt-2 font-mono text-sm text-white/85">Hosted by Vedam · with {event.host}</p>}
        </div>
      </div>

      <div className="mt-7 grid gap-7 lg:grid-cols-[1fr_340px] lg:items-start">
        {/* left: facts + content */}
        <div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {facts.map((f) => (
              <div key={f.k} className="rounded-2xl border border-white/12 bg-white/[0.05] p-4 backdrop-blur-xl">
                <div className="font-[family-name:var(--font-inter)] text-[11px] font-bold uppercase tracking-wide text-[#7ad7ff]">{f.k}</div>
                <div className="mt-1 font-[family-name:var(--font-inter)] text-[17px] font-semibold text-white">{f.v}</div>
              </div>
            ))}
          </div>

          {pointsLine(event.points_config).length > 0 && (
            <div className="mt-6 rounded-2xl border border-[#7b5cff]/30 p-4 backdrop-blur-xl" style={{ background: "linear-gradient(120deg, rgba(53,232,251,0.08), rgba(194,0,219,0.12))" }}>
              <div className="flex items-center justify-between">
                <span className="font-[family-name:var(--font-inter)] text-[11px] font-bold uppercase tracking-wide text-[#8fe9f5]">Earn Vedam points</span>
                <span className="font-display text-sm font-semibold text-white">up to {pointsTotalPossible(event.points_config)} pts</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {pointsLine(event.points_config).map((x) => (
                  <span key={x.short} className="rounded-full border border-white/15 bg-white/[0.06] px-2.5 py-1 font-body text-xs text-white/85">
                    {x.short} <b className="text-primary">+{x.pts}</b>
                  </span>
                ))}
              </div>
            </div>
          )}

          {event.blurb && <div className="mt-6"><h3 className="font-display text-lg font-semibold text-white">About this session</h3><p className="mt-2 font-body text-[15px] font-light leading-relaxed text-white/80">{event.blurb}</p></div>}
          {event.details && <p className="mt-3 whitespace-pre-line font-body text-sm font-light leading-relaxed text-white/55">{event.details}</p>}

          {Array.isArray(event.schedule) && event.schedule.length > 0 && (
            <div className="mt-6">
              <h3 className="font-display text-lg font-semibold text-white">Schedule</h3>
              <div className="mt-2">
                {(event.schedule as { time?: string; title?: string }[]).map((s, i) => (
                  <div key={i} className="grid grid-cols-[92px_1fr] gap-4 border-t border-white/10 py-3">
                    <span className="font-[family-name:var(--font-inter)] text-[15px] font-bold text-[#8fe9f5]">{s.time || ""}</span>
                    <span className="font-display font-medium text-white">{s.title || ""}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {wa && (
            <a href={wa} target="_blank" rel="noreferrer"
              className="mt-6 inline-flex items-center gap-2 rounded-xl border border-[#34c759]/40 bg-[#34c759]/10 px-4 py-2.5 font-[family-name:var(--font-inter)] text-sm font-semibold text-white backdrop-blur-xl transition hover:border-[#34c759] hover:shadow-[0_0_24px_rgba(52,199,89,0.4)]">
              Join the WhatsApp community
            </a>
          )}
        </div>

        {/* right: sticky register card */}
        <div className="lg:sticky lg:top-20">
          <div className="relative overflow-hidden rounded-2xl border border-white/15 bg-white/[0.06] p-6 backdrop-blur-xl shadow-[0_20px_50px_-24px_rgba(0,0,0,0.7)]"><span aria-hidden className="pointer-events-none absolute inset-0" style={{ background: "linear-gradient(130deg, rgba(255,255,255,0.14), transparent 32%)" }} />
            {registered ? (
              <div>
                <div className="relative flex items-center gap-2 rounded-xl border border-[#34c759]/40 bg-[#34c759]/10 px-4 py-3 font-display font-semibold text-white">🎉 You&apos;re registered</div>
                {!off && joinUrl && (
                  <a href={joinUrl} target="_blank" rel="noreferrer"
                    className="relative mt-3 block rounded-xl border border-dashed border-[#00cfe5]/50 bg-[#00cfe5]/10 px-4 py-3 text-center font-mono text-sm text-[#8fe9f5] backdrop-blur">
                    🔗 {zoomJoinUrl ? "Your personal join link" : "Join link"}
                  </a>
                )}
                                <p className="relative mt-3 text-center font-body text-xs text-white/50">We&apos;ve emailed your details + calendar invite.</p>
                {event.recording_url && event.starts_at && new Date(event.starts_at).getTime() < Date.now() && (
                  <div className="relative mt-4">
                    <button onClick={() => setShowRec((v) => !v)} className="group relative flex w-full items-center justify-center gap-2 overflow-hidden rounded-xl border border-[#00cfe5]/50 bg-[#00cfe5]/12 px-4 py-3 font-[family-name:var(--font-inter)] text-sm font-semibold text-[#aef0f8] backdrop-blur-xl transition-all hover:border-[#00cfe5] hover:shadow-[0_0_30px_rgba(0,207,229,0.5)]"><span aria-hidden className="ld-shine pointer-events-none absolute inset-y-0 -left-full z-[5] w-1/2 -skew-x-12" style={{ background: "linear-gradient(90deg,transparent,rgba(255,255,255,0.4),transparent)" }} />
                      {showRec ? "▾ Hide recording" : "▶ View recording"}
                    </button>
                  </div>
                )}
                {event.submission_enabled && regInfo?.joined && event.starts_at && new Date(event.starts_at).getTime() < Date.now() && (
                  <ProjectSubmission registrationId={regInfo.id} points={event.submission_points ?? 0} alreadyUrl={regInfo.github} />
                )}
              </div>
            ) : regClosed(event) ? (
              <p className="relative py-4 text-center font-body text-sm text-white/55">Registration for this event has closed.</p>
            ) : !userId ? (
              <div className="text-center">
                {pointsTotalPossible(event.points_config) > 0 && (
                  <div className="relative mb-3 flex items-center justify-between rounded-xl border border-white/12 bg-white/[0.06] px-4 py-3">
                    <span className="relative font-body text-sm text-white/60">Earn up to</span>
                    <span className="relative font-mono text-sm font-bold text-[#F97D03]">+{pointsTotalPossible(event.points_config)} pts</span>
                  </div>
                )}
                <h2 className="relative font-display text-lg font-semibold text-white">Register for this event</h2>
                <p className="relative mt-1 font-body text-sm text-white/55">Log in to register — it takes a few seconds.</p>
                <Link href={`/login?next=/events/${event.event_code}`} className="mt-4 group relative inline-flex w-full items-center justify-center gap-2 overflow-hidden rounded-xl border border-white/25 px-6 py-3 font-[family-name:var(--font-inter)] text-sm font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.35)] backdrop-blur-xl transition-all hover:border-white/60 hover:shadow-[0_0_30px_rgba(123,92,255,0.6),inset_0_1px_0_rgba(255,255,255,0.5)] active:scale-[0.98]" style={{ background: "linear-gradient(96deg, rgba(53,232,251,0.32), rgba(123,92,255,0.45) 55%, rgba(194,0,219,0.4))" }}>
                  <span className="relative z-10">Log in to register</span>
                  <span aria-hidden className="ld-shine pointer-events-none absolute inset-y-0 -left-full z-[5] w-1/2 -skew-x-12" style={{ background: "linear-gradient(90deg,transparent,rgba(255,255,255,0.4),transparent)" }} />
                </Link>
              </div>
            ) : profile ? (
              <>
                {pointsTotalPossible(event.points_config) > 0 && (
                  <div className="relative mb-4 flex items-center justify-between rounded-xl border border-white/12 bg-white/[0.06] px-4 py-3">
                    <span className="relative font-body text-sm text-white/60">Earn up to</span>
                    <span className="relative font-mono text-sm font-bold text-[#F97D03]">+{pointsTotalPossible(event.points_config)} pts</span>
                  </div>
                )}
                <h2 className="relative mb-4 font-display text-lg font-semibold text-white">Register</h2>
                <RegistrationForm event={event} profile={profile} userId={userId} onDone={() => setRegistered(true)} />
              </>
            ) : null}
          </div>
        </div>
      </div>

      {showRec && event.recording_url && (
        <div className="mt-8">
          <h3 className="font-display text-lg font-semibold text-white">Session recording</h3>
          <div className="relative mt-3 aspect-video w-full overflow-hidden rounded-2xl border border-white/12 bg-black">
            <iframe src={embedRecording(event.recording_url) || undefined} title="Session recording" allow="autoplay; encrypted-media; fullscreen" allowFullScreen className="absolute inset-0 h-full w-full" />
          </div>
        </div>
      )}
    </div>
  );
}

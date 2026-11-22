"use client";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import { track } from "@/lib/analytics/track";
import {
  JOIN_TIPS, clockSkewMs, interviewCardCopy, istDay, istTimeRange, joinPhase, joinUrl, msToNextPhase, timeLeftText,
  type CardPhase, type MyInterview,
} from "@/lib/vsat/interviews";

/**
 * Student dashboard · the interview card: an icon and heading per state, the campus, the interview time as a
 * date tile with a live countdown, and the Join button (migration 0140, vsat_my_interview()). Copy: interviewCardCopy.
 *
 * The server decides everything by the student's login: which interview, and the meeting link, which it
 * only hands out from 10 minutes before the start until the end. The page follows the server's clock
 * (a wrong phone clock can't open it early) and asks again at each change, so the button opens on time.
 * The campus rule stays: no campus → the campus picker and a locked button.
 */

const RECHECK_NO_LINK_MS = 30_000;
const TICK_MS = 30_000;   // the countdown moves once a minute is close enough; it re-checks with the server at each phase change

// ── icons (24px grid, 1.8 stroke) ──
const I = ({ children, className = "h-5 w-5" }: { children: ReactNode; className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">{children}</svg>
);
const IconBadge = (p: { className?: string }) => <I {...p}><path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z" /><path d="m9 12 2 2 4-4" /></I>;
const IconCalendarCheck = (p: { className?: string }) => <I {...p}><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /><path d="m9 16 2 2 4-4" /></I>;
const IconCalendarX = (p: { className?: string }) => <I {...p}><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /><path d="m14 14-4 4M10 14l4 4" /></I>;
const IconVideo = (p: { className?: string }) => <I {...p}><path d="m16 13 5.22 3.48a.5.5 0 0 0 .78-.42V7.87a.5.5 0 0 0-.75-.43L16 10.5" /><rect x="2" y="6" width="14" height="12" rx="2" /></I>;
const IconDone = (p: { className?: string }) => <I {...p}><circle cx="12" cy="12" r="10" /><path d="m9 12 2 2 4-4" /></I>;
const IconPin = (p: { className?: string }) => <I {...p}><path d="M20 10c0 5-5.54 10.19-7.4 11.8a1 1 0 0 1-1.2 0C9.54 20.19 4 15 4 10a8 8 0 0 1 16 0" /><circle cx="12" cy="10" r="3" /></I>;
const IconAlert = (p: { className?: string }) => <I {...p}><circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" /></I>;
const IconClock = (p: { className?: string }) => <I {...p}><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></I>;
const IconLock = (p: { className?: string }) => <I {...p}><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></I>;
const IconArrow = (p: { className?: string }) => <I {...p}><path d="M5 12h14M12 5l7 7-7 7" /></I>;
const IconMail = (p: { className?: string }) => <I {...p}><rect x="2" y="4" width="20" height="16" rx="2" /><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" /></I>;
const IconMic = (p: { className?: string }) => <I {...p}><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3" /></I>;
const IconQuiet = (p: { className?: string }) => <I {...p}><path d="M11 4.7a.7.7 0 0 0-1.2-.5L6.41 7.59A1.4 1.4 0 0 1 5.42 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.42a1.4 1.4 0 0 1 .99.41l3.39 3.39a.7.7 0 0 0 1.2-.5Z" /><path d="m22 9-6 6M16 9l6 6" /></I>;
const IconBuilding = (p: { className?: string }) => <I {...p}><path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z" /><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2M10 6h4M10 10h4M10 14h4M10 18h4" /></I>;
const IconAny = (p: { className?: string }) => <I {...p}><path d="m18 14 4 4-4 4M18 2l4 4-4 4" /><path d="M2 18h1.97a4 4 0 0 0 3.3-1.7l5.45-7.6a4 4 0 0 1 3.3-1.7H22M2 6h1.97a4 4 0 0 1 3.6 2.2M22 18h-6.04a4 4 0 0 1-3.3-1.8l-.36-.45" /></I>;
const IconChevron = (p: { className?: string }) => <I {...p}><path d="m9 18 6-6-6-6" /></I>;
const IconSpinner = (p: { className?: string }) => <I {...p}><path d="M21 12a9 9 0 1 1-6.22-8.56" /></I>;
const TIP_ICON: Record<(typeof JOIN_TIPS)[number], (p: { className?: string }) => ReactNode> = { "Camera on": IconVideo, "Mic on": IconMic, "Quiet place": IconQuiet };

// ── looks ──
type Tone = "violet" | "live" | "orange" | "green" | "red";
const TILE: Record<Tone, string> = {
  violet: "bg-[#f2ebfd] text-[#8a18ff]",
  // the one bold moment: the interview is live
  live: "bg-[linear-gradient(135deg,#f97d03_0%,#c43ccf_55%,#8a18ff_100%)] text-white shadow-[0_10px_24px_-12px_rgba(196,60,207,0.9)]",
  orange: "bg-[#fff3e6] text-[#f97d03]",
  green: "bg-[#eafaf1] text-[#1f9d57]",
  red: "bg-[#fdecec] text-[#d14343]",
};
const LOOK: Record<CardPhase, { Icon: (p: { className?: string }) => ReactNode; tone: Tone }> = {
  none: { Icon: IconBadge, tone: "violet" },
  upcoming: { Icon: IconCalendarCheck, tone: "violet" },
  open: { Icon: IconVideo, tone: "live" },
  missed: { Icon: IconCalendarX, tone: "orange" },
  ended: { Icon: IconDone, tone: "green" },
  no_campus: { Icon: IconPin, tone: "violet" },
  loading: { Icon: IconCalendarCheck, tone: "violet" },
  error: { Icon: IconAlert, tone: "red" },
};
const locked = "inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#f0edf8] px-5 py-3 text-sm font-semibold text-[#a79fbd] sm:w-auto cursor-not-allowed";
const note = "flex items-start gap-2.5 rounded-xl px-3.5 py-3 text-sm";

function Chip({ tone, children }: { tone: "violet" | "green" | "orange"; children: ReactNode }) {
  const c = tone === "green" ? "bg-[#eafaf1] text-[#17804a]" : tone === "orange" ? "bg-[#fff3e6] text-[#c45f00]" : "bg-[#f2ebfd] text-[#6a12c9]";
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${c}`}>{children}</span>;
}

/** The interview time as a calendar tile + the day, the time range and a status / countdown chip. */
function SlotPanel({ start, dur, chip }: { start: string; dur: number; chip: ReactNode }) {
  const day = istDay(start);
  if (!day) return null;
  return (
    <div className="mt-5 flex items-center gap-4 rounded-2xl border border-[#ece6f7] bg-[#faf8fe] p-3.5">
      <div className="flex w-[58px] shrink-0 flex-col items-center overflow-hidden rounded-xl border border-[#e4dcf3] bg-white text-center shadow-[0_6px_14px_-12px_rgba(43,19,92,0.5)]" aria-hidden="true">
        <span className="w-full bg-[#8a18ff] py-[3px] text-[11px] font-semibold text-white">{day.month}</span>
        <span className="pt-1.5 font-display text-[24px] font-extrabold leading-none text-[#1b1030]">{day.day}</span>
        <span className="pb-1.5 pt-1 text-[11px] font-medium text-[#6c6485]">{day.weekday}</span>
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-display text-[15.5px] font-bold leading-snug text-[#1b1030]">{day.long}</p>
        <p className="mt-0.5 flex items-center gap-1.5 text-[13px] text-[#6c6485]">
          <IconClock className="h-3.5 w-3.5 shrink-0" />{istTimeRange(start, dur)} · {dur} min
        </p>
        <div className="mt-2">{chip}</div>
      </div>
    </div>
  );
}

function Tips() {
  return (
    <ul className="mt-4 flex flex-wrap gap-2" aria-label="Before you join">
      {JOIN_TIPS.map((t) => {
        const Icon = TIP_ICON[t];
        return (
          <li key={t} className="inline-flex items-center gap-1.5 rounded-full border border-[#ece6f7] bg-white px-3 py-1.5 text-xs font-medium text-[#4a4160]">
            <Icon className="h-3.5 w-3.5 text-[#8a18ff]" />{t}
          </li>
        );
      })}
    </ul>
  );
}

export function InterviewCard({ campus, campuses, onPickCampus, picking }:
  { campus: string | null; campuses: readonly string[]; onPickCampus: (c: string) => void; picking: boolean }) {
  const [supabase] = useState(() => createClient());
  const [mi, setMi] = useState<MyInterview | null>(null);
  const [skew, setSkew] = useState(0);
  const [failed, setFailed] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [, setTick] = useState(0);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc("vsat_my_interview");
    if (error || !data) { setFailed(true); return; }
    const d = data as MyInterview;
    setFailed(false);
    setSkew(clockSkewMs(d.now));
    setMi(d);
  }, [supabase]);

  useEffect(() => { void load(); }, [load]);
  // back on the tab (phones sleep timers): ask again
  useEffect(() => {
    const again = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", again);
    return () => document.removeEventListener("visibilitychange", again);
  }, [load]);

  const phase = mi ? joinPhase(mi, Date.now(), skew) : null;
  const link = phase === "open" && mi?.state === "open" ? joinUrl(mi.meet_link) : null;

  // ask the server again when the phase changes (it hands out the link only inside the window),
  // and every 30 s while the window is open but the link isn't ready yet
  useEffect(() => {
    if (!mi) return;
    const next = msToNextPhase(mi, Date.now(), skew);
    const waitLink = phase === "open" && !link ? RECHECK_NO_LINK_MS : null;
    const wait = [next === null ? null : next + 1_000, waitLink].filter((x): x is number => x !== null);
    if (!wait.length) return;
    const t = setTimeout(() => { setTick((n) => n + 1); void load(); }, Math.min(...wait, 2 ** 31 - 1));
    return () => clearTimeout(t);
  }, [mi, skew, phase, link, load]);
  // the countdown
  useEffect(() => {
    if (phase !== "upcoming") return;
    const t = setInterval(() => setTick((n) => n + 1), TICK_MS);
    return () => clearInterval(t);
  }, [phase]);

  const shown: CardPhase = !campus ? "no_campus" : phase ?? (failed ? "error" : "loading");
  const copy = interviewCardCopy(shown, { opensAt: mi?.opens_at, hasLink: !!link });
  const { Icon, tone } = LOOK[shown];
  const dur = mi?.duration_min ?? 30;
  const start = mi?.start && ["upcoming", "open", "missed", "ended"].includes(shown) ? mi.start : null;
  const serverNow = Date.now() + skew;

  async function retry() { setRetrying(true); await load(); setRetrying(false); }

  const chip = shown === "upcoming" && start ? <Chip tone="violet"><IconClock className="h-3.5 w-3.5" />Starts in {timeLeftText(Date.parse(start) - serverNow)}</Chip>
    : shown === "open" ? (
      <Chip tone="green">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#1f9d57] opacity-60 motion-reduce:animate-none" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-[#1f9d57]" />
        </span>
        Live now
      </Chip>
    )
    : shown === "missed" ? <Chip tone="orange">Missed</Chip>
    : shown === "ended" ? <Chip tone="green"><IconDone className="h-3.5 w-3.5" />Completed</Chip>
    : null;

  return (
    <div>
      <header className="flex items-start gap-3.5">
        <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${TILE[tone]}`}>
          {shown === "loading" ? <IconSpinner className="h-5 w-5 animate-spin motion-reduce:animate-none" /> : <Icon className="h-[22px] w-[22px]" />}
        </span>
        <div className="min-w-0 flex-1 pt-0.5">
          <h2 className="font-display text-[19px] font-extrabold leading-tight text-[#1b1030]">{copy.title}</h2>
          {campus
            ? <p className="mt-1 flex items-center gap-1.5 text-[13px] text-[#6c6485]"><IconPin className="h-3.5 w-3.5 shrink-0" /><span className="sr-only">Campus: </span>{campus}</p>
            : <p className="mt-1 text-[13px] text-[#6c6485]">{copy.text}</p>}
        </div>
      </header>

      {shown === "no_campus" && (
        <>
          <div className="mt-5 space-y-2.5">
            {campuses.map((c) => {
              const [name, city] = c.split(" — ");
              const PickIcon = city ? IconBuilding : IconAny;   // a university, or "No preference"
              return (
                <button key={c} type="button" onClick={() => onPickCampus(c)} disabled={picking}
                  className="group flex w-full items-center gap-3 rounded-xl border border-[#e9e4f2] bg-white px-3.5 py-3 text-left transition hover:border-[#8a18ff] hover:bg-[#fcfaff] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8a18ff]/40 disabled:opacity-50">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#f2ebfd] text-[#8a18ff]"><PickIcon className="h-[18px] w-[18px]" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-[#1b1030]">{name}</span>
                    {city && <span className="block text-xs text-[#6c6485]">{city}</span>}
                  </span>
                  <IconChevron className="h-4 w-4 text-[#b4adc4] transition group-hover:translate-x-0.5 group-hover:text-[#8a18ff] motion-reduce:transition-none" />
                </button>
              );
            })}
          </div>
          <button disabled className={`mt-4 ${locked}`}><IconLock className="h-4 w-4" />Join interview (select campus)</button>
        </>
      )}

      {shown === "loading" && (
        <div className="mt-5 flex animate-pulse items-center gap-4 rounded-2xl border border-[#ece6f7] bg-[#faf8fe] p-3.5 motion-reduce:animate-none" aria-label="Loading your interview">
          <div className="h-[74px] w-[58px] rounded-xl bg-[#ece6f7]" />
          <div className="flex-1 space-y-2"><div className="h-3.5 w-2/3 rounded bg-[#ece6f7]" /><div className="h-3 w-1/2 rounded bg-[#ece6f7]" /></div>
        </div>
      )}

      {shown === "error" && (
        <div className={`mt-5 ${note} bg-[#fdf3f3] text-[#7a2e2e]`} role="alert">
          <span className="flex-1">{copy.text}</span>
          <button type="button" onClick={() => void retry()} disabled={retrying}
            className="shrink-0 rounded-lg border border-[#f1caca] bg-white px-3 py-1 text-xs font-semibold text-[#b03a3a] transition hover:border-[#d14343] disabled:opacity-50">
            {retrying ? "Trying…" : "Try again"}
          </button>
        </div>
      )}

      {shown === "none" && (
        <div className={`mt-5 ${note} bg-[#faf8fe] text-[#4a4160]`}><IconMail className="mt-0.5 h-4 w-4 shrink-0 text-[#8a18ff]" />{copy.text}</div>
      )}

      {start && <SlotPanel start={start} dur={dur} chip={chip} />}

      {shown === "upcoming" && (
        <>
          <div className="mt-4 flex flex-col gap-2.5 sm:flex-row sm:items-center">
            <button disabled className={locked}><IconLock className="h-4 w-4" />Join interview</button>
            <p className="text-xs text-[#6c6485]">{copy.text}</p>
          </div>
          <Tips />
        </>
      )}

      {shown === "open" && (
        <>
          {link ? (
            <a href={link} target="_blank" rel="noopener noreferrer" onClick={() => track("vsat_join_interview")}
              className="group mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[linear-gradient(100deg,#f97d03_0%,#c43ccf_55%,#8a18ff_100%)] px-6 py-3 text-sm font-semibold text-white shadow-[0_10px_24px_-12px_rgba(196,60,207,0.9)] transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8a18ff]/50 focus-visible:ring-offset-2 sm:w-auto">
              <IconVideo className="h-4 w-4" />Join interview
              <IconArrow className="h-4 w-4 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" />
            </a>
          ) : (
            <div className="mt-4 flex flex-col gap-2.5 sm:flex-row sm:items-center">
              <button disabled className={locked}><IconSpinner className="h-4 w-4 animate-spin motion-reduce:animate-none" />Getting your link</button>
              <p className="text-xs text-[#6c6485]">{copy.text}</p>
            </div>
          )}
          <Tips />
        </>
      )}

      {shown === "missed" && (
        <div className={`mt-4 ${note} bg-[#fff7ee] text-[#8a4a00]`}><IconAlert className="mt-0.5 h-4 w-4 shrink-0 text-[#f97d03]" />{copy.text}</div>
      )}
      {shown === "ended" && (
        <div className={`mt-4 ${note} bg-[#faf8fe] text-[#4a4160]`}><IconMail className="mt-0.5 h-4 w-4 shrink-0 text-[#8a18ff]" />{copy.text}</div>
      )}
    </div>
  );
}

"use client";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { track } from "@/lib/analytics/track";
import { clockSkewMs, istDate, istTime, istTimeRange, joinPhase, joinUrl, msToNextPhase, type MyInterview } from "@/lib/vsat/interviews";

/**
 * Student dashboard · the interview time and the Join button (migration 0140, vsat_my_interview()).
 *
 * The server decides everything by the student's login: which interview, and the meeting link, which it
 * only hands out from 10 minutes before the start until the end. The page follows the server's clock
 * (a wrong phone clock can't open it early) and asks again at each change, so the button opens on time.
 * The campus rule stays: no campus → the button is locked (the dashboard shows the campus picker).
 */

const btn = "inline-flex items-center justify-center gap-2 rounded-xl bg-[#8a18ff] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#7312e0] disabled:opacity-50";
const locked = "inline-flex items-center justify-center rounded-xl bg-[#f0edf8] px-5 py-2.5 text-sm font-semibold text-[#b4adc4] cursor-not-allowed";
const RECHECK_NO_LINK_MS = 30_000;

export function InterviewJoin({ campusChosen }: { campusChosen: boolean }) {
  const [supabase] = useState(() => createClient());
  const [mi, setMi] = useState<MyInterview | null>(null);
  const [skew, setSkew] = useState(0);
  const [failed, setFailed] = useState(false);
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

  if (!campusChosen) return <button disabled className={`mt-4 ${locked}`}>🔒 Join interview (select campus)</button>;
  if (failed && !mi) return <p className="mt-4 text-sm text-[#6c6485]">We couldn&apos;t load your interview time. Refresh the page in a moment.</p>;
  if (!mi || !phase) return <button disabled className={`mt-4 ${locked}`}>Join interview</button>;

  if (phase === "none") {
    return <p className="mt-4 text-sm text-[#6c6485]">Your interview time will show here once the admissions team books it. You&apos;ll also get an email.</p>;
  }
  const when = mi.start ? `${istDate(mi.start)} · ${istTimeRange(mi.start, mi.duration_min)}` : "";
  return (
    <div className="mt-4 space-y-3">
      {when && (
        <p className="rounded-xl border border-[#e9e4f2] bg-[#faf8fe] px-4 py-3 text-sm">
          <span className="block text-xs text-[#6c6485]">Your interview</span>
          <b className="text-[#1b1030]">{when}</b>
        </p>
      )}
      {phase === "upcoming" && (
        <>
          <button disabled className={locked}>Join interview</button>
          <p className="text-xs text-[#6c6485]">The Join button opens at {istTime(mi.opens_at)} IST, 10 minutes before the start. Please join from a quiet place with your camera and microphone on.</p>
        </>
      )}
      {phase === "open" && (link
        ? <a href={link} target="_blank" rel="noopener noreferrer" className={btn} onClick={() => track("vsat_join_interview")}>Join interview</a>
        : (
          <>
            <button disabled className={locked}>Join interview</button>
            <p className="text-xs text-[#6c6485]">Your meeting link is being prepared. This page checks again every 30 seconds; you can also use the link in your email.</p>
          </>
        ))}
      {phase === "ended" && <p className="text-sm text-[#6c6485]">Your interview time has passed. The admissions team will share the result with you.</p>}
      {phase === "missed" && <p className="text-sm text-[#b26a00]">It looks like you missed your interview. The admissions team will contact you about a new time.</p>}
    </div>
  );
}

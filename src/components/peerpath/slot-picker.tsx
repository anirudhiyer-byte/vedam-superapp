"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Duration, SessionType } from "@/lib/peerpath/constants";
import type { Slot } from "@/lib/peerpath/types";
import { fmtTime, istDateKey, nextDays } from "@/lib/peerpath/slots";
import { ttsPath } from "@/lib/peerpath/constants";

export function SlotPicker({ seniorId, slots, sessionTypes, durations, reschedule }: { seniorId: string; slots: Slot[]; sessionTypes: SessionType[]; durations: Duration[]; reschedule?: string | null }) {
  const router = useRouter();
  const days = nextDays(14);
  const byDay = useMemo(() => {
    const m = new Map<string, Slot[]>();
    for (const s of slots) {
      const k = istDateKey(new Date(s.start));
      m.set(k, [...(m.get(k) ?? []), s]);
    }
    return m;
  }, [slots]);

  const firstDay = days.find((d) => byDay.has(d.key))?.key ?? days[0].key;
  const [day, setDay] = useState(firstDay);
  const [type, setType] = useState<SessionType | "all">("all");
  const [picked, setPicked] = useState<Slot | null>(null);
  const [duration, setDuration] = useState<Duration>(durations.includes(30) ? 30 : 15);

  const list = (byDay.get(day) ?? []).filter((s) => type === "all" || s.type === type);

  const go = () => {
    if (!picked) return;
    const q = new URLSearchParams({ senior: seniorId, start: picked.start, type: picked.type, duration: String(picked.type === "Group" ? 30 : duration) });
    if (reschedule) q.set("r", reschedule);
    router.push(ttsPath.book(q));
  };

  if (slots.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-pp-line p-6 text-center text-[15px] text-pp-muted">
        No free times in the next two weeks. Please check again later or pick another senior.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {sessionTypes.length > 1 && (
        <div role="group" aria-label="Session type" className="grid grid-cols-3 gap-1 rounded-xl bg-pp-soft p-1">
          {(["all", "1:1", "Group"] as const).map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={type === t}
              onClick={() => {
                setType(t);
                setPicked(null);
              }}
              className={`min-h-[40px] rounded-lg text-[14px] font-semibold transition ${type === t ? "bg-pp-card text-pp-heading shadow-sm" : "text-pp-muted"}`}
            >
              {t === "all" ? "All" : t === "1:1" ? "1:1" : "Group"}
            </button>
          ))}
        </div>
      )}

      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {days.map((d) => {
          const has = byDay.has(d.key);
          const on = d.key === day;
          return (
            <button
              key={d.key}
              type="button"
              disabled={!has}
              aria-pressed={on}
              aria-label={`${d.dow} ${d.date} ${d.month}${has ? "" : ", no free times"}`}
              onClick={() => {
                setDay(d.key);
                setPicked(null);
              }}
              className={`flex min-h-[64px] w-[60px] flex-none flex-col items-center justify-center gap-0.5 rounded-xl border text-center transition ${
                on ? "border-pp-violet-500 bg-pp-violet-500 text-white" : has ? "border-pp-line bg-pp-card text-pp-ink hover:border-pp-violet-200" : "border-transparent bg-pp-soft text-[#6f6886]"
              }`}
            >
              <span className="text-[12px] font-medium">{d.dow}</span>
              <span className="text-[18px] font-bold leading-none">{d.date}</span>
              <span className="text-[11px] opacity-80">{d.month}</span>
            </button>
          );
        })}
      </div>

      {list.length === 0 ? (
        <p className="rounded-xl border border-dashed border-pp-line p-5 text-center text-[14px] text-pp-muted">No free times on this day. Try another day.</p>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {list.map((s) => {
            const on = picked?.start === s.start && picked.type === s.type;
            return (
              <button
                key={s.start + s.type}
                type="button"
                aria-pressed={on}
                onClick={() => setPicked(s)}
                className={`flex min-h-[48px] flex-col items-center justify-center rounded-xl border px-2 text-[14px] font-semibold transition ${
                  on ? "border-pp-violet-500 bg-pp-violet-500 text-white" : "border-pp-violet-200 bg-pp-card text-pp-violet-700 hover:border-pp-violet-500 hover:bg-pp-violet-50"
                }`}
              >
                {fmtTime(s.start)}
                {s.type === "Group" && <span className={`text-[11px] font-medium ${on ? "text-white/85" : "text-pp-muted"}`}>Group · {s.seatsLeft} seats left</span>}
              </button>
            );
          })}
        </div>
      )}

      {picked && picked.type === "1:1" && durations.length > 1 && (
        <div role="group" aria-label="Duration" className="flex gap-2">
          {durations
            .slice()
            .sort()
            .map((d) => (
              <button key={d} type="button" aria-pressed={duration === d} onClick={() => setDuration(d)} className={`pp-chip flex-1 justify-center ${duration === d ? "pp-chip-on" : ""}`}>
                {d} min
              </button>
            ))}
        </div>
      )}

      <button type="button" className="pp-btn-primary w-full" disabled={!picked} onClick={go}>
        {picked ? `Continue · ${fmtTime(picked.start)}` : "Pick a time to continue"}
      </button>
    </div>
  );
}

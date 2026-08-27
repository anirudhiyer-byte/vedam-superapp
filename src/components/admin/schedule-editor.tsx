"use client";

import type { ScheduleDay } from "@/lib/events";

const input = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-[color:rgb(var(--accent))]";
const mini = "rounded-md border border-border px-2 py-1 text-xs font-medium text-muted hover:text-foreground";

export function ScheduleEditor({ value, onChange }: { value: ScheduleDay[]; onChange: (v: ScheduleDay[]) => void }) {
  const days = value && value.length ? value : [{ date: "", slots: [{ start: "", end: "" }] }];
  const updDay = (i: number, patch: Partial<ScheduleDay>) => onChange(days.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  const updSlot = (di: number, si: number, patch: { start?: string; end?: string }) =>
    updDay(di, { slots: (days[di].slots || []).map((s, j) => (j === si ? { ...s, ...patch } : s)) });
  const addSlot = (di: number) => updDay(di, { slots: [...(days[di].slots || []), { start: "", end: "" }] });
  const delSlot = (di: number, si: number) => updDay(di, { slots: (days[di].slots || []).filter((_, j) => j !== si) });
  const addDay = () => onChange([...days, { date: "", slots: [{ start: "", end: "" }] }]);
  const delDay = (di: number) => onChange(days.filter((_, j) => j !== di));

  return (
    <div className="space-y-3">
      {days.map((d, di) => (
        <div key={di} className="rounded-xl border border-border bg-background p-3">
          <div className="flex items-end gap-3">
            <label className="block flex-1">
              <span className="mb-1 block font-body text-xs font-semibold text-foreground">Date *</span>
              <input type="date" className={input} value={d.date || ""} onChange={(e) => updDay(di, { date: e.target.value })} />
            </label>
            {days.length > 1 && <button type="button" className="rounded-md border border-red-400/40 px-2 py-1.5 text-xs text-red-500" onClick={() => delDay(di)}>Remove</button>}
          </div>
          {(d.slots || []).map((s, si) => (
            <div key={si} className="mt-2 flex items-end gap-2">
              <label className="block flex-1">
                <span className="mb-1 block font-body text-[11px] text-muted">Start</span>
                <input type="time" className={input} value={s.start || ""} onChange={(e) => updSlot(di, si, { start: e.target.value })} />
              </label>
              <label className="block flex-1">
                <span className="mb-1 block font-body text-[11px] text-muted">End</span>
                <input type="time" className={input} value={s.end || ""} onChange={(e) => updSlot(di, si, { end: e.target.value })} />
              </label>
              {(d.slots || []).length > 1 && <button type="button" className={mini} onClick={() => delSlot(di, si)}>✕</button>}
            </div>
          ))}
          <button type="button" className={mini + " mt-2"} onClick={() => addSlot(di)}>+ Add slot</button>
        </div>
      ))}
      <button type="button" className="rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-surface-warm" onClick={addDay}>+ Add date</button>
    </div>
  );
}

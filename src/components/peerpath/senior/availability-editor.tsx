"use client";

import { useState } from "react";
import type { SessionType } from "@/lib/peerpath/constants";
import type { AvailabilityRule, DateBlock, SeniorSettings } from "@/lib/peerpath/types";
import { saveTimes } from "@/lib/peerpath/client";
import { IconPlus, IconTrash } from "@/components/peerpath/icons";

const DAYS = [
  { n: 1, label: "Monday" },
  { n: 2, label: "Tuesday" },
  { n: 3, label: "Wednesday" },
  { n: 4, label: "Thursday" },
  { n: 5, label: "Friday" },
  { n: 6, label: "Saturday" },
  { n: 0, label: "Sunday" },
];

const TIMES = Array.from({ length: 33 }, (_, i) => {
  const mins = 7 * 60 + i * 30; // 07:00 → 23:00
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const v = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  const label = `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
  return { v, label };
});

type Props = {
  token: string;
  initialRules: AvailabilityRule[];
  initialBlocks: DateBlock[];
  initialSettings: SeniorSettings;
};

export function AvailabilityEditor({ token, initialRules, initialBlocks, initialSettings }: Props) {
  const [rules, setRules] = useState<AvailabilityRule[]>(initialRules);
  const [blocks, setBlocks] = useState<DateBlock[]>(initialBlocks);
  const [settings, setSettings] = useState<SeniorSettings>(initialSettings);
  const [newBlock, setNewBlock] = useState<DateBlock>({ from: "", to: "", reason: "" });
  const [status, setStatus] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const add = (weekday: number) => setRules((r) => [...r, { weekday, from: "18:00", to: "19:00", type: "1:1" }]);
  const update = (i: number, patch: Partial<AvailabilityRule>) => setRules((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const remove = (i: number) => setRules((r) => r.filter((_, j) => j !== i));
  const copyMonday = () => {
    const mon = rules.filter((r) => r.weekday === 1);
    if (!mon.length) return;
    setRules((r) => [...r.filter((x) => x.weekday === 1 || x.weekday === 0 || x.weekday === 6), ...[2, 3, 4, 5].flatMap((d) => mon.map((m) => ({ ...m, weekday: d })))]);
  };

  const invalid = rules.some((r) => r.to <= r.from);

  async function save() {
    if (invalid) {
      setStatus({ kind: "err", msg: "An end time is before its start time. Please fix it." });
      return;
    }
    setBusy(true);
    setStatus(null);
    const res = await saveTimes(token, rules, blocks, settings);
    setBusy(false);
    setStatus(res.ok ? { kind: "ok", msg: settings.paused ? "Saved. You are paused, so no new bookings." : "Saved. Applicants can now book these times." } : { kind: "err", msg: res.message });
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="pp-card p-5 sm:p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-[18px] font-semibold text-pp-heading">Weekly times</h2>
            <p className="text-[14px] text-pp-muted">Times repeat every week, in IST. Applicants see 30-min slots inside these blocks.</p>
          </div>
          <button type="button" className="pp-btn-secondary" onClick={copyMonday} disabled={!rules.some((r) => r.weekday === 1)}>
            Copy Monday to Tue–Fri
          </button>
        </div>

        <ul className="divide-y divide-pp-line">
          {DAYS.map((d) => {
            const list = rules.map((r, i) => ({ r, i })).filter(({ r }) => r.weekday === d.n);
            return (
              <li key={d.n} className="grid gap-3 py-4 sm:grid-cols-[130px_1fr] sm:items-start">
                <p className="pt-2.5 text-[15px] font-semibold text-pp-heading">{d.label}</p>
                <div className="flex flex-col gap-2">
                  {list.length === 0 && <p className="pt-2.5 text-[14px] text-pp-muted">Not available</p>}
                  {list.map(({ r, i }) => (
                    <div key={i} className="flex flex-wrap items-center gap-2">
                      <label className="sr-only" htmlFor={`from-${i}`}>From</label>
                      <select id={`from-${i}`} className="pp-field w-[120px] min-h-[44px]" value={r.from} onChange={(e) => update(i, { from: e.target.value })}>
                        {TIMES.map((t) => (
                          <option key={t.v} value={t.v}>{t.label}</option>
                        ))}
                      </select>
                      <span className="text-pp-muted">to</span>
                      <label className="sr-only" htmlFor={`to-${i}`}>To</label>
                      <select id={`to-${i}`} className={`pp-field w-[120px] min-h-[44px] ${r.to <= r.from ? "border-[#FF7A6E]" : ""}`} value={r.to} onChange={(e) => update(i, { to: e.target.value })}>
                        {TIMES.map((t) => (
                          <option key={t.v} value={t.v}>{t.label}</option>
                        ))}
                      </select>
                      <label className="sr-only" htmlFor={`type-${i}`}>Session type</label>
                      <select id={`type-${i}`} className="pp-field w-[120px] min-h-[44px]" value={r.type} onChange={(e) => update(i, { type: e.target.value as SessionType })}>
                        <option value="1:1">1:1</option>
                        <option value="Group">Group</option>
                      </select>
                      <button type="button" aria-label={`Remove ${d.label} time`} onClick={() => remove(i)} className="grid h-11 w-11 place-items-center rounded-xl text-pp-muted hover:bg-[#2a1212] hover:text-[#FF7A6E]">
                        <IconTrash />
                      </button>
                    </div>
                  ))}
                  <button type="button" onClick={() => add(d.n)} className="inline-flex min-h-[40px] items-center gap-1.5 self-start text-[14px] font-semibold text-pp-violet-600 hover:text-pp-violet-700">
                    <IconPlus /> Add time
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="pp-card p-5 sm:p-6">
        <h2 className="text-[18px] font-semibold text-pp-heading">Days off</h2>
        <p className="mb-4 text-[14px] text-pp-muted">Exams, travel or a break. No one can book you on these dates.</p>
        {blocks.length > 0 && (
          <ul className="mb-4 flex flex-col gap-2">
            {blocks.map((b, i) => (
              <li key={i} className="flex items-center justify-between gap-3 rounded-xl bg-pp-soft px-4 py-3 text-[14px]">
                <span>
                  <b className="font-semibold text-pp-heading">{b.from === b.to ? b.from : `${b.from} → ${b.to}`}</b>
                  {b.reason ? <span className="text-pp-muted"> · {b.reason}</span> : null}
                </span>
                <button type="button" aria-label="Remove day off" onClick={() => setBlocks((x) => x.filter((_, j) => j !== i))} className="grid h-10 w-10 place-items-center rounded-lg text-pp-muted hover:text-[#FF7A6E]">
                  <IconTrash />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_1.4fr_auto] sm:items-end">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="block-from" className="pp-label">From</label>
            <input id="block-from" type="date" className="pp-field" value={newBlock.from} onChange={(e) => setNewBlock({ ...newBlock, from: e.target.value, to: newBlock.to || e.target.value })} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="block-to" className="pp-label">To</label>
            <input id="block-to" type="date" className="pp-field" value={newBlock.to} min={newBlock.from} onChange={(e) => setNewBlock({ ...newBlock, to: e.target.value })} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="block-reason" className="pp-label">Reason <span className="font-normal text-pp-muted">(optional)</span></label>
            <input id="block-reason" className="pp-field" placeholder="e.g. Mid-sem exams" value={newBlock.reason ?? ""} onChange={(e) => setNewBlock({ ...newBlock, reason: e.target.value })} />
          </div>
          <button
            type="button"
            className="pp-btn-secondary"
            disabled={!newBlock.from || !newBlock.to || newBlock.to < newBlock.from}
            onClick={() => {
              setBlocks((b) => [...b, { ...newBlock, reason: newBlock.reason?.trim() || null }]);
              setNewBlock({ from: "", to: "", reason: "" });
            }}
          >
            <IconPlus /> Add
          </button>
        </div>
      </section>

      <section className="pp-card p-5 sm:p-6">
        <h2 className="text-[18px] font-semibold text-pp-heading">Limits</h2>
        <p className="mb-4 text-[14px] text-pp-muted">Protect your time. Slots disappear once a limit is reached.</p>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="daily" className="pp-label">Max chats per day</label>
            <select id="daily" className="pp-field" value={settings.dailyCap} onChange={(e) => setSettings({ ...settings, dailyCap: Number(e.target.value) })}>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="weekly" className="pp-label">Max chats per week</label>
            <select id="weekly" className="pp-field" value={settings.weeklyCap} onChange={(e) => setSettings({ ...settings, weeklyCap: Number(e.target.value) })}>
              {[1, 2, 3, 4, 5, 6, 8, 10].map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="notice" className="pp-label">Book me at least</label>
            <select id="notice" className="pp-field" value={settings.minNoticeHours} onChange={(e) => setSettings({ ...settings, minNoticeHours: Number(e.target.value) })}>
              {[12, 24, 48].map((n) => (
                <option key={n} value={n}>{n} hours before</option>
              ))}
            </select>
          </div>
        </div>
        <label className="mt-5 flex items-start gap-3 rounded-xl border border-pp-line p-4">
          <input type="checkbox" className="mt-0.5 h-5 w-5 flex-none accent-pp-violet-500" checked={settings.paused} onChange={(e) => setSettings({ ...settings, paused: e.target.checked })} />
          <span>
            <span className="block text-[15px] font-semibold text-pp-heading">Pause me</span>
            <span className="text-[14px] text-pp-muted">Hide all my times for now. Booked chats stay as they are.</span>
          </span>
        </label>
      </section>

      <div className="sticky bottom-0 z-10 -mx-4 flex flex-col gap-2 border-t border-pp-line bg-pp-card/95 px-4 py-4 backdrop-blur sm:mx-0 sm:flex-row sm:items-center sm:rounded-2xl sm:border">
        <button type="button" className="pp-btn-primary sm:px-10" onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Save my times"}
        </button>
        {status && (
          <p role="status" className={`text-[14px] font-medium ${status.kind === "ok" ? "text-[#4ADE80]" : "text-[#FF7A6E]"}`}>
            {status.msg}
          </p>
        )}
      </div>
    </div>
  );
}

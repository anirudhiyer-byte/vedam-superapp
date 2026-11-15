"use client";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type DateRow = {
  id: string; label: string; testId: string; examDate: string;
  startAt: string; endAt: string; leadMinutes: number; capacity: number | null;
  enabled: boolean; picked: number;
};
type Draft = { id?: string; label: string; testId: string; examDate: string; startTime: string; endTime: string; leadMinutes: number; capacity: string };

const input = "w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 focus:border-[#00cfe5] focus:outline-none";
const btn = "rounded-lg px-4 py-2 text-sm font-semibold";
const ist = (iso: string) => new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" });

const emptyDraft = (): Draft => ({ label: "", testId: "", examDate: "", startTime: "", endTime: "", leadMinutes: 15, capacity: "" });

export function VsatExamDates() {
  const [supabase] = useState(() => createClient());
  const [rows, setRows] = useState<DateRow[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.rpc("vsat_exam_dates_admin_list");
    if (data?.ok) setRows((data.dates as DateRow[]) ?? []);
    else setMsg(data?.code === "FORBIDDEN" ? "Admins only." : "Couldn't load dates.");
    setLoading(false);
  }, [supabase]);
  useEffect(() => { void load(); }, [load]);

  async function save() {
    if (!draft) return;
    if (!draft.label.trim() || !draft.testId.trim() || !draft.examDate || !draft.startTime || !draft.endTime) {
      return setMsg("Fill label, test ID, date, start and end time.");
    }
    // build unambiguous IST timestamps (exam is always in IST)
    const startAt = `${draft.examDate}T${draft.startTime}:00+05:30`;
    const endAt = `${draft.examDate}T${draft.endTime}:00+05:30`;
    setBusy(true); setMsg("");
    const p: Record<string, unknown> = {
      label: draft.label.trim(), testId: draft.testId.trim(), examDate: draft.examDate,
      startAt, endAt, leadMinutes: Number(draft.leadMinutes) || 15,
    };
    if (draft.capacity.trim() !== "") p.capacity = Number(draft.capacity);
    if (draft.id) p.id = draft.id;
    const { data } = await supabase.rpc("vsat_exam_date_upsert", { p });
    setBusy(false);
    if (!data?.ok) return setMsg(data?.code === "BAD_WINDOW" ? "End time must be after start time." : data?.code || "Save failed.");
    setMsg("Saved ✓"); setDraft(null); void load();
  }

  async function toggle(id: string, enabled: boolean) {
    setBusy(true); setMsg("");
    const { data } = await supabase.rpc("vsat_exam_date_set_enabled", { p: { id, enabled } });
    setBusy(false);
    if (!data?.ok) return setMsg(data?.code || "Couldn't update.");
    setMsg(enabled ? "Date is now live for applicants to select." : "Date hidden from applicants.");
    void load();
  }

  function editRow(r: DateRow) {
    setMsg("");
    setDraft({ id: r.id, label: r.label, testId: r.testId, examDate: r.examDate, startTime: hhmm(r.startAt), endTime: hhmm(r.endAt), leadMinutes: r.leadMinutes, capacity: r.capacity == null ? "" : String(r.capacity) });
  }

  if (loading) return <div className="p-10 text-white/50">Loading…</div>;

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold">VSAT Exam dates</h1>
          <p className="mt-1 text-sm text-white/50">Lock a Wheebox test ID to each date + window. Enabled dates appear for paid applicants to select; the Start-exam button goes live inside the window.</p>
        </div>
        {!draft && <button onClick={() => setDraft(emptyDraft())} className={`${btn} bg-gradient-to-r from-[#00cfe5] to-[#c200db] text-white`}>+ New date</button>}
      </div>
      {msg && <p className="mt-4 text-sm text-[#00cfe5]">{msg}</p>}

      {draft ? (
        <div className="mt-6 rounded-xl border border-white/10 bg-white/5 p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block"><span className="mb-1 block text-xs text-white/50">Label</span><input value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} placeholder="VSAT — 20 Nov slot" className={input} /></label>
            <label className="block"><span className="mb-1 block text-xs text-white/50">Wheebox test ID</span><input value={draft.testId} onChange={(e) => setDraft({ ...draft, testId: e.target.value })} placeholder="e.g. 34073" className={input} /></label>
            <label className="block"><span className="mb-1 block text-xs text-white/50">Exam date (IST)</span><input type="date" value={draft.examDate} onChange={(e) => setDraft({ ...draft, examDate: e.target.value })} className={input} /></label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block"><span className="mb-1 block text-xs text-white/50">Start (IST)</span><input type="time" value={draft.startTime} onChange={(e) => setDraft({ ...draft, startTime: e.target.value })} className={input} /></label>
              <label className="block"><span className="mb-1 block text-xs text-white/50">End (IST)</span><input type="time" value={draft.endTime} onChange={(e) => setDraft({ ...draft, endTime: e.target.value })} className={input} /></label>
            </div>
            <label className="block"><span className="mb-1 block text-xs text-white/50">Clickable lead (mins before start)</span><input type="number" value={draft.leadMinutes} onChange={(e) => setDraft({ ...draft, leadMinutes: Number(e.target.value) })} className={input} /></label>
            <label className="block"><span className="mb-1 block text-xs text-white/50">Capacity (optional)</span><input type="number" value={draft.capacity} onChange={(e) => setDraft({ ...draft, capacity: e.target.value })} placeholder="unlimited" className={input} /></label>
          </div>
          <div className="mt-5 flex gap-2">
            <button onClick={save} disabled={busy} className={`${btn} bg-gradient-to-r from-[#00cfe5] to-[#c200db] text-white`}>{busy ? "Saving…" : "Save date"}</button>
            <button onClick={() => { setDraft(null); setMsg(""); }} className={`${btn} border border-white/15 text-white`}>Cancel</button>
          </div>
        </div>
      ) : (
        <div className="mt-6 space-y-3">
          {rows.length === 0 && <p className="text-sm text-white/40">No exam dates yet.</p>}
          {rows.map((r) => (
            <div key={r.id} className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 p-4">
              <div>
                <p className="font-semibold">{r.label} {r.enabled && <span className="ml-2 rounded-full bg-[#16a34a]/20 px-2 py-0.5 text-xs text-[#4ade80]">LIVE</span>}</p>
                <p className="text-xs text-white/40">{ist(r.startAt)} – {hhmm(r.endAt)} · test {r.testId} · clickable {r.leadMinutes}m early · {r.picked} picked{r.capacity != null ? ` / ${r.capacity}` : ""}</p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => editRow(r)} disabled={busy} className={`${btn} border border-white/15 text-white`}>Edit</button>
                {r.enabled
                  ? <button onClick={() => toggle(r.id, false)} disabled={busy} className={`${btn} border border-white/15 text-white`}>Disable</button>
                  : <button onClick={() => toggle(r.id, true)} disabled={busy} className={`${btn} bg-[#16a34a] text-white`}>Enable</button>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

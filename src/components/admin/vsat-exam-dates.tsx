"use client";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { cx, vx } from "@/components/admin/ui/vx";

type DateRow = {
  id: string; label: string; testId: string; testName: string | null; domainName: string | null; examDate: string;
  startAt: string; endAt: string; leadMinutes: number; capacity: number | null;
  enabled: boolean; picked: number;
};
type Draft = { id?: string; label: string; testId: string; testName: string; domainName: string; examDate: string; startTime: string; endTime: string; leadMinutes: number; capacity: string };

const input = vx.input;
const ist = (iso: string) => new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" });

const emptyDraft = (): Draft => ({ label: "", testId: "", testName: "", domainName: "", examDate: "", startTime: "", endTime: "", leadMinutes: 15, capacity: "" });

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
      testName: draft.testName.trim(), domainName: draft.domainName.trim(),
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

  // Pull every student's REAL-exam Wheebox result for this VSAT date, mapped to each student.
  // Resumable: the route does up to ~40 per call, so we loop until nothing remains. (Mock results
  // are pulled separately from the Exam Center — the mock isn't tied to a date.)
  async function pullResults(id: string, label: string) {
    setBusy(true); setMsg(`Pulling results for ${label}…`);
    let pulled = 0, guard = 0;
    try {
      while (guard++ < 200) {
        const res = await fetch("/api/vsat/exam/bulk-pull-result", {
          method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
          body: JSON.stringify({ exam_date_id: id }),
        });
        const d = await res.json().catch(() => ({}));
        if (!d?.ok) { setMsg(d?.code === "WHEEBOX_NOT_CONFIGURED" ? "Wheebox isn't connected (set the env keys in the Exam Center)." : d?.code === "FORBIDDEN" ? "Admins only." : d?.code === "DATE_UNAVAILABLE" ? "This date has no Wheebox test ID." : "Couldn't pull results."); break; }
        pulled += d.pulled || 0;
        if (d.total === 0) { setMsg(`${label}: no applicants are assigned to this VSAT yet.`); break; }
        // Keep going only while each pass stores new results. A pass that pulls nothing but still
        // has "remaining" means those students have no result to fetch (not submitted) — stop.
        if (d.remaining && d.pulled > 0) { setMsg(`Pulling results for ${label}: ${pulled} done, ${d.remaining} to go…`); continue; }
        const left = d.remaining || 0;
        setMsg(`${label}: pulled ${pulled} result${pulled === 1 ? "" : "s"}${left ? `. ${left} still have no result (not submitted yet) — run again later.` : ". ✓"}`); break;
      }
    } catch { setMsg("Couldn’t reach the server while pulling results."); }
    setBusy(false); void load();
  }

  function editRow(r: DateRow) {
    setMsg("");
    setDraft({ id: r.id, label: r.label, testId: r.testId, testName: r.testName ?? "", domainName: r.domainName ?? "", examDate: r.examDate, startTime: hhmm(r.startAt), endTime: hhmm(r.endAt), leadMinutes: r.leadMinutes, capacity: r.capacity == null ? "" : String(r.capacity) });
  }

  if (loading) return <div className="p-10 text-vx-faint">Loading…</div>;

  return (
    <div className="mx-auto w-full max-w-[880px] px-4 py-6 font-sans sm:px-8 sm:py-10 pt-0 sm:pt-0">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-sans text-[26px] font-semibold leading-tight tracking-[-0.025em] text-vx-ink sm:text-[30px]">VSAT Exam dates</h1>
          <p className="mt-1 text-sm text-vx-faint">Lock a Wheebox test ID to each date + window. Enabled dates appear for paid applicants to select; the Start-exam button goes live inside the window.</p>
        </div>
        {!draft && <button onClick={() => setDraft(emptyDraft())} className={cx(vx.btn, vx.cta)}>+ New date</button>}
      </div>
      {msg && <p className="mt-4 text-sm text-vx-violet-t">{msg}</p>}

      {draft ? (
        <div className="mt-6 rounded-xl border border-vx-line bg-white/5 p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block"><span className="mb-1 block text-xs text-vx-faint">Label</span><input value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} placeholder="VSAT — 20 Nov slot" className={input} /></label>
            <label className="block"><span className="mb-1 block text-xs text-vx-faint">Wheebox test ID</span><input value={draft.testId} onChange={(e) => setDraft({ ...draft, testId: e.target.value })} placeholder="e.g. 169872" className={input} /></label>
            <label className="block"><span className="mb-1 block text-xs text-vx-faint">Wheebox test name <span className="opacity-60">(for results)</span></span><input value={draft.testName} onChange={(e) => setDraft({ ...draft, testName: e.target.value })} placeholder="e.g. VSAT" className={input} /></label>
            <label className="block"><span className="mb-1 block text-xs text-vx-faint">Wheebox domain name <span className="opacity-60">(for results)</span></span><input value={draft.domainName} onChange={(e) => setDraft({ ...draft, domainName: e.target.value })} placeholder="e.g. April 2026" className={input} /></label>
            <label className="block"><span className="mb-1 block text-xs text-vx-faint">Exam date (IST)</span><input type="date" value={draft.examDate} onChange={(e) => setDraft({ ...draft, examDate: e.target.value })} className={input} /></label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block"><span className="mb-1 block text-xs text-vx-faint">Start (IST)</span><input type="time" value={draft.startTime} onChange={(e) => setDraft({ ...draft, startTime: e.target.value })} className={input} /></label>
              <label className="block"><span className="mb-1 block text-xs text-vx-faint">End (IST)</span><input type="time" value={draft.endTime} onChange={(e) => setDraft({ ...draft, endTime: e.target.value })} className={input} /></label>
            </div>
            <label className="block"><span className="mb-1 block text-xs text-vx-faint">Clickable lead (mins before start)</span><input type="number" value={draft.leadMinutes} onChange={(e) => setDraft({ ...draft, leadMinutes: Number(e.target.value) })} className={input} /></label>
            <label className="block"><span className="mb-1 block text-xs text-vx-faint">Capacity (optional)</span><input type="number" value={draft.capacity} onChange={(e) => setDraft({ ...draft, capacity: e.target.value })} placeholder="unlimited" className={input} /></label>
          </div>
          <div className="mt-5 flex gap-2">
            <button onClick={save} disabled={busy} className={cx(vx.btn, vx.cta)}>{busy ? "Saving…" : "Save date"}</button>
            <button onClick={() => { setDraft(null); setMsg(""); }} className={cx(vx.btn, vx.secondary)}>Cancel</button>
          </div>
        </div>
      ) : (
        <div className="mt-6 space-y-3">
          {rows.length === 0 && <p className="text-sm text-vx-faint">No exam dates yet.</p>}
          {rows.map((r) => (
            <div key={r.id} className="flex items-center justify-between rounded-xl border border-vx-line bg-white/5 p-4">
              <div>
                <p className="font-semibold">{r.label} {r.enabled && <span className="ml-2 rounded-full bg-vx-green/20 px-2 py-0.5 text-xs text-vx-green">LIVE</span>}</p>
                <p className="text-xs text-vx-faint">{ist(r.startAt)} – {hhmm(r.endAt)} · test {r.testId}{r.testName ? ` (${r.testName}${r.domainName ? ` · ${r.domainName}` : ""})` : ""} · clickable {r.leadMinutes}m early · {r.picked} picked{r.capacity != null ? ` / ${r.capacity}` : ""}</p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => pullResults(r.id, r.label)} disabled={busy} className={cx(vx.btn, vx.secondary)} title="Fetch every student's real-exam Wheebox result for this VSAT date and map it to each student">Pull results</button>
                <button onClick={() => editRow(r)} disabled={busy} className={cx(vx.btn, vx.secondary)}>Edit</button>
                {r.enabled
                  ? <button onClick={() => toggle(r.id, false)} disabled={busy} className={cx(vx.btn, vx.secondary)}>Disable</button>
                  : <button onClick={() => toggle(r.id, true)} disabled={busy} className={cx(vx.btn, vx.primary)}>Enable</button>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

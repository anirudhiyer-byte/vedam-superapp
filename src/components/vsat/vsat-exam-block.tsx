"use client";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type OpenDate = { id: string; label: string; examDate: string; startAt: string; endAt: string; clickableFrom: string };

const card = "rounded-2xl border border-[#ece8f6] bg-white p-6 shadow-[0_8px_30px_-18px_rgba(90,40,160,0.25)]";
const grad = "rounded-xl bg-gradient-to-r from-[#00cfe5] to-[#c200db] px-6 py-2.5 text-sm font-semibold text-white disabled:opacity-50";
const istFull = (v?: string | number) => (v ? new Date(v).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }) : "—");
const istTime = (v: string) => new Date(v).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" });

/**
 * Post-payment exam sub-flow on the applicant dashboard: the mock test, choosing
 * an exam date (from the admin's enabled dates), and the Start-exam button that
 * only goes live inside the chosen window. The actual Wheebox launch is wired when
 * the UAT creds are in; until then the buttons explain that the exam opens here.
 */
export function VsatExamBlock({ app, onChange }: { app: Record<string, unknown>; onChange: () => void }) {
  const [supabase] = useState(() => createClient());
  const [dates, setDates] = useState<OpenDate[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const [, tick] = useState(0);
  useEffect(() => { const id = setInterval(() => tick((n) => n + 1), 30000); return () => clearInterval(id); }, []);

  const appl = String(app.application_stage_1 ?? "");
  const slotSelected = appl === "slot_selected";
  const examDateId = app.exam_date_id ? String(app.exam_date_id) : "";

  const loadDates = useCallback(async () => {
    const { data } = await supabase.rpc("vsat_exam_open_dates");
    if (data?.ok) setDates((data.dates as OpenDate[]) ?? []);
  }, [supabase]);
  useEffect(() => { void loadDates(); }, [loadDates]);

  async function selectDate(id: string) {
    setBusy(true); setErr("");
    const { data } = await supabase.rpc("vsat_exam_select_date", { p: { dateId: id } });
    setBusy(false);
    if (!data?.ok) return setErr(data?.code === "DATE_FULL" ? "That date is full — pick another." : data?.code || "Couldn't select the date.");
    onChange();
  }

  const mockGiven = app.mock_given === true;
  const mockResult = (app.mock_result as Record<string, unknown> | null) ?? null;

  // resolve the chosen date's window (from the open-dates list; falls back to the stored start)
  const sel = dates.find((d) => d.id === examDateId);
  const now = Date.now();
  const startMs = sel ? new Date(sel.startAt).getTime() : app.vsat_slot_datetime_1 ? new Date(String(app.vsat_slot_datetime_1)).getTime() : 0;
  const clickableFromMs = sel ? new Date(sel.clickableFrom).getTime() : startMs;
  const endMs = sel ? new Date(sel.endAt).getTime() : startMs ? startMs + 2 * 3600 * 1000 : 0;
  const inWindow = slotSelected && startMs > 0 && now >= clickableFromMs && now <= endMs;
  const windowClosed = slotSelected && endMs > 0 && now > endMs;

  return (
    <div className="space-y-4">
      {/* MOCK */}
      <div className={card}>
        <h2 className="font-display text-xl font-bold">Mock test</h2>
        {mockGiven ? (
          <div className="mt-2">
            <p className="text-sm text-[#16a34a]">Mock completed ✓</p>
            {mockResult && (
              <div className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
                {Object.entries(mockResult).map(([k, v]) => (
                  <div key={k} className="rounded-lg bg-[#f6f3fd] px-3 py-2"><span className="text-[#6b647e]">{k}</span>: <b>{String(v)}</b></div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <>
            <p className="mt-2 text-sm text-[#6b647e]">Practice once before the real VSAT. Available once per applicant.</p>
            <button onClick={() => setNote("Your mock test will open right here. (The exam platform connection is being finalised.)")} disabled={busy} className={`mt-4 ${grad}`}>Start mock test</button>
          </>
        )}
      </div>

      {/* EXAM DATE / START */}
      {!slotSelected ? (
        <div className={card}>
          <h2 className="font-display text-xl font-bold">Select your exam date</h2>
          <p className="mt-2 text-sm text-[#6b647e]">Pick a VSAT slot. The Start-exam button goes live a few minutes before your slot.</p>
          <div className="mt-4 space-y-2">
            {dates.length === 0 && <p className="text-sm text-[#9a93ad]">No exam dates are open yet — check back soon.</p>}
            {dates.map((d) => (
              <button key={d.id} onClick={() => selectDate(d.id)} disabled={busy} className="flex w-full items-center justify-between rounded-xl border border-[#e0dbee] bg-white px-4 py-3 text-left text-sm transition hover:bg-[#f6f3fd] disabled:opacity-50">
                <span><b>{d.label}</b><br /><span className="text-xs text-[#6b647e]">{istFull(d.startAt)} – {istTime(d.endAt)}</span></span>
                <span className="font-semibold text-[#7b2ff7]">Select →</span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className={card}>
          <h2 className="font-display text-xl font-bold">Your exam slot</h2>
          <p className="mt-2 text-sm text-[#6b647e]">{sel ? sel.label + " · " : ""}{istFull(startMs)}</p>
          {windowClosed ? (
            <p className="mt-4 text-sm text-[#d14343]">Your exam window has closed.</p>
          ) : inWindow ? (
            <button onClick={() => setNote("Your exam will open right here. (The exam platform connection is being finalised.)")} disabled={busy} className={`mt-4 ${grad}`}>Start exam →</button>
          ) : (
            <button disabled className="mt-4 cursor-not-allowed rounded-xl bg-[#f0edf8] px-5 py-2.5 text-sm font-semibold text-[#b4adc4]">🔒 Unlocks at {istFull(clickableFromMs)}</button>
          )}
        </div>
      )}

      {note && <p className="text-xs text-[#7b2ff7]">{note}</p>}
      {err && <p className="text-xs text-[#d14343]">{err}</p>}
    </div>
  );
}

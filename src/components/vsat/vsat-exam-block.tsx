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
export function VsatExamBlock({ app, onChange, isAdmin = false, mockEnabled = false, examEnabled = true }:
  { app: Record<string, unknown>; onChange: () => void; isAdmin?: boolean; mockEnabled?: boolean; examEnabled?: boolean }) {
  const [supabase] = useState(() => createClient());
  const [dates, setDates] = useState<OpenDate[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const [showDates, setShowDates] = useState(false);
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

  const launchMsg: Record<string, string> = {
    NOT_PAID: "Complete your payment first to unlock the exam.",
    NO_SLOT: "Select your exam date first.",
    NOT_IN_WINDOW: "Your exam hasn't opened yet — try again closer to your slot.",
    WINDOW_CLOSED: "Your exam window has closed.",
    MOCK_NOT_CONFIGURED: "The mock test isn't set up yet — check back soon.",
    MOCK_ALREADY_DONE: "You've already completed your mock test.",
    MOCK_DISABLED: "The mock test isn't open yet — check back soon.",
    EXAM_DISABLED: "The exam isn't open yet — check back soon.",
    WHEEBOX_NOT_CONFIGURED: "The exam platform isn't connected yet — check back soon.",
  };

  async function launch(kind: "mock" | "exam") {
    setBusy(true); setErr(""); setNote("");
    try {
      const res = await fetch("/api/vsat/exam/launch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ kind }),
      });
      const data = await res.json().catch(() => ({}));
      if (data?.ok && typeof data.url === "string") {
        window.open(data.url, "_blank", "noopener,noreferrer");
        setNote("Your test is opening in a new tab. Keep this page open — your result shows here once you finish.");
        onChange();
      } else {
        setErr(launchMsg[data?.code] || "Couldn't open the test right now. Please try again in a moment.");
      }
    } catch {
      setErr("Couldn't reach the exam platform. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const mockResult = (app.mock_result as Record<string, unknown> | null) ?? null;
  const mockHasResult = !!mockResult && Object.keys(mockResult).length > 0;
  // Completed = a real result is in (mock_given is only set when a genuine result was stored).
  const mockDone = app.mock_given === true;
  // In progress = launched/assigned but no result yet. We can't tell "finished, awaiting result"
  // from "launched then bailed" without the Wheebox callback, so we don't claim "completed" here —
  // we show an awaiting-result state and let them resume if they didn't finish.
  const mockInProgress = !mockDone && (app.mock_assigned === true || app.mock_launched_at != null);

  // resolve the chosen date's window (from the open-dates list; falls back to the stored start)
  const sel = dates.find((d) => d.id === examDateId);
  const now = Date.now();
  const startMs = sel ? new Date(sel.startAt).getTime() : app.vsat_slot_datetime_1 ? new Date(String(app.vsat_slot_datetime_1)).getTime() : 0;
  const clickableFromMs = sel ? new Date(sel.clickableFrom).getTime() : startMs;
  const endMs = sel ? new Date(sel.endAt).getTime() : startMs ? startMs + 2 * 3600 * 1000 : 0;
  const inWindow = slotSelected && startMs > 0 && now >= clickableFromMs && now <= endMs;
  const windowClosed = slotSelected && endMs > 0 && now > endMs;

  return (
    <div className={card}>
      {/* MOCK */}
      <h2 className="font-display text-xl font-bold">Mock test</h2>
      {mockDone ? (
        <div className="mt-2">
          <p className="text-sm text-[#16a34a]">Mock completed ✓</p>
          {mockHasResult && (
            <div className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
              {Object.entries(mockResult as Record<string, unknown>).map(([k, v]) => (
                <div key={k} className="rounded-lg bg-[#f6f3fd] px-3 py-2"><span className="text-[#6b647e]">{k}</span>: <b>{String(v)}</b></div>
              ))}
            </div>
          )}
        </div>
      ) : mockInProgress ? (
        <div className="mt-2">
          <p className="text-sm font-semibold text-[#7b2ff7]">Mock in progress</p>
          <p className="mt-1 text-sm text-[#6b647e]">Once you finish, your result will appear here (it can take a little while to process).</p>
          <button onClick={() => launch("mock")} disabled={busy} className="mt-3 text-xs font-semibold text-[#7b2ff7] underline disabled:opacity-50">{busy ? "Opening…" : "Didn’t finish? Re-enter the mock"}</button>
        </div>
      ) : (
        <>
          <p className="mt-2 text-sm text-[#6b647e]">Practice once before the real VSAT. Available once per applicant.</p>
          {(mockEnabled || isAdmin) ? (
            <button onClick={() => launch("mock")} disabled={busy} className={`mt-4 ${grad}`}>{busy ? "Opening…" : "Start mock test →"}{isAdmin && !mockEnabled ? " (admin)" : ""}</button>
          ) : (
            <button disabled className={`mt-4 ${grad} cursor-not-allowed opacity-60`} title="Coming soon">🔒 Coming soon</button>
          )}
        </>
      )}

      {/* EXAM DATE — #2: a button in the same box as the mock test; opens the dates to confirm */}
      <div className="mt-5 border-t border-[#ece8f6] pt-5">
        {!slotSelected ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-display text-base font-bold">Exam date</h3>
              <button onClick={() => setShowDates((v) => !v)} disabled={busy} className={grad}>📅 {showDates ? "Hide dates" : "Select exam date"}</button>
            </div>
            {showDates ? (
              <div className="mt-3 space-y-2">
                {dates.length === 0 && <p className="text-sm text-[#9a93ad]">No exam dates are open yet — check back soon.</p>}
                {dates.map((d) => (
                  <button key={d.id} onClick={() => selectDate(d.id)} disabled={busy} className="flex w-full items-center justify-between rounded-xl border border-[#e0dbee] bg-white px-4 py-3 text-left text-sm transition hover:bg-[#f6f3fd] disabled:opacity-50">
                    <span><b>{d.label}</b><br /><span className="text-xs text-[#6b647e]">{istFull(d.startAt)} – {istTime(d.endAt)}</span></span>
                    <span className="font-semibold text-[#7b2ff7]">Confirm →</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-sm text-[#6b647e]">Pick your VSAT date — the Start-exam button goes live a few minutes before it.</p>
            )}
          </>
        ) : (
          <>
            <h3 className="font-display text-base font-bold">Your exam slot</h3>
            <p className="mt-2 text-sm text-[#6b647e]">{sel ? sel.label + " · " : ""}{istFull(startMs)}</p>
            {isAdmin ? (
              <button onClick={() => launch("exam")} disabled={busy} className={`mt-4 ${grad}`}>{busy ? "Opening…" : "Start exam → (admin)"}</button>
            ) : !examEnabled ? (
              <button disabled className="mt-4 cursor-not-allowed rounded-xl bg-[#f0edf8] px-5 py-2.5 text-sm font-semibold text-[#b4adc4]">🔒 Exam not open yet</button>
            ) : windowClosed ? (
              <p className="mt-4 text-sm text-[#d14343]">Your exam window has closed.</p>
            ) : inWindow ? (
              <button onClick={() => launch("exam")} disabled={busy} className={`mt-4 ${grad}`}>{busy ? "Opening…" : "Start exam →"}</button>
            ) : (
              <button disabled className="mt-4 cursor-not-allowed rounded-xl bg-[#f0edf8] px-5 py-2.5 text-sm font-semibold text-[#b4adc4]">🔒 Unlocks at {istFull(clickableFromMs)}</button>
            )}
          </>
        )}
      </div>

      {note && <p className="mt-3 text-xs text-[#7b2ff7]">{note}</p>}
      {err && <p className="mt-3 text-xs text-[#d14343]">{err}</p>}
    </div>
  );
}

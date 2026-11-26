"use client";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { cx, vx } from "@/components/admin/ui/vx";
import { errorText, fmtIst } from "@/lib/vsat/pipeline";
import { campusLabel } from "@/lib/vsat/leads-grid";
import { offlineDateText, zoomLinkProblem, type OfflineDateRow, type ZoomLinkRow } from "@/lib/vsat/counselling-setup";
import {
  CONFIRMATION_CHOICES, NOTES_COMMENTS_MAX, draftOf, notesChanges, rupees, type Confirmation, type CounsellingNotes, type NotesDraft,
} from "@/lib/vsat/counselling-notes";

/**
 * VSAT counselling, owner's review 24 Nov 2026 (0184):
 *   ModeBar            admissions set Online / Offline for the selected students (students who reply by email)
 *   CounsellingSetup   one Zoom link per counsellor (admins) and the offline counselling dates per campus (admins and
 *                      admissions) — the online invite goes on the counsellor's link; the PI-cleared email lists the dates
 *   NotesBox           (0193) the sheets' "Confirmation", "Additional Comments" and "Proposed Fee" for one student (drawer)
 * The database checks every rule again (vsat_counselling_mode_staff, vsat_counsellor_zoom_set, vsat_offline_date_add / _remove,
 * vsat_counselling_notes_set).
 */

const input = vx.input;

type Mode = "online" | "offline" | "none";
const MODE_CHOICES: { v: Mode; label: string }[] = [
  { v: "online", label: "Online" }, { v: "offline", label: "Offline" }, { v: "none", label: "Not chosen" },
];

export function ModeBar({ ids, onDone }: { ids: string[]; onDone: () => void }) {
  const [supabase] = useState(() => createClient());
  const [mode, setMode] = useState<Mode>("online");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function apply() {
    if (ids.length > 100) return setMsg("Select at most 100 students at a time.");
    setBusy(true); setMsg("");
    const { data, error } = await supabase.rpc("vsat_counselling_mode_staff", { p: { application_ids: ids, mode } });
    setBusy(false);
    if (error) return setMsg(errorText(error.message));
    const d = data as { updated: string[]; skipped: { application_id: string; code: string }[] };
    const why = d.skipped.slice(0, 5).map((x) => `${x.application_id} (${errorText(x.code).replace(/\.$/, "")})`).join("; ");
    const label = MODE_CHOICES.find((c) => c.v === mode)?.label ?? mode;
    setMsg(`Mode ${label}: ${d.updated.length} updated${d.skipped.length ? `, ${d.skipped.length} not changed: ${why}${d.skipped.length > 5 ? " …" : ""}` : ""}.`);
    if (d.updated.length) onDone();
  }

  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-vx-violet/20 pt-2 text-sm">
      <span className="text-vx-mut">Counselling mode</span>
      <select className={input} value={mode} onChange={(e) => setMode(e.target.value as Mode)} aria-label="Counselling mode">
        {MODE_CHOICES.map((c) => <option key={c.v} value={c.v}>{c.label}</option>)}
      </select>
      <button className={cx(vx.btn, vx.secondary)} disabled={busy} onClick={apply}>{busy ? "Saving…" : "Set mode"}</button>
      <span className="text-xs text-vx-faint">For students who replied by email. Online students get the invite on their counsellor&apos;s Zoom link; for offline students, book the counsellor and the offline date to record it (no invite).</span>
      {msg && <p className="w-full text-vx-ink" role="status">{msg}</p>}
    </div>
  );
}

/**
 * Drawer (admins and admissions): sir's sheet columns "Confirmation" (the student confirmed the online session — only for a
 * booked online session, and for that slot: a moved session needs it again), "Additional Comments" and "Proposed Fee".
 * Save sends only what changed; the table shows the saved values.
 */
export function NotesBox({ applicationId, onDone }: { applicationId: string; onDone: () => void }) {
  const [supabase] = useState(() => createClient());
  const [saved, setSaved] = useState<CounsellingNotes | null>(null);
  const [draft, setDraft] = useState<NotesDraft>({ comments: "", fee: "", confirmation: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  useEffect(() => {
    let on = true;
    setSaved(null); setMsg(null);
    void supabase.rpc("vsat_counselling_notes_get", { p: { application_id: applicationId } }).then(({ data, error }) => {
      if (!on) return;
      if (error) return setMsg({ text: errorText(error.message), ok: false });
      const n = data as CounsellingNotes;
      setSaved(n); setDraft(draftOf(n));
    });
    return () => { on = false; };
  }, [supabase, applicationId]);

  if (!saved) return msg ? <p role="alert" className={vx.error}>{msg.text}</p> : null;
  const check = notesChanges(saved, draft);
  const changed = !check.ok || check.payload !== null;
  const edit = (patch: Partial<NotesDraft>) => { setDraft((d) => ({ ...d, ...patch })); setMsg(null); };

  async function save() {
    if (!saved) return;
    const c = notesChanges(saved, draft);
    if (!c.ok) return setMsg({ text: c.error, ok: false });
    if (!c.payload) return;
    setBusy(true); setMsg(null);
    const { data, error } = await supabase.rpc("vsat_counselling_notes_set", { p: c.payload });
    setBusy(false);
    if (error) return setMsg({ text: errorText(error.message), ok: false });
    const n = data as CounsellingNotes;
    setSaved(n); setDraft(draftOf(n));
    setMsg({ text: "Saved ✓", ok: true });
    onDone();
  }

  const confOff = !saved.editable || (!saved.online_slot && draft.confirmation === "");
  return (
    <div className="space-y-3 rounded-lg border border-vx-line p-3">
      <div>
        <p className="text-xs font-semibold text-vx-faint">Sheet columns: Confirmation, Additional comments, Proposed fee</p>
        {!saved.editable && <p className="mt-1 text-xs text-vx-faint">These can be changed from PI cleared on.</p>}
      </div>
      <label className="block text-xs text-vx-faint">
        Confirmation
        <select className={cx(input, "mt-1 block max-w-[12rem]")} value={draft.confirmation} disabled={busy || confOff}
          onChange={(e) => edit({ confirmation: e.target.value as Confirmation })}>
          {CONFIRMATION_CHOICES.map((c) => <option key={c.v} value={c.v}>{c.label}</option>)}
        </select>
        <span className="mt-1 block">
          {saved.online_slot ? `Did the student confirm the online session on ${fmtIst(saved.online_slot)}?` : "Only for a booked online session."}
        </span>
      </label>
      <label className="block text-xs text-vx-faint">
        Proposed fee (₹)
        <input className={cx(input, "mt-1 block max-w-[12rem]")} inputMode="numeric" maxLength={14} placeholder="e.g. 15,00,000"
          value={draft.fee} disabled={busy || !saved.editable} onChange={(e) => edit({ fee: e.target.value })} />
        {saved.programme_fee != null && <span className="mt-1 block">Up to the programme fee, {rupees(saved.programme_fee)}.</span>}
      </label>
      <label className="block text-xs text-vx-faint">
        Additional comments
        <textarea className={cx(vx.textarea, "mt-1")} rows={3} maxLength={NOTES_COMMENTS_MAX} value={draft.comments}
          disabled={busy || !saved.editable} onChange={(e) => edit({ comments: e.target.value })} />
      </label>
      {saved.editable && (
        <button type="button" className={cx(vx.btn, vx.secondary, vx.sm)} disabled={busy || !changed} onClick={() => void save()}>
          {busy ? "Saving…" : "Save"}
        </button>
      )}
      {msg && <p className={cx("text-xs", msg.ok ? "text-vx-green" : "text-[#ffb3bf]")} role={msg.ok ? "status" : "alert"}>{msg.text}</p>}
    </div>
  );
}

/** The Counselling page's setup: Zoom links (admins edit, admissions see) and offline dates. Collapsed by default. */
export function CounsellingSetup({ admin }: { admin: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <section className={cx(vx.card, "px-4 py-3")} aria-label="Counselling setup">
      <button type="button" className="flex w-full items-center justify-between gap-3 text-left" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span>
          <span className="block text-sm font-semibold text-vx-ink">Zoom links &amp; offline dates</span>
          <span className="block text-xs text-vx-faint">Online counselling runs on each counsellor&apos;s own Zoom link. The PI-cleared email lists the offline dates of the student&apos;s campus.</span>
        </span>
        <span className="text-xs text-vx-violet-t">{open ? "Hide" : "Show"}</span>
      </button>
      {open && (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <ZoomLinks admin={admin} />
          <OfflineDates />
        </div>
      )}
    </section>
  );
}

function ZoomLinks({ admin }: { admin: boolean }) {
  const [supabase] = useState(() => createClient());
  const [rows, setRows] = useState<ZoomLinkRow[] | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState<{ id: string; text: string; ok: boolean } | null>(null);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc("vsat_counsellor_zoom_list");
    if (error) { setErr(errorText(error.message)); setRows([]); return; }
    const list = (Array.isArray(data) ? data : []) as ZoomLinkRow[];
    setRows(list);
    setDraft(Object.fromEntries(list.map((r) => [r.counsellor_id, r.zoom_link ?? ""])));
  }, [supabase]);
  useEffect(() => { void load(); }, [load]);

  async function save(r: ZoomLinkRow) {
    const link = (draft[r.counsellor_id] ?? "").trim();
    const problem = link ? zoomLinkProblem(link) : null;
    if (problem) return setMsg({ id: r.counsellor_id, text: problem, ok: false });
    setBusy(r.counsellor_id); setMsg(null);
    const { error } = await supabase.rpc("vsat_counsellor_zoom_set", { p: { counsellor_id: r.counsellor_id, zoom_link: link } });
    setBusy("");
    if (error) return setMsg({ id: r.counsellor_id, text: errorText(error.message), ok: false });
    setMsg({ id: r.counsellor_id, text: link ? "Saved ✓" : "Removed ✓", ok: true });
    void load();
  }

  return (
    <div>
      <h3 className="text-[13px] font-semibold text-vx-ink">Zoom link per counsellor</h3>
      <p className="mb-2 text-xs text-vx-faint">{admin ? "Paste each counsellor's personal Zoom meeting link. Leave it empty and save to remove it." : "Admins add or change these links."} A counsellor without a link can&apos;t be booked for online counselling.</p>
      {err && <p role="alert" className={vx.error}>{err}</p>}
      {rows === null && <p className={vx.note}>Loading…</p>}
      {rows && rows.length === 0 && !err && <p className={vx.note}>No active counsellors. Add them under Team.</p>}
      <ul className="space-y-2">
        {(rows ?? []).map((r) => {
          const changed = (draft[r.counsellor_id] ?? "") !== (r.zoom_link ?? "");
          return (
            <li key={r.counsellor_id} className="rounded-lg border border-vx-line p-2.5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-sm text-vx-ink">{r.name ?? r.email ?? "Counsellor"}</span>
                {!r.zoom_link && <span className={cx(vx.badge, vx.tone.orange)}>No link</span>}
              </div>
              {admin ? (
                <div className="mt-1.5 flex flex-wrap gap-2">
                  <input className={cx(input, "min-w-0 flex-1")} type="url" inputMode="url" placeholder="https://us06web.zoom.us/j/…"
                    value={draft[r.counsellor_id] ?? ""} maxLength={500} aria-label={`Zoom link for ${r.name ?? r.email ?? "counsellor"}`}
                    onChange={(e) => { setDraft((d) => ({ ...d, [r.counsellor_id]: e.target.value })); setMsg(null); }} />
                  <button type="button" className={cx(vx.btn, vx.secondary, vx.sm)} disabled={!changed || busy === r.counsellor_id} onClick={() => void save(r)}>
                    {busy === r.counsellor_id ? "Saving…" : "Save"}
                  </button>
                </div>
              ) : r.zoom_link ? (
                <a className={cx(vx.link, "mt-1 block break-all text-xs")} href={r.zoom_link} target="_blank" rel="noopener noreferrer">{r.zoom_link}</a>
              ) : null}
              {msg?.id === r.counsellor_id && <p className={cx("mt-1 text-xs", msg.ok ? "text-vx-green" : "text-[#ffb3bf]")} role={msg.ok ? "status" : "alert"}>{msg.text}</p>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const todayIst = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());

function OfflineDates() {
  const [supabase] = useState(() => createClient());
  const [rows, setRows] = useState<OfflineDateRow[] | null>(null);
  const [campus, setCampus] = useState<"pune" | "gurugram">("pune");
  const [date, setDate] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc("vsat_offline_dates_list", { p: {} });
    if (error) { setMsg({ text: errorText(error.message), ok: false }); setRows([]); return; }
    setRows((Array.isArray(data) ? data : []) as OfflineDateRow[]);
  }, [supabase]);
  useEffect(() => { void load(); }, [load]);

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!date) return setMsg({ text: "Pick a date.", ok: false });
    setBusy("add"); setMsg(null);
    const p: Record<string, unknown> = { campus, date };
    if (note.trim()) p.note = note.trim();
    const { error } = await supabase.rpc("vsat_offline_date_add", { p });
    setBusy("");
    if (error) return setMsg({ text: errorText(error.message), ok: false });
    setMsg({ text: `Added ${offlineDateText(date)} for ${campusLabel(campus)} ✓`, ok: true });
    setDate(""); setNote("");
    void load();
  }

  async function remove(r: OfflineDateRow) {
    setBusy(r.id); setMsg(null);
    const { error } = await supabase.rpc("vsat_offline_date_remove", { p: { id: r.id } });
    setBusy("");
    if (error) return setMsg({ text: errorText(error.message), ok: false });
    setMsg({ text: `Removed ${offlineDateText(r.date)} (${campusLabel(r.campus)}) ✓`, ok: true });
    void load();
  }

  const upcoming = (rows ?? []).filter((r) => !r.past);
  return (
    <div>
      <h3 className="text-[13px] font-semibold text-vx-ink">Offline counselling dates</h3>
      <p className="mb-2 text-xs text-vx-faint">Dates students can come to the campus for counselling. The PI-cleared email lists the student&apos;s campus&apos;s dates from today on.</p>
      <form className="flex flex-wrap items-end gap-2" onSubmit={add}>
        <label className="text-xs text-vx-faint">Campus
          <select className={cx(input, "mt-1 block")} value={campus} onChange={(e) => setCampus(e.target.value as "pune" | "gurugram")}>
            <option value="pune">Pune</option><option value="gurugram">Gurugram</option>
          </select>
        </label>
        <label className="text-xs text-vx-faint">Date
          <input className={cx(input, "mt-1 block")} type="date" min={todayIst()} value={date} onChange={(e) => { setDate(e.target.value); setMsg(null); }} />
        </label>
        <label className="min-w-[10rem] flex-1 text-xs text-vx-faint">Note (optional)
          <input className={cx(input, "mt-1 block w-full")} maxLength={200} placeholder="e.g. 10 am – 4 pm, admissions office" value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <button type="submit" className={cx(vx.btn, vx.secondary)} disabled={busy === "add"}>{busy === "add" ? "Adding…" : "Add date"}</button>
      </form>
      {msg && <p className={cx("mt-2 text-xs", msg.ok ? "text-vx-green" : "text-[#ffb3bf]")} role={msg.ok ? "status" : "alert"}>{msg.text}</p>}
      {rows === null && <p className={cx(vx.note, "mt-3")}>Loading…</p>}
      {rows && upcoming.length === 0 && <p className={cx(vx.note, "mt-3")}>No upcoming offline dates. The email then says the dates will be announced soon.</p>}
      {upcoming.length > 0 && (
        <ul className="mt-3 divide-y divide-vx-line rounded-lg border border-vx-line">
          {upcoming.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
              <span>
                <span className="text-vx-ink">{offlineDateText(r.date)}</span>
                <span className="text-vx-faint"> · {campusLabel(r.campus)}{r.note ? ` · ${r.note}` : ""}</span>
              </span>
              <button type="button" className={cx(vx.btn, vx.ghost, vx.sm)} disabled={busy === r.id} onClick={() => void remove(r)}>
                {busy === r.id ? "Removing…" : "Remove"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

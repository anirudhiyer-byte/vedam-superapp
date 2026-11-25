"use client";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import { cx, vx } from "@/components/admin/ui/vx";
import { errorText } from "@/lib/vsat/pipeline";
import type { GenderCount, PiBucket, PiResult } from "./types";

/**
 * VSAT Exam tools (0135). Every number comes from the database. The results analysis moved to its own page,
 * Exam Evaluation (exam-evaluation.tsx, 0172), which uses the Select for PI dialog and the Dialog below:
 * - SelectForPiDialog → vsat_select_for_pi (admins: preview, then move with the previewed count)
 * - ProctoringBar     → vsat_set_proctoring_bulk (admin / admissions, campus-checked per student)
 * - VpsEditDialog     → vsat_set_override / vsat_clear_override (admins)
 */

const fmt = (n: number | null | undefined, digits = 2) =>
  n === null || n === undefined ? "—" : Number(n).toFixed(digits).replace(/\.?0+$/, "");

const IconClose = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="h-4 w-4"><path d="M18 6 6 18M6 6l12 12" /></svg>
);

/** Centered dialog with a backdrop; Escape and the backdrop close it; focus starts inside. Also used by Exam Evaluation. */
export function Dialog({ title, sub, onClose, children, wide = false }: { title: string; sub?: ReactNode; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    box.current?.focus();
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [onClose]);
  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div ref={box} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title}
        className={cx("fixed left-1/2 top-[6vh] z-50 flex max-h-[88vh] -translate-x-1/2 flex-col overflow-hidden rounded-2xl border border-vx-line bg-[#0e0b29] text-vx-ink shadow-2xl outline-none",
          wide ? "w-[min(760px,94%)]" : "w-[min(460px,94%)]")}>
        <div className="flex items-start justify-between gap-3 border-b border-vx-line px-5 py-4">
          <div className="min-w-0"><h2 className="text-base font-bold">{title}</h2>{sub && <div className="mt-0.5 text-xs text-vx-faint">{sub}</div>}</div>
          <button onClick={onClose} aria-label="Close" className="grid h-8 w-8 flex-none place-items-center rounded-lg border border-vx-line text-vx-mut hover:text-vx-ink"><IconClose /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </>
  );
}

/** "21 male · 6 female" (+ "· 2 other" only when there are any). */
function genderLine(g: GenderCount): string {
  return `${g.male} male · ${g.female} female${g.other ? ` · ${g.other} other` : ""}`;
}
/** Female : male as "1 : 3.5" (the team watches it against 1 : 3). */
function ratio(g: GenderCount): string {
  if (!g.female || !g.male) return "—";
  return `1 : ${fmt(g.male / g.female, 1)}`;
}

/* ───────────────────────────── Select for PI ───────────────────────────── */

const LEFT_OUT: { key: PiBucket; label: string }[] = [
  { key: "below_cutoff", label: "below the cut-off" },
  { key: "disqualified", label: "disqualified (proctoring)" },
  { key: "no_result", label: "no result yet" },
  { key: "already_selected", label: "already at VSAT cleared or later" },
  { key: "not_active", label: "on hold, absent or not selected" },
  { key: "not_eligible", label: "not eligible (rules or an admin override)" },
];

export function SelectForPiDialog({ examDateId, percentile, onClose, onApplied }:
  { examDateId: string; percentile: number; onClose: () => void; onApplied: () => void }) {
  const [supabase] = useState(() => createClient());
  const [preview, setPreview] = useState<PiResult | null>(null);
  const [result, setResult] = useState<PiResult | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    setBusy(true); setErr(""); setResult(null);
    const { data, error } = await supabase.rpc("vsat_select_for_pi", { p: { exam_date_id: examDateId, percentile } });
    setBusy(false);
    if (error) { setErr(errorText(error.message)); return; }
    setPreview(data as PiResult);
  }, [supabase, examDateId, percentile]);
  useEffect(() => { void load(); }, [load]);

  async function apply() {
    if (!preview) return;
    setBusy(true); setErr("");
    const p: Record<string, unknown> = { exam_date_id: examDateId, percentile, apply: true, expected_count: preview.selected.total };
    if (note.trim()) p.note = note.trim();
    const { data, error } = await supabase.rpc("vsat_select_for_pi", { p });
    setBusy(false);
    if (error) { setErr(errorText(error.message)); return; }
    setResult(data as PiResult);
    onApplied();
  }

  const sel = preview?.selected;
  return (
    <Dialog wide title={`Select for PI${preview ? ` · ${preview.vsat}` : ""}`} onClose={onClose}
      sub={preview ? <>Percentile ≥ {fmt(preview.percentile)}{preview.vps_cutoff !== null ? <> · VPS ≥ {fmt(preview.vps_cutoff)} on this VSAT&apos;s curve</> : null}</> : null}>
      {err && <div role="alert" className={cx(vx.error, "mb-3")}>{err}
        {err === errorText("COUNT_CHANGED") && <button className={cx(vx.btn, vx.secondary, vx.sm, "ml-3")} onClick={() => void load()}>Preview again</button>}</div>}
      {!preview && busy && <p className={vx.note}>Working out who qualifies…</p>}

      {result ? (
        <div className="space-y-3">
          <p className={vx.ok}>Moved {result.moved} to VSAT cleared{result.unchanged ? ` · ${result.unchanged} were already there` : ""}.
            {" "}The VSAT&apos;s cut-off is saved as VPS {fmt(result.vps_cutoff)}.</p>
          {(result.skipped?.length ?? 0) > 0 && (
            <div className={vx.info}>
              <p className="mb-1 font-medium">{result.skipped!.length} could not be moved:</p>
              <ul className="list-disc pl-5 text-[13px] text-vx-mut">
                {result.skipped!.slice(0, 20).map((s) => <li key={s.application_id}>{s.application_id} — {errorText(s.code)}</li>)}
              </ul>
            </div>
          )}
          <div className="flex justify-end"><button className={cx(vx.btn, vx.primary)} onClick={onClose}>Done</button></div>
        </div>
      ) : preview && sel ? (
        <div className="space-y-4">
          <div>
            <p className="text-[22px] font-semibold tracking-[-0.02em]">{sel.total} student{sel.total === 1 ? "" : "s"} will move to VSAT cleared</p>
            <p className="mt-0.5 text-sm text-vx-mut">
              {genderLine(sel)} · female : male {ratio(sel)} · Pune {sel.pune} · Gurugram {sel.gurugram}{sel.total - sel.pune - sel.gurugram > 0 ? ` · no campus ${sel.total - sel.pune - sel.gurugram}` : ""}
            </p>
          </div>
          {LEFT_OUT.some((b) => preview.counts[b.key] > 0) && (
            <div>
              <p className="mb-1.5 text-[12px] text-vx-faint">Left out</p>
              <div className="flex flex-wrap gap-1.5">
                {LEFT_OUT.filter((b) => preview.counts[b.key] > 0).map((b) => (
                  <span key={b.key} className={vx.chip}><b className="font-semibold text-vx-ink">{preview.counts[b.key]}</b> {b.label}</span>
                ))}
              </div>
            </div>
          )}
          {sel.total > 0 && (
            <div className={cx(vx.well, "max-h-[34vh] overflow-y-auto")}>
              <table className="w-full text-[13px]">
                <thead className="sticky top-0 bg-[#15112f] text-[12px] text-vx-faint">
                  <tr><th className="px-3 py-2 text-left font-medium">Student</th><th className="px-3 py-2 text-right font-medium">Percentile</th>
                    <th className="px-3 py-2 text-left font-medium">Gender</th><th className="px-3 py-2 text-left font-medium">Campus</th></tr>
                </thead>
                <tbody>
                  {preview.candidates.map((c) => (
                    <tr key={c.application_id} className="border-t border-vx-line-soft">
                      <td className="px-3 py-1.5"><span className="block text-vx-ink">{c.name ?? "—"}</span><span className="block whitespace-nowrap text-[12px] text-vx-faint">{c.application_no ?? c.application_id}</span></td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{fmt(c.percentile)}</td>
                      <td className="px-3 py-1.5 capitalize text-vx-mut">{c.gender}</td>
                      <td className="px-3 py-1.5 capitalize text-vx-mut">{c.campus ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {sel.total > 0 && (
            <>
              <div>
                <label className={vx.label} htmlFor="pi-note">Note for the history (optional)</label>
                <input id="pi-note" className={vx.input} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300}
                  placeholder="e.g. Female inclusion discussed with the manager" />
                <p className="mt-1 text-[12px] text-vx-faint">Each student&apos;s history will say: Selected for PI · {preview.vsat} · percentile ≥ {fmt(preview.percentile)}{note.trim() ? ` · ${note.trim()}` : ""}</p>
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <button className={cx(vx.btn, vx.ghost)} onClick={onClose} disabled={busy}>Cancel</button>
                <button className={cx(vx.btn, vx.primary)} onClick={apply} disabled={busy}>{busy ? "Moving…" : `Move ${sel.total} to VSAT cleared`}</button>
              </div>
            </>
          )}
          {sel.total === 0 && <div className="flex justify-end"><button className={cx(vx.btn, vx.secondary)} onClick={onClose}>Close</button></div>}
        </div>
      ) : null}
    </Dialog>
  );
}

/* ───────────────────────────── proctoring (bulk) ───────────────────────────── */

type ProctorAction = "disqualified" | "cleared" | "remove";

export function ProctoringBar({ ids, onDone }: { ids: string[]; onDone: () => void }) {
  const [supabase] = useState(() => createClient());
  const [action, setAction] = useState<ProctorAction>("disqualified");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const reasonNeeded = action !== "cleared";

  async function apply() {
    if (reasonNeeded && reason.trim().length < 3) return setMsg("Please add a reason (at least 3 characters).");
    setBusy(true); setMsg("");
    const p: Record<string, unknown> = { application_ids: ids, verdict: action === "remove" ? null : action };
    if (reason.trim()) p.reason = reason.trim();
    const { data, error } = await supabase.rpc("vsat_set_proctoring_bulk", { p });
    setBusy(false);
    if (error) return setMsg(errorText(error.message));
    const d = data as { changed: number; unchanged: number; skipped: { application_id: string; code: string }[] };
    setMsg(`Updated ${d.changed}${d.unchanged ? `, ${d.unchanged} already so` : ""}${d.skipped.length
      ? `, ${d.skipped.length} skipped: ${d.skipped.slice(0, 5).map((s) => `${s.application_id} (${errorText(s.code)})`).join("; ")}${d.skipped.length > 5 ? " …" : ""}` : ""}.`);
    setReason(""); onDone();
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-vx-mut">Proctoring</span>
      <select className={vx.field} value={action} onChange={(e) => { setAction(e.target.value as ProctorAction); setMsg(""); }} aria-label="Proctoring verdict">
        <option value="disqualified">Disqualify</option>
        <option value="cleared">Mark cleared</option>
        <option value="remove">Remove verdict</option>
      </select>
      <input className={cx(vx.field, "w-64")} placeholder={reasonNeeded ? "Reason (required)" : "Reason (needed only to change an earlier verdict)"}
        value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} aria-label="Proctoring reason" />
      <button className={cx(vx.btn, action === "disqualified" ? vx.danger : vx.secondary)} disabled={busy} onClick={apply}>
        {busy ? "Saving…" : action === "disqualified" ? `Disqualify ${ids.length}` : action === "cleared" ? `Clear ${ids.length}` : `Remove for ${ids.length}`}
      </button>
      {msg && <p className="w-full text-vx-ink">{msg}</p>}
    </div>
  );
}

/* ───────────────────────────── VPS edit (admins) ───────────────────────────── */

export type VpsTarget = { applicationId: string; name: string; value: number | null; calculated: number | null; override: number | null };

export function VpsEditDialog({ target, onClose, onDone }: { target: VpsTarget; onClose: () => void; onDone: () => void }) {
  const [supabase] = useState(() => createClient());
  const [value, setValue] = useState(target.value === null ? "" : String(target.value));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function save() {
    const v = Number(value);
    if (value.trim() === "" || !Number.isFinite(v) || v < 0 || v > 10) return setErr("VPS must be between 0 and 10.");
    if (reason.trim().length < 3) return setErr("Please add a reason (at least 3 characters).");
    setBusy(true); setErr("");
    const { error } = await supabase.rpc("vsat_set_override", { p: { application_id: target.applicationId, field: "vps", value: v, reason: reason.trim() } });
    setBusy(false);
    if (error) return setErr(errorText(error.message));
    onDone(); onClose();
  }
  async function remove() {
    if (reason.trim().length < 3) return setErr("Add a reason for removing the override (at least 3 characters).");
    setBusy(true); setErr("");
    const { error } = await supabase.rpc("vsat_clear_override", { p: { application_id: target.applicationId, field: "vps", reason: reason.trim() } });
    setBusy(false);
    if (error) return setErr(errorText(error.message));
    onDone(); onClose();
  }

  return (
    <Dialog title={`VPS · ${target.name}`} onClose={onClose}
      sub={<>Calculated {fmt(target.calculated)}{target.override !== null ? <> · override {fmt(target.override)} in use</> : null}</>}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <div>
          <label className={vx.label} htmlFor="vps-new">New VPS (0–10)</label>
          <input id="vps-new" className={vx.input} type="number" min={0} max={10} step="0.01" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
        </div>
        <div>
          <label className={vx.label} htmlFor="vps-reason">Reason</label>
          <input id="vps-reason" className={vx.input} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="Shown in the student's history" />
        </div>
        {err && <p role="alert" className={vx.error}>{err}</p>}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {target.override !== null && <button type="button" className={cx(vx.btn, vx.ghost, "mr-auto")} disabled={busy} onClick={remove}>Back to calculated</button>}
          <button type="button" className={cx(vx.btn, vx.ghost, target.override === null ? "ml-auto" : "")} onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className={cx(vx.btn, vx.primary)} disabled={busy}>{busy ? "Saving…" : "Save VPS"}</button>
        </div>
        <p className={vx.note}>Admins only. The calculated value stays on record next to the override.</p>
      </form>
    </Dialog>
  );
}

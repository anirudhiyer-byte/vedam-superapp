"use client";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import { cx, vx } from "@/components/admin/ui/vx";
import { errorText } from "@/lib/vsat/pipeline";
import type { ExamAnalysis, GenderCount, PiBucket, PiResult } from "./types";

/**
 * VSAT Exam panel tools (0135). Every number comes from the database:
 * - ExamAnalysisCard  → vsat_exam_analysis (admin / admissions, campus-limited)
 * - SelectForPiDialog → vsat_select_for_pi (admins: preview, then move with the previewed count)
 * - ProctoringBar     → vsat_set_proctoring_bulk (admin / admissions, campus-checked per student)
 * - VpsEditDialog     → vsat_set_override / vsat_clear_override (admins)
 */

const fmt = (n: number | null | undefined, digits = 2) =>
  n === null || n === undefined ? "—" : Number(n).toFixed(digits).replace(/\.?0+$/, "");
/** The sheet's three cut-off tables: 35 %, 60 %, 65 %. */
const QUICK_CUTS = [35, 60, 65];

const IconClose = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="h-4 w-4"><path d="M18 6 6 18M6 6l12 12" /></svg>
);

/** Centered dialog with a backdrop; Escape and the backdrop close it; focus starts inside. */
function Dialog({ title, sub, onClose, children, wide = false }: { title: string; sub?: ReactNode; onClose: () => void; children: ReactNode; wide?: boolean }) {
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

/* ───────────────────────────── analysis card ───────────────────────────── */

export function ExamAnalysisCard({ vsatIds, vsatLabels, canSelect, reloadKey, onApplied }:
  { vsatIds: string[]; vsatLabels: string[]; canSelect: boolean; reloadKey: number; onApplied: () => void }) {
  const [supabase] = useState(() => createClient());
  const [cut, setCut] = useState<number>(65);
  const [custom, setCustom] = useState("");
  const [data, setData] = useState<ExamAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState(true);
  const [pi, setPi] = useState(false);
  const key = vsatIds.join(",");

  const load = useCallback(async () => {
    if (!key) return;
    setLoading(true); setErr("");
    const { data: d, error } = await supabase.rpc("vsat_exam_analysis", { p: { exam_date_ids: key.split(","), percentile: cut } });
    setLoading(false);
    if (error) { setErr(errorText(error.message)); setData(null); return; }
    setData(d as ExamAnalysis);
  }, [supabase, key, cut]);
  useEffect(() => { if (open) void load(); }, [load, open, reloadKey]);

  function applyCustom() {
    const n = Number(custom);
    if (custom.trim() === "" || !Number.isFinite(n) || n < 0 || n > 100) return setErr("Cut-off must be a percentile between 0 and 100.");
    setCut(n);
  }

  const title = vsatLabels.length === 1 ? vsatLabels[0] : `${vsatLabels.length} VSATs`;
  const maxSlab = Math.max(1, ...(data?.slabs ?? []).map((s) => s.n));
  const single = vsatIds.length === 1;

  return (
    <section className={cx(vx.card, "overflow-hidden")} aria-label="VSAT analysis">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 sm:px-5">
        <h2 className={vx.h3}>Results · {title}</h2>
        {data && <span className="text-[13px] text-vx-faint">
          {data.takers} took the test of {data.booked} booked{data.disqualified ? ` · ${data.disqualified} disqualified` : ""}
        </span>}
        <span className="flex-1" />
        {loading && <span className="text-xs text-vx-faint">Loading…</span>}
        <button className={cx(vx.btn, vx.ghost, vx.sm)} onClick={() => setOpen(!open)} aria-expanded={open}>{open ? "Hide" : "Show"}</button>
      </div>
      {open && (
        <div className="border-t border-vx-line-soft px-4 pb-4 pt-3 sm:px-5">
          {err && <p role="alert" className={cx(vx.error, "mb-3")}>{err}</p>}
          {data && data.takers === 0 && <p className={vx.note}>No results yet for {single ? "this VSAT" : "these VSATs"}. They appear here as Wheebox sends them.</p>}
          {data && data.takers > 0 && (
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]">
              {/* left: the headline numbers and the spread */}
              <div className="space-y-3">
                <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-2">
                  {[
                    { k: "Average score", v: data.avg_percentage === null ? "—" : `${fmt(data.avg_percentage)}%` },
                    { k: "Average percentile", v: fmt(data.avg_percentile) },
                    { k: "Percentile above 70", v: String(data.above_70) },
                    { k: "Female : male", v: ratio(data.gender), hint: "Not disqualified" },
                  ].map((s) => (
                    <div key={s.k} className={cx(vx.well, "px-3 py-2")} title={s.hint}>
                      <dt className="text-[12px] text-vx-faint">{s.k}</dt>
                      <dd className="mt-0.5 text-[18px] font-semibold tabular-nums tracking-[-0.01em]">{s.v}</dd>
                    </div>
                  ))}
                </dl>
                <div>
                  <p className="mb-1.5 text-[12px] text-vx-faint">Percentile spread · not disqualified · {genderLine(data.gender)}</p>
                  <ul className="space-y-1">
                    {data.slabs.map((s) => (
                      <li key={s.label} className="grid grid-cols-[52px_1fr_32px] items-center gap-2 text-[13px]">
                        <span className="tabular-nums text-vx-mut">{s.label}</span>
                        <span className="h-2.5 overflow-hidden rounded-full bg-white/[0.05]">
                          <span className="block h-full rounded-full bg-vx-violet/70" style={{ width: `${(s.n / maxSlab) * 100}%` }} />
                        </span>
                        <span className="text-right tabular-nums">{s.n}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* right: the cut-off table and Select for PI */}
              <div className={cx(vx.well, "p-3")}>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="mr-1 text-[13px] text-vx-mut">Percentile at least</span>
                  {QUICK_CUTS.map((c) => (
                    <button key={c} onClick={() => { setCut(c); setCustom(""); }} aria-pressed={cut === c}
                      className={cx(vx.btn, vx.sm, cut === c ? "border-vx-violet/60 bg-vx-violet/20 text-vx-ink" : vx.ghost)}>{c}</button>
                  ))}
                  <form className="flex items-center gap-1.5" onSubmit={(e) => { e.preventDefault(); applyCustom(); }}>
                    <input className={cx(vx.field, "h-8 w-[5.75rem] text-[13px]")} type="number" min={0} max={100} step="any" inputMode="decimal"
                      placeholder="Other" value={custom} onChange={(e) => setCustom(e.target.value)} aria-label="Other cut-off percentile" />
                    {custom.trim() !== "" && <button type="submit" className={cx(vx.btn, vx.secondary, vx.sm)}>Use</button>}
                  </form>
                </div>
                {data.cutoff && (
                  <>
                    <table className="mt-3 w-full text-[13px]">
                      <thead className="text-[12px] text-vx-faint">
                        <tr><th className="pb-1 text-left font-medium">Not disqualified, ≥ {fmt(data.cutoff.percentile)}</th>
                          <th className="pb-1 text-right font-medium">Male</th><th className="pb-1 text-right font-medium">Female</th><th className="pb-1 text-right font-medium">Total</th></tr>
                      </thead>
                      <tbody className="tabular-nums">
                        {(["pune", "gurugram", "none"] as const).filter((c) => data.cutoff?.by_campus[c]).map((c) => {
                          const r = data.cutoff!.by_campus[c]!;
                          return (
                            <tr key={c} className="border-t border-vx-line-soft">
                              <td className="py-1.5 text-vx-mut">{c === "pune" ? "Pune" : c === "gurugram" ? "Gurugram" : "No campus"}</td>
                              <td className="py-1.5 text-right">{r.male}</td><td className="py-1.5 text-right">{r.female}</td><td className="py-1.5 text-right">{r.total}</td>
                            </tr>
                          );
                        })}
                        <tr className="border-t border-vx-line font-semibold">
                          <td className="py-1.5">Overall</td>
                          <td className="py-1.5 text-right">{data.cutoff.overall.male}</td><td className="py-1.5 text-right">{data.cutoff.overall.female}</td>
                          <td className="py-1.5 text-right">{data.cutoff.total}</td>
                        </tr>
                      </tbody>
                    </table>
                    <p className="mt-2 text-[12px] text-vx-faint">
                      {data.cutoff.vps !== null ? <>On this VSAT&apos;s curve that is VPS {fmt(data.cutoff.vps)}. </> : null}
                      Female : male {ratio(data.cutoff.overall)}.
                    </p>
                    {canSelect && (
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <button className={cx(vx.btn, vx.primary)} disabled={!single} onClick={() => setPi(true)}>Select for PI at ≥ {fmt(cut)}</button>
                        {!single && <span className="text-[12px] text-vx-faint">Pick one VSAT to select for PI (each VSAT has its own cut-off).</span>}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      )}
      {pi && single && (
        <SelectForPiDialog examDateId={vsatIds[0]} percentile={cut} onClose={() => setPi(false)}
          onApplied={() => { onApplied(); void load(); }} />
      )}
    </section>
  );
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

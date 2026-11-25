"use client";
import { useState, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import { cx, vx } from "@/components/admin/ui/vx";
import { STAGE_LABEL, errorText, type Stage } from "@/lib/vsat/pipeline";
import {
  CHEATING_OPTIONS, CHEATING_TITLE, DROP_YEAR_TITLE, FINANCIAL_HELP, FINANCIAL_OPTIONS, FINANCIAL_TITLE, NUMBER_QUESTIONS,
  PART_QUESTIONS, REMARK_MAX, TEXT_QUESTIONS, YES_NO, buildInterviewRequest, emptyInterviewForm,
  type InterviewFormState, type NumberKey, type Part, type TextKey, type YesNo,
} from "@/lib/vsat/interview-form";
import { verdictLabel } from "@/lib/vsat/interview-evaluation";

/**
 * The interview form (0173) — sir's Google Form, question by question, every question required. No verdict here: it
 * comes from Interview Evaluation. Saving keeps the stage as it is (admissions moves it). The database checks it all again.
 */

const NUMBER_TEXT: Record<NumberKey, string> = Object.fromEntries(NUMBER_QUESTIONS.map((q) => [q.key, q.title])) as Record<NumberKey, string>;

function Q({ title, help, children, id }: { title: string; help?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <fieldset className="space-y-2" aria-describedby={help && id ? `${id}-help` : undefined}>
      <legend className="text-[14px] font-medium text-vx-ink">{title} <span className="text-vx-red" aria-hidden>*</span></legend>
      {help && <div id={id ? `${id}-help` : undefined} className="space-y-0.5 text-[12.5px] leading-relaxed text-vx-faint">{help}</div>}
      {children}
    </fieldset>
  );
}

function Choice({ name, value, current, label, onPick }: { name: string; value: string; current: string; label: string; onPick: (v: string) => void }) {
  const on = current === value;
  return (
    <label className={cx("inline-flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-[13px] transition-colors",
      on ? "border-vx-violet bg-vx-violet/20 text-vx-ink" : "border-vx-line2 bg-white/[0.03] text-vx-mut hover:text-vx-ink")}>
      <input type="radio" className="sr-only" name={name} value={value} checked={on} onChange={() => onPick(value)} />
      {label}
    </label>
  );
}

export function InterviewFormBox({ applicationId, onDone }: { applicationId: string; onDone: () => void }) {
  const [supabase] = useState(() => createClient());
  const [f, setF] = useState<InterviewFormState>(emptyInterviewForm);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const set = (patch: Partial<InterviewFormState>) => setF((x) => ({ ...x, ...patch }));
  const setPart = (k: Part, v: number) => setF((x) => ({ ...x, parts: { ...x.parts, [k]: v } }));
  const setRemark = (k: Part, v: string) => setF((x) => ({ ...x, remarks: { ...x.remarks, [k]: v } }));
  const setText = (k: TextKey, v: string) => setF((x) => ({ ...x, text: { ...x.text, [k]: v } }));
  const setNum = (k: NumberKey, v: Partial<{ value: string; na: boolean }>) => setF((x) => ({ ...x, numbers: { ...x.numbers, [k]: { ...x.numbers[k], ...v } } }));
  const fid = (k: string) => `ivf-${applicationId}-${k}`;

  async function submit() {
    const built = buildInterviewRequest(applicationId, f);
    if (!built.ok) { setErrors(built.errors); setMsg(""); return; }
    setErrors([]); setBusy(true); setMsg("");
    const { data, error } = await supabase.rpc("vsat_submit_interview", { p: built.p });
    setBusy(false);
    if (error) return setMsg(errorText(error.message));
    const d = data as { score: number; ranking: number; verdict: string | null; stage: Stage };
    setMsg(`Saved ✓ Weighted score ${d.score} · final score ${d.ranking} out of 20 · verdict: ${verdictLabel(d.verdict)}${d.verdict ? "" : " (decided in Interview Evaluation)"}. The stage stays ${STAGE_LABEL[d.stage]}.`);
    onDone();
  }

  const yesNo = (name: string, value: YesNo, onPick: (v: YesNo) => void) => (
    <div className="flex flex-wrap gap-2" role="radiogroup">
      <Choice name={name} value="yes" current={value} label="Yes" onPick={(v) => onPick(v as YesNo)} />
      <Choice name={name} value="no" current={value} label="No" onPick={(v) => onPick(v as YesNo)} />
    </div>
  );
  const textArea = (k: TextKey, rows = 2) => (
    <textarea id={fid(k)} className={vx.input} rows={rows} maxLength={TEXT_QUESTIONS[k].max} value={f.text[k]}
      onChange={(e) => setText(k, e.target.value)} aria-label={TEXT_QUESTIONS[k].title} />
  );
  const numberQ = (k: NumberKey) => {
    const q = NUMBER_QUESTIONS.find((x) => x.key === k)!;
    return (
      <Q key={k} title={NUMBER_TEXT[k]} help={q.help || undefined} id={fid(k)}>
        <div className="flex items-center gap-3">
          <input className={cx(vx.input, "max-w-[10rem]")} type="text" inputMode="decimal" placeholder="0–100" value={f.numbers[k].value}
            disabled={f.numbers[k].na} onChange={(e) => setNum(k, { value: e.target.value })} aria-label={NUMBER_TEXT[k]} />
          <label className="inline-flex items-center gap-2 text-[13px] text-vx-mut">
            <input type="checkbox" className={vx.check} checked={f.numbers[k].na} onChange={(e) => setNum(k, { na: e.target.checked, value: e.target.checked ? "" : f.numbers[k].value })} />
            N/A
          </label>
        </div>
      </Q>
    );
  };

  return (
    <div className="space-y-4 rounded-lg border border-vx-violet/30 p-3 sm:p-4">
      <div>
        <p className="text-sm font-semibold text-vx-violet-t">Interview form</p>
        <p className="text-[12.5px] text-vx-faint">Every question is required, as in the Google Form. There is no verdict here: it is decided later in Interview Evaluation from everyone&apos;s scores.</p>
      </div>

      {PART_QUESTIONS.map((q) => (
        <div key={q.key} className="space-y-3 rounded-lg border border-vx-line bg-white/[0.02] p-3">
          <Q title={q.title} id={fid(q.key)} help={q.help.length ? q.help.map((h) => <p key={h}>{h}</p>) : undefined}>
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={q.title}>
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} type="button" role="radio" aria-checked={f.parts[q.key] === n} onClick={() => setPart(q.key, n)}
                  className={cx("h-9 w-9 rounded-lg border text-sm font-semibold transition-colors",
                    f.parts[q.key] === n ? "border-vx-violet bg-vx-violet text-white" : "border-vx-line2 bg-white/5 text-vx-mut hover:text-vx-ink")}>{n}</button>
              ))}
            </div>
          </Q>
          {q.key === "logic" && (
            <Q title={CHEATING_TITLE} id={fid("cheating")}>
              <div className="flex flex-wrap gap-2" role="radiogroup">
                {CHEATING_OPTIONS.map((o) => <Choice key={o.value} name={fid("cheating")} value={o.value} current={f.cheating} label={o.label} onPick={(v) => set({ cheating: v as YesNo })} />)}
              </div>
            </Q>
          )}
          {(Object.entries(YES_NO) as [keyof typeof YES_NO, (typeof YES_NO)[keyof typeof YES_NO]][]).filter(([, y]) => y.after === q.key).map(([k, y]) => (
            <Q key={k} title={y.title} id={fid(k)}>{yesNo(fid(k), f[k], (v) => set({ [k]: v } as Partial<InterviewFormState>))}</Q>
          ))}
          <Q title={q.remarkTitle} id={fid(`${q.key}-remark`)}>
            <textarea className={vx.input} rows={2} maxLength={REMARK_MAX} value={f.remarks[q.key]} onChange={(e) => setRemark(q.key, e.target.value)} aria-label={q.remarkTitle} />
          </Q>
        </div>
      ))}

      <div className="space-y-3 rounded-lg border border-vx-line bg-white/[0.02] p-3">
        <Q title={DROP_YEAR_TITLE} id={fid("drop")}>{yesNo(fid("drop"), f.drop_year, (v) => set({ drop_year: v }))}</Q>
        <Q title={TEXT_QUESTIONS.previous_jee.title} id={fid("previous_jee")}>{textArea("previous_jee", 1)}</Q>
        {numberQ("jee_pct")}{numberQ("jee_maths_pct")}{numberQ("expected_jee_pct")}
        <Q title={TEXT_QUESTIONS.other_exams.title} id={fid("other_exams")}>{textArea("other_exams", 1)}</Q>
        {numberQ("class12_pct")}{numberQ("class11_pct")}{numberQ("class10_pct")}
      </div>

      <div className="space-y-3 rounded-lg border border-vx-line bg-white/[0.02] p-3">
        <Q title={FINANCIAL_TITLE} id={fid("fin")} help={<p>{FINANCIAL_HELP}</p>}>
          <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label={FINANCIAL_TITLE}>
            {FINANCIAL_OPTIONS.map((o) => (
              <label key={o.value} className={cx("cursor-pointer rounded-lg border p-2.5 text-[12.5px] leading-snug transition-colors",
                f.financial === o.value ? "border-vx-violet bg-vx-violet/15 text-vx-ink" : "border-vx-line2 bg-white/[0.03] text-vx-mut hover:text-vx-ink")}>
                <input type="radio" className="sr-only" name={fid("fin")} value={o.value} checked={f.financial === o.value} onChange={() => set({ financial: o.value })} />
                <span className="block text-[13px] font-semibold text-vx-ink">{o.label}</span>{o.help}
              </label>
            ))}
          </div>
        </Q>
        <Q title={TEXT_QUESTIONS.financial_reason.title} id={fid("financial_reason")}>{textArea("financial_reason")}</Q>
        <Q title={TEXT_QUESTIONS.why_accept.title} id={fid("why_accept")}>{textArea("why_accept", 3)}</Q>
      </div>

      {errors.length > 0 && (
        <div role="alert" className={vx.error}>
          <p className="mb-1 font-medium">Please complete the form:</p>
          <ul className="list-disc space-y-0.5 pl-5">{errors.map((e) => <li key={e}>{e}</li>)}</ul>
        </div>
      )}
      <p className="text-xs text-vx-faint">The weighted score is calculated from the five marks (the sheet&apos;s weights). Submitting saves the form once; the stage does not change.</p>
      <button className={cx(vx.btn, vx.primary)} disabled={busy} onClick={submit}>{busy ? "Submitting…" : "Submit interview"}</button>
      {msg && <p className="text-xs text-vx-ink" role="status">{msg}</p>}
    </div>
  );
}

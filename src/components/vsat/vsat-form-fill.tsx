"use client";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type QType = "text" | "textarea" | "number" | "date" | "dropdown" | "file";
type Question = { key: string; label: string; type: QType; required?: boolean; options?: string[]; exception?: { key: string; label: string } };
type Category = { key: string; title: string; questions: Question[] };
type Schema = { categories: Category[] };

const input = "w-full rounded-lg border border-[#d9d2ec] bg-white px-3 py-2 text-sm text-[#1b1430] focus:border-[#7b2ff7] focus:outline-none";
const grad = "rounded-xl bg-gradient-to-r from-[#00cfe5] to-[#c200db] px-6 py-2.5 text-sm font-semibold text-white disabled:opacity-50";

/**
 * Renders the active VSAT form for a paid applicant, one category at a time
 * (save-and-next). Validation + progress live in the DB rpcs; this only collects
 * answers and shows what the server reports. onDone fires when the form submits.
 */
export function VsatFormFill({ onDone }: { onDone?: () => void }) {
  const [supabase] = useState(() => createClient());
  const [schema, setSchema] = useState<Schema | null>(null);
  const [formId, setFormId] = useState("");
  const [formName, setFormName] = useState("");
  const [completed, setCompleted] = useState<string[]>([]);
  const [answers, setAnswers] = useState<Record<string, Record<string, string>>>({});
  const [exc, setExc] = useState<Record<string, boolean>>({}); // questionKey -> exception invoked
  const [idx, setIdx] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [missing, setMissing] = useState<string[]>([]);
  const [done, setDone] = useState(false);
  const [code, setCode] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setErr("");
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setLoading(false); setCode("UNAUTHENTICATED"); return; }
    const { data } = await supabase.rpc("vsat_form_active_for_fill");
    setLoading(false);
    if (!data?.ok) { setCode(data?.code || "ERROR"); return; }
    if (!data.form) { setCode("NO_ACTIVE_FORM"); return; }
    setFormId(data.form.id); setFormName(data.form.name);
    setSchema(data.form.schema as Schema);
    const comp = (data.progress?.completed as string[]) ?? [];
    setCompleted(comp);
    setAnswers((data.answers as Record<string, Record<string, string>>) ?? {});
    if (data.progress?.submitted) { setDone(true); return; }
    // jump to the first not-yet-completed category
    const cats = (data.form.schema as Schema).categories;
    const firstIncomplete = cats.findIndex((c) => !comp.includes(c.key));
    setIdx(firstIncomplete < 0 ? 0 : firstIncomplete);
  }, [supabase]);
  useEffect(() => { void load(); }, [load]);

  if (loading) return <div className={"rounded-2xl border border-[#ece8f6] bg-white p-6 text-sm text-[#6b647e]"}>Loading your form…</div>;
  if (code === "NO_ACTIVE_FORM") return <div className="rounded-2xl border border-[#ece8f6] bg-white p-6 text-sm text-[#6b647e]">The application form isn&apos;t open yet. We&apos;ll notify you when it is.</div>;
  if (code === "NOT_PAID") return <div className="rounded-2xl border border-[#ece8f6] bg-white p-6 text-sm text-[#6b647e]">Pay the VSAT fee to unlock the application form.</div>;
  if (done) return (
    <div className="rounded-2xl border border-[#16a34a]/30 bg-[#16a34a]/5 p-6">
      <h3 className="font-display text-lg font-bold text-[#16a34a]">Application form submitted ✅</h3>
      <p className="mt-1 text-sm text-[#4b5563]">You can now select your VSAT exam slot.</p>
    </div>
  );
  if (!schema || schema.categories.length === 0) return <div className="rounded-2xl border border-[#ece8f6] bg-white p-6 text-sm text-[#6b647e]">This form has no questions yet.</div>;

  const cat = schema.categories[idx];
  const catAns = answers[cat.key] ?? {};

  const setVal = (qk: string, v: string) => setAnswers((a) => ({ ...a, [cat.key]: { ...(a[cat.key] ?? {}), [qk]: v } }));

  async function saveNext() {
    setBusy(true); setErr(""); setMissing([]);
    const exceptions = cat.questions.filter((q) => q.exception && exc[q.key]).map((q) => q.exception!.key);
    const { data } = await supabase.rpc("vsat_form_save_category", { p: { formId, category: cat.key, answers: catAns, exceptions } });
    setBusy(false);
    if (!data?.ok) {
      if (data?.code === "MISSING_REQUIRED") { setMissing((data.fields as string[]) ?? []); setErr("Please fill the required fields (or tick the skip option)."); return; }
      if (data?.code === "FORM_CHANGED") { setErr("The form was updated. Reloading…"); void load(); return; }
      setErr(data?.code || "Couldn't save. Try again."); return;
    }
    const nextCompleted = completed.includes(cat.key) ? completed : [...completed, cat.key];
    setCompleted(nextCompleted);
    if (data.submitted) { setDone(true); onDone?.(); return; }
    // advance to the next not-completed category
    const next = schema!.categories.findIndex((c, i) => i > idx && !nextCompleted.includes(c.key));
    setIdx(next < 0 ? Math.min(idx + 1, schema!.categories.length - 1) : next);
  }

  const pct = Math.round((completed.length / schema.categories.length) * 100);

  return (
    <div className="rounded-2xl border border-[#ece8f6] bg-white p-6 shadow-[0_8px_30px_-18px_rgba(90,40,160,0.25)]">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[#9a93ad]">{formName}</p>
          <h3 className="font-display text-xl font-bold">{cat.title}</h3>
        </div>
        <span className="text-xs text-[#9a93ad]">{idx + 1}/{schema.categories.length} · {pct}%</span>
      </div>
      <div className="mt-2 h-1.5 w-full rounded-full bg-[#f0edf8]"><div className="h-full rounded-full bg-gradient-to-r from-[#00cfe5] to-[#c200db]" style={{ width: `${pct}%` }} /></div>

      <div className="mt-5 space-y-4">
        {cat.questions.map((q) => {
          const skipped = !!(q.exception && exc[q.key]);
          const isMissing = missing.includes(q.key);
          return (
            <div key={q.key}>
              <label className="mb-1 block text-sm font-medium text-[#1b1430]">{q.label}{q.required && <span className="text-[#d14343]"> *</span>}</label>
              {q.type === "textarea" ? (
                <textarea value={catAns[q.key] ?? ""} onChange={(e) => setVal(q.key, e.target.value)} disabled={skipped} rows={3} className={`${input} ${isMissing ? "border-[#d14343]" : ""}`} />
              ) : q.type === "dropdown" ? (
                <select value={catAns[q.key] ?? ""} onChange={(e) => setVal(q.key, e.target.value)} disabled={skipped} className={`${input} ${isMissing ? "border-[#d14343]" : ""}`}>
                  <option value="">Select…</option>
                  {(q.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : (
                <input type={q.type === "number" ? "number" : q.type === "date" ? "date" : q.type === "file" ? "text" : "text"}
                  value={catAns[q.key] ?? ""} onChange={(e) => setVal(q.key, e.target.value)} disabled={skipped}
                  placeholder={q.type === "file" ? "Paste a link to your document for now" : ""}
                  className={`${input} ${isMissing ? "border-[#d14343]" : ""} ${skipped ? "opacity-40" : ""}`} />
              )}
              {q.exception && (
                <label className="mt-1.5 flex items-center gap-2 text-xs text-[#6b647e]">
                  <input type="checkbox" checked={!!exc[q.key]} onChange={(e) => setExc((x) => ({ ...x, [q.key]: e.target.checked }))} />
                  {q.exception.label}
                </label>
              )}
            </div>
          );
        })}
      </div>

      {err && <p className="mt-4 text-xs text-[#d14343]">{err}</p>}
      <div className="mt-6 flex items-center justify-between">
        <button onClick={() => setIdx((i) => Math.max(0, i - 1))} disabled={idx === 0 || busy} className="rounded-xl border border-[#d9d2ec] px-5 py-2.5 text-sm font-semibold text-[#1b1430] disabled:opacity-40">Back</button>
        <button onClick={saveNext} disabled={busy} className={grad}>{busy ? "Saving…" : idx === schema.categories.length - 1 ? "Submit application" : "Save & next"}</button>
      </div>
    </div>
  );
}

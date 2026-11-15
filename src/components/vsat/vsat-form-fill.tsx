"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { INDIA_STATES, STATE_CITIES } from "@/lib/india-cities";

type QType = "text" | "textarea" | "number" | "date" | "dropdown" | "file" | "school" | "state" | "city";
type Question = { key: string; label: string; type: QType; required?: boolean; options?: string[]; exception?: { key: string; label: string } };
type Category = { key: string; title: string; questions: Question[] };
type Schema = { categories: Category[] };

const input = "w-full rounded-lg border border-[#d9d2ec] bg-white px-3 py-2 text-sm text-[#1b1430] focus:border-[#7b2ff7] focus:outline-none";
const grad = "rounded-xl bg-gradient-to-r from-[#00cfe5] to-[#c200db] px-6 py-2.5 text-sm font-semibold text-white disabled:opacity-50";

type SchoolHit = { code?: string; name: string; district?: string; state?: string };
const schoolLabel = (h: SchoolHit) => [h.name, [h.district, h.state].filter(Boolean).join(", ")].filter(Boolean).join(" — ");

/**
 * Dataset-backed school picker: type-ahead against vsat_school_search (the
 * school_database holds lakhs of UDISE schools, so this never ships the list to
 * the browser). The stored answer is the human-readable "Name — District, State".
 */
function SchoolSelect({ value, disabled, invalid, onChange }:
  { value: string; disabled?: boolean; invalid?: boolean; onChange: (v: string) => void }) {
  const [supabase] = useState(() => createClient());
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SchoolHit[]>([]);
  const [searching, setSearching] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const seq = useRef(0);

  useEffect(() => {
    function onClick(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }
    if (open) document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  useEffect(() => {
    const t = q.trim();
    if (t.length < 2) { setHits([]); setSearching(false); return; }
    setSearching(true);
    const mine = ++seq.current;
    const id = setTimeout(async () => {
      const { data } = await supabase.rpc("vsat_school_search", { p: { q: t } });
      if (mine !== seq.current) return; // a newer keystroke won
      setHits(data?.ok ? ((data.schools as SchoolHit[]) ?? []) : []);
      setSearching(false);
    }, 280); // debounce
    return () => clearTimeout(id);
  }, [q, supabase]);

  return (
    <div className="relative" ref={ref}>
      <button type="button" disabled={disabled} onClick={() => setOpen((v) => !v)}
        className={`${input} flex items-center justify-between text-left ${invalid ? "border-[#d14343]" : ""} ${disabled ? "opacity-40" : ""}`}>
        <span className={`truncate ${value ? "text-[#1b1430]" : "text-[#9a93ad]"}`}>{value || "Search your school…"}</span>
        <span className="ml-2 text-[#9a93ad]">▾</span>
      </button>
      {open && !disabled && (
        <div className="absolute z-20 mt-1 max-h-72 w-full overflow-hidden rounded-xl border border-[#ece8f6] bg-white shadow-[0_18px_40px_-18px_rgba(43,19,92,0.4)]">
          <div className="p-2">
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type school name (min 2 letters)…" className={input} />
          </div>
          <ul className="max-h-56 overflow-y-auto pb-1">
            {q.trim().length < 2 && <li className="px-3 py-3 text-center text-sm text-[#9a93ad]">Type at least 2 letters</li>}
            {q.trim().length >= 2 && searching && <li className="px-3 py-3 text-center text-sm text-[#9a93ad]">Searching…</li>}
            {q.trim().length >= 2 && !searching && hits.length === 0 && <li className="px-3 py-3 text-center text-sm text-[#9a93ad]">No schools found</li>}
            {hits.map((h, i) => {
              const lbl = schoolLabel(h);
              return (
                <li key={(h.code ?? "") + i}>
                  <button type="button" onClick={() => { onChange(lbl); setOpen(false); setQ(""); setHits([]); }}
                    className="block w-full px-3 py-2 text-left text-sm text-[#1b1430] hover:bg-[#f6f2fe]">
                    <span className="font-medium">{h.name}</span>
                    {(h.district || h.state) && <span className="block text-xs text-[#9a93ad]">{[h.district, h.state].filter(Boolean).join(", ")}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

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
  // Selecting a State clears City answers in the same category (they cascade off it).
  const setStateVal = (qk: string, v: string) => setAnswers((a) => {
    const c: Record<string, string> = { ...(a[cat.key] ?? {}), [qk]: v };
    for (const qq of cat.questions) if (qq.type === "city") c[qq.key] = "";
    return { ...a, [cat.key]: c };
  });
  // The State a City question cascades off = nearest preceding State question's answer.
  const stateValueBefore = (qi: number) => {
    for (let i = qi - 1; i >= 0; i--) if (cat.questions[i].type === "state") return catAns[cat.questions[i].key] ?? "";
    return "";
  };

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
        {cat.questions.map((q, qi) => {
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
              ) : q.type === "school" ? (
                <SchoolSelect value={catAns[q.key] ?? ""} disabled={skipped} invalid={isMissing} onChange={(v) => setVal(q.key, v)} />
              ) : q.type === "state" ? (
                <SearchableSelect options={INDIA_STATES} value={catAns[q.key] ?? ""} disabled={skipped} onChange={(v) => setStateVal(q.key, v)} placeholder="Select state…" />
              ) : q.type === "city" ? (
                (() => { const st = stateValueBefore(qi); return (
                  <SearchableSelect options={st ? (STATE_CITIES[st] ?? []) : []} value={catAns[q.key] ?? ""} disabled={skipped || !st} onChange={(v) => setVal(q.key, v)} placeholder={st ? "Select city…" : "Pick a state first"} />
                ); })()
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

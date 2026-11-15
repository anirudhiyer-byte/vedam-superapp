"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { CitySelect } from "@/components/ui/city-select";
import { INDIA_STATES } from "@/lib/india-cities";

type QType = "text" | "textarea" | "number" | "date" | "dropdown" | "checkbox" | "radio" | "file" | "school" | "state" | "city";
type Question = {
  key: string; label: string; type: QType; required?: boolean;
  options?: string[]; help?: string; accept?: string[]; maxSizeMb?: number; multiple?: boolean;
  exception?: { key: string; label: string };
};
type SubCategory = { key: string; title: string; questions: Question[] };
type Category = { key: string; title: string; questions: Question[]; subcategories?: SubCategory[] };
type Schema = { categories: Category[] };
type FileRef = { path: string; name: string; size: number; type?: string };

const input = "w-full rounded-lg border border-[#d9d2ec] bg-white px-3 py-2 text-sm text-[#1b1430] focus:border-[#7b2ff7] focus:outline-none";
const grad = "rounded-xl bg-gradient-to-r from-[#00cfe5] to-[#c200db] px-6 py-2.5 text-sm font-semibold text-white disabled:opacity-50";

type SchoolHit = { code?: string; name: string; district?: string; state?: string };
const schoolLabel = (h: SchoolHit) => [h.name, [h.district, h.state].filter(Boolean).join(", ")].filter(Boolean).join(" — ");

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
      if (mine !== seq.current) return;
      setHits(data?.ok ? ((data.schools as SchoolHit[]) ?? []) : []);
      setSearching(false);
    }, 280);
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

const uploadError = (d: { error?: string; maxMb?: number }) =>
  d?.error === "too_large" ? `File is too large${d.maxMb ? ` (max ${d.maxMb} MB)` : ""}.`
  : d?.error === "bad_type" ? "That file type isn't allowed here."
  : d?.error === "not_paid" ? "Pay the VSAT fee to upload."
  : "Upload failed. Please try again.";

function FileField({ catKey, q, token, value, disabled, invalid, onChange }:
  { catKey: string; q: Question; token: string; value: FileRef[]; disabled?: boolean; invalid?: boolean; onChange: (v: FileRef[]) => void }) {
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState("");
  const ref = useRef<HTMLInputElement>(null);
  const files = Array.isArray(value) ? value : [];

  async function onPick(list: FileList | null) {
    if (!list || list.length === 0) return;
    setErr("");
    let picked = Array.from(list);
    if (!q.multiple) picked = picked.slice(0, 1);
    setUploading(true);
    const added: FileRef[] = [];
    for (const f of picked) {
      const fd = new FormData();
      fd.append("accessToken", token);
      fd.append("category", catKey);
      fd.append("question", q.key);
      fd.append("file", f);
      try {
        const res = await fetch("/api/vsat/app-file", { method: "POST", body: fd });
        const d = await res.json().catch(() => ({}));
        if (d?.ok && d.file) added.push(d.file as FileRef);
        else { setErr(uploadError(d)); break; }
      } catch { setErr("Upload failed. Please try again."); break; }
    }
    setUploading(false);
    if (ref.current) ref.current.value = "";
    if (added.length) onChange(q.multiple ? [...files, ...added] : added);
  }

  return (
    <div>
      {files.length > 0 && (
        <ul className="mb-2 space-y-1">
          {files.map((f, i) => (
            <li key={f.path} className="flex items-center justify-between rounded-lg border border-[#ece8f6] bg-[#faf8ff] px-3 py-1.5 text-sm">
              <span className="truncate text-[#1b1430]">📄 {f.name}</span>
              {!disabled && <button type="button" onClick={() => onChange(files.filter((_, j) => j !== i))} className="ml-2 shrink-0 text-xs text-[#9a93ad] hover:text-[#d14343]">Remove</button>}
            </li>
          ))}
        </ul>
      )}
      {(q.multiple || files.length === 0) && (
        <label className={`inline-flex cursor-pointer items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-sm ${invalid ? "border-[#d14343] text-[#d14343]" : "border-[#c7bdf0] text-[#6b3ff7]"} ${disabled || uploading ? "opacity-50" : "hover:bg-[#f6f2fe]"}`}>
          <input ref={ref} type="file" className="hidden" disabled={disabled || uploading}
            accept={(q.accept ?? []).join(",") || undefined} multiple={!!q.multiple}
            onChange={(e) => onPick(e.target.files)} />
          {uploading ? "Uploading…" : files.length > 0 ? "+ Add another file" : "⬆ Choose file"}
        </label>
      )}
      {q.accept && q.accept.length > 0 && <p className="mt-1 text-xs text-[#9a93ad]">Allowed: {q.accept.join(", ")}{q.maxSizeMb ? ` · up to ${q.maxSizeMb} MB each` : ""}</p>}
      {err && <p className="mt-1 text-xs text-[#d14343]">{err}</p>}
    </div>
  );
}

export function VsatFormFill({ onDone }: { onDone?: () => void }) {
  const [supabase] = useState(() => createClient());
  const [schema, setSchema] = useState<Schema | null>(null);
  const [formId, setFormId] = useState("");
  const [formName, setFormName] = useState("");
  const [token, setToken] = useState("");
  const [completed, setCompleted] = useState<string[]>([]);
  const [answers, setAnswers] = useState<Record<string, Record<string, unknown>>>({});
  const [exc, setExc] = useState<Record<string, boolean>>({});
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
    setToken(session.access_token);
    const { data } = await supabase.rpc("vsat_form_active_for_fill");
    setLoading(false);
    if (!data?.ok) { setCode(data?.code || "ERROR"); return; }
    if (!data.form) { setCode("NO_ACTIVE_FORM"); return; }
    setFormId(data.form.id); setFormName(data.form.name);
    setSchema(data.form.schema as Schema);
    const comp = (data.progress?.completed as string[]) ?? [];
    setCompleted(comp);
    setAnswers((data.answers as Record<string, Record<string, unknown>>) ?? {});
    if (data.progress?.submitted) { setDone(true); return; }
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
  const subs = cat.subcategories ?? [];
  const allQs: Question[] = [...cat.questions, ...subs.flatMap((s) => s.questions)];
  const catAns = answers[cat.key] ?? {};

  const asStr = (v: unknown) => (typeof v === "string" ? v : "");
  const asArr = (v: unknown): string[] => (Array.isArray(v) ? (v as string[]) : []);
  const asFiles = (v: unknown): FileRef[] => (Array.isArray(v) ? (v as FileRef[]) : []);

  const setVal = (qk: string, v: unknown) => setAnswers((a) => ({ ...a, [cat.key]: { ...(a[cat.key] ?? {}), [qk]: v } }));
  // Selecting a State clears every City answer in the same category (they cascade off it).
  const setStateVal = (qk: string, v: string) => setAnswers((a) => {
    const c: Record<string, unknown> = { ...(a[cat.key] ?? {}), [qk]: v };
    for (const qq of allQs) if (qq.type === "city") c[qq.key] = "";
    return { ...a, [cat.key]: c };
  });
  // nearest preceding State answer in the flattened render order
  const stateBefore = (q: Question) => {
    const at = allQs.findIndex((x) => x.key === q.key);
    for (let i = at - 1; i >= 0; i--) if (allQs[i].type === "state") return asStr(catAns[allQs[i].key]);
    return "";
  };

  async function saveNext() {
    setBusy(true); setErr(""); setMissing([]);
    const exceptions = allQs.filter((q) => q.exception && exc[q.key]).map((q) => q.exception!.key);
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
    const next = schema!.categories.findIndex((c, i) => i > idx && !nextCompleted.includes(c.key));
    setIdx(next < 0 ? Math.min(idx + 1, schema!.categories.length - 1) : next);
  }

  const pct = Math.round((completed.length / schema.categories.length) * 100);

  // one question renderer (used at category level and inside subcategories)
  const renderQuestion = (q: Question) => {
    const skipped = !!(q.exception && exc[q.key]);
    const isMissing = missing.includes(q.key);
    return (
      <div key={q.key}>
        <label className="mb-1 block text-sm font-medium text-[#1b1430]">{q.label}{q.required && <span className="text-[#d14343]"> *</span>}</label>
        {q.help && <p className="mb-1.5 text-xs text-[#6b647e]">{q.help}</p>}
        {q.type === "textarea" ? (
          <textarea value={asStr(catAns[q.key])} onChange={(e) => setVal(q.key, e.target.value)} disabled={skipped} rows={3} className={`${input} ${isMissing ? "border-[#d14343]" : ""}`} />
        ) : q.type === "dropdown" ? (
          <select value={asStr(catAns[q.key])} onChange={(e) => setVal(q.key, e.target.value)} disabled={skipped} className={`${input} ${isMissing ? "border-[#d14343]" : ""}`}>
            <option value="">Select…</option>
            {(q.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        ) : q.type === "radio" ? (
          <div className={`space-y-1.5 ${skipped ? "opacity-40" : ""}`}>
            {(q.options ?? []).map((o) => (
              <label key={o} className="flex items-center gap-2 text-sm text-[#1b1430]">
                <input type="radio" name={`${cat.key}-${q.key}`} checked={asStr(catAns[q.key]) === o} disabled={skipped} onChange={() => setVal(q.key, o)} />
                {o}
              </label>
            ))}
          </div>
        ) : q.type === "checkbox" ? (
          <div className={`space-y-1.5 ${skipped ? "opacity-40" : ""} ${isMissing ? "rounded-lg border border-[#d14343] p-2" : ""}`}>
            {(q.options ?? []).map((o) => {
              const arr = asArr(catAns[q.key]);
              return (
                <label key={o} className="flex items-center gap-2 text-sm text-[#1b1430]">
                  <input type="checkbox" checked={arr.includes(o)} disabled={skipped}
                    onChange={(e) => setVal(q.key, e.target.checked ? [...arr, o] : arr.filter((x) => x !== o))} />
                  {o}
                </label>
              );
            })}
          </div>
        ) : q.type === "file" ? (
          <FileField catKey={cat.key} q={q} token={token} value={asFiles(catAns[q.key])} disabled={skipped} invalid={isMissing} onChange={(v) => setVal(q.key, v)} />
        ) : q.type === "school" ? (
          <SchoolSelect value={asStr(catAns[q.key])} disabled={skipped} invalid={isMissing} onChange={(v) => setVal(q.key, v)} />
        ) : q.type === "state" ? (
          <SearchableSelect options={INDIA_STATES} value={asStr(catAns[q.key])} disabled={skipped} onChange={(v) => setStateVal(q.key, v)} placeholder="Select state…" />
        ) : q.type === "city" ? (
          <CitySelect state={stateBefore(q)} value={asStr(catAns[q.key])} disabled={skipped || !stateBefore(q)} invalid={isMissing} onChange={(v) => setVal(q.key, v)} inputClassName={input} />
        ) : (
          <input type={q.type === "number" ? "number" : q.type === "date" ? "date" : "text"}
            value={asStr(catAns[q.key])} onChange={(e) => setVal(q.key, e.target.value)} disabled={skipped}
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
  };

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
        {cat.questions.map(renderQuestion)}
        {subs.map((s) => (
          <div key={s.key} className="rounded-xl border border-[#ece8f6] bg-[#faf8ff] p-4">
            <h4 className="mb-3 text-sm font-semibold text-[#2b135c]">{s.title}</h4>
            <div className="space-y-4">{s.questions.map(renderQuestion)}</div>
          </div>
        ))}
      </div>

      {err && <p className="mt-4 text-xs text-[#d14343]">{err}</p>}
      <div className="mt-6 flex items-center justify-between">
        <button onClick={() => setIdx((i) => Math.max(0, i - 1))} disabled={idx === 0 || busy} className="rounded-xl border border-[#d9d2ec] px-5 py-2.5 text-sm font-semibold text-[#1b1430] disabled:opacity-40">Back</button>
        <button onClick={saveNext} disabled={busy} className={grad}>{busy ? "Saving…" : idx === schema.categories.length - 1 ? "Submit application" : "Save & next"}</button>
      </div>
    </div>
  );
}

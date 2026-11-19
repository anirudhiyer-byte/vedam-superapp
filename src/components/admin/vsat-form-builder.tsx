"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type QType = "text" | "textarea" | "number" | "date" | "dropdown" | "checkbox" | "radio" | "file" | "school" | "state" | "city" | "board" | "dob";
type Cond = { q: string; op: "eq" | "neq" | "includes"; value: string };
type Route = { value: string; to: string }; // to = category key | "__next__" | "__submit__"
type Question = {
  key: string;          // stable identifier (so conditions survive label edits)
  label: string; type: QType; required: boolean;
  options?: string;     // dropdown / checkbox / radio — comma separated
  help?: string;        // guidance text shown under the label (any type)
  accept?: string;      // file — comma separated types/extensions
  maxSizeMb?: string;   // file — max size per file in MB
  multiple?: boolean;   // file — allow more than one
  hasException?: boolean; exceptionLabel?: string;
  showIf?: Cond;        // conditional visibility
  routes?: Route[];     // dropdown/radio — per-answer section branching
  column?: string;      // application_manager column this answer syncs into (set in the DB mapping; preserved here so a builder save never wipes it)
  cast?: string;        // how the answer is cast for that column: text | number | year | bool | date
};
type SubCategory = { key: string; title: string; questions: Question[] };
type Category = { key: string; title: string; questions: Question[]; subcategories: SubCategory[]; collapsed?: boolean; next?: string };
type FormDraft = { id?: string; name: string; categories: Category[] };
type FormRow = { id: string; name: string; status: string; version: number; categories: number; updatedAt: string; admin_only?: boolean };

const QTYPES: QType[] = ["text", "textarea", "number", "date", "dob", "dropdown", "checkbox", "radio", "file", "school", "state", "city", "board"];
const TYPE_LABEL: Record<QType, string> = {
  text: "Short text", textarea: "Paragraph", number: "Number", date: "Date", dob: "Date of birth (DD/MM/YYYY)",
  dropdown: "Dropdown (pick one)", checkbox: "Checkboxes (pick many)", radio: "Multiple choice (pick one)",
  file: "File upload", school: "School (searchable)", state: "State / UT", city: "City", board: "Board (CBSE/ICSE/State…)",
};
const HAS_OPTIONS = (t: QType) => t === "dropdown" || t === "checkbox" || t === "radio";
const CAN_ROUTE = (t: QType) => t === "dropdown" || t === "radio"; // single-choice can branch
const DATASET_HINTS: Partial<Record<QType, string>> = {
  school: "Searchable from the school database (name · district · state).",
  state: "Indian states/UTs — searchable dropdown.",
  city: "Cascades off the nearest State question above it — add a State question first.",
  board: "Searchable dropdown of all national + state exam boards (CBSE, ICSE, NIOS, every State board…).",
  dob: "Masked DD/MM/YYYY entry.",
};
const NEXT = "__next__", SUBMIT = "__submit__";

const uid = () => Math.random().toString(36).slice(2, 9);
const opts = (s?: string) => (s || "").split(",").map((o) => o.trim()).filter(Boolean);

// File-upload type presets — the only way to set allowed types (no free text, so an
// admin can never type a label the matcher won't understand). Each stores canonical
// extensions that the upload route matches on.
const FILE_PRESETS: { label: string; ext: string[] }[] = [
  { label: "PDF", ext: [".pdf"] },
  { label: "JPG", ext: [".jpg", ".jpeg"] },
  { label: "PNG", ext: [".png"] },
  { label: "WEBP", ext: [".webp"] },
  { label: "DOC", ext: [".doc"] },
  { label: "DOCX", ext: [".docx"] },
];

// ── draft -> server schema (keys are already stable; just de-dupe defensively) ──
function qToSchema(q: Question, used: Set<string>, catKeys: Set<string>): Record<string, unknown> {
  let qk = q.key || "q_" + uid();
  while (used.has(qk)) qk = qk + "_" + uid();
  used.add(qk);
  const out: Record<string, unknown> = { key: qk, label: q.label.trim() || "Question", type: q.type, required: !!q.required };
  if (HAS_OPTIONS(q.type)) out.options = opts(q.options);
  if (q.type === "file") {
    const acc = opts(q.accept); if (acc.length) out.accept = acc;
    const mb = Number(q.maxSizeMb); if (Number.isFinite(mb) && mb > 0) out.maxSizeMb = mb;
    if (q.multiple) out.multiple = true;
  }
  if ((q.help || "").trim()) out.help = q.help!.trim();
  if (q.hasException) out.exception = { key: qk + "_exc", label: (q.exceptionLabel || "Not applicable").trim() };
  if (q.showIf && q.showIf.q) out.showIf = { q: q.showIf.q, op: q.showIf.op || "eq", value: q.showIf.value ?? "" };
  if (CAN_ROUTE(q.type) && q.routes && q.routes.length) {
    const routes = q.routes.filter((r) => r.value && r.to && r.to !== NEXT && (r.to === SUBMIT || catKeys.has(r.to)));
    if (routes.length) out.routes = routes;
  }
  // Preserve the column-sync mapping (set in the DB) so editing a form in the builder never strips it.
  if (typeof q.column === "string" && q.column) out.column = q.column;
  if (typeof q.cast === "string" && q.cast) out.cast = q.cast;
  return out;
}

function toSchema(d: FormDraft) {
  const catKeys = new Set(d.categories.map((c) => c.key));
  const usedC = new Set<string>();
  const categories = d.categories.map((c) => {
    let ck = c.key; while (usedC.has(ck)) ck = ck + "_" + uid(); usedC.add(ck);
    const usedQ = new Set<string>();
    const questions = c.questions.map((q) => qToSchema(q, usedQ, catKeys));
    const subcategories = (c.subcategories || []).map((s) => ({
      key: s.key, title: s.title.trim() || "Section", questions: s.questions.map((q) => qToSchema(q, usedQ, catKeys)),
    }));
    const out: Record<string, unknown> = { key: ck, title: c.title.trim() || "Category", questions };
    if (subcategories.length) out.subcategories = subcategories;
    if (c.next && c.next !== NEXT && (c.next === SUBMIT || catKeys.has(c.next))) out.next = c.next;
    return out;
  });
  return { categories };
}

function qFromSchema(q: Record<string, unknown>): Question {
  const si = q.showIf as { q?: string; op?: string; value?: string } | undefined;
  return {
    key: typeof q.key === "string" && q.key ? q.key : "q_" + uid(),
    label: String(q.label ?? ""),
    type: (QTYPES.includes(q.type as QType) ? q.type : "text") as QType,
    required: !!q.required,
    options: Array.isArray(q.options) ? (q.options as string[]).join(", ") : "",
    help: typeof q.help === "string" ? q.help : "",
    accept: Array.isArray(q.accept) ? (q.accept as string[]).join(", ") : "",
    maxSizeMb: q.maxSizeMb != null ? String(q.maxSizeMb) : "",
    multiple: !!q.multiple,
    hasException: !!q.exception,
    exceptionLabel: (q.exception as { label?: string } | undefined)?.label ?? "",
    showIf: si && si.q ? { q: si.q, op: (si.op as Cond["op"]) || "eq", value: si.value ?? "" } : undefined,
    routes: Array.isArray(q.routes) ? (q.routes as Route[]).map((r) => ({ value: r.value, to: r.to })) : undefined,
    column: typeof q.column === "string" ? q.column : undefined,
    cast: typeof q.cast === "string" ? q.cast : undefined,
  };
}

function fromSchema(id: string, name: string, schema: { categories?: Array<Record<string, unknown>> }): FormDraft {
  const categories = (schema.categories ?? []).map((c) => ({
    key: typeof c.key === "string" && c.key ? c.key : "c_" + uid(),
    title: String(c.title ?? ""),
    next: typeof c.next === "string" ? c.next : undefined,
    questions: ((c.questions as Array<Record<string, unknown>>) ?? []).map(qFromSchema),
    subcategories: ((c.subcategories as Array<Record<string, unknown>>) ?? []).map((s) => ({
      key: typeof s.key === "string" && s.key ? s.key : "s_" + uid(),
      title: String(s.title ?? ""),
      questions: ((s.questions as Array<Record<string, unknown>>) ?? []).map(qFromSchema),
    })),
    collapsed: true,
  }));
  return { id, name, categories };
}

const newQuestion = (): Question => ({ key: "q_" + uid(), label: "", type: "text", required: false });

const input = "w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 focus:border-[#00cfe5] focus:outline-none";
const mini = "rounded-md border border-white/15 bg-white/5 px-2 py-1.5 text-xs text-white focus:border-[#00cfe5] focus:outline-none";
const btn = "rounded-lg px-4 py-2 text-sm font-semibold";
const chip = "rounded-lg border border-white/15 px-2.5 py-1 text-xs text-white/70 hover:text-white hover:border-white/30";

export function VsatFormBuilder() {
  const [supabase] = useState(() => createClient());
  const [forms, setForms] = useState<FormRow[]>([]);
  const [draft, setDraft] = useState<FormDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const drag = useRef<{ list: string; index: number } | null>(null);

  const loadList = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.rpc("vsat_forms_admin_list");
    if (data?.ok) setForms((data.forms as FormRow[]) ?? []);
    else setMsg(data?.code === "FORBIDDEN" ? "Admins only." : "Couldn't load forms.");
    setLoading(false);
  }, [supabase]);
  useEffect(() => { void loadList(); }, [loadList]);

  async function editForm(id: string) {
    setBusy(true); setMsg("");
    const { data } = await supabase.rpc("vsat_form_get", { p_id: id });
    setBusy(false);
    if (!data?.ok) return setMsg(data?.code || "Couldn't open form.");
    setDraft(fromSchema(data.form.id, data.form.name, data.form.schema));
  }

  async function save() {
    if (!draft) return;
    if (!draft.name.trim()) return setMsg("Give the form a name.");
    setBusy(true); setMsg("");
    const p: Record<string, unknown> = { name: draft.name.trim(), schema: toSchema(draft) };
    if (draft.id) p.id = draft.id;
    const { data } = await supabase.rpc("vsat_form_upsert", { p });
    setBusy(false);
    if (!data?.ok) return setMsg(data?.code === "INVALID_SCHEMA" ? "Every category needs a title and every question a label + type." : data?.code || "Save failed.");
    setMsg("Saved ✓");
    setDraft((d) => (d ? { ...d, id: data.id as string } : d));
    void loadList();
  }

  async function setStatus(id: string, status: "active" | "draft" | "archived", adminOnly?: boolean) {
    setBusy(true); setMsg("");
    const p: Record<string, unknown> = { id, status };
    if (adminOnly !== undefined) p.admin_only = adminOnly;
    const { data } = await supabase.rpc("vsat_form_set_status", { p });
    setBusy(false);
    if (!data?.ok) return setMsg(data?.code || "Couldn't change status.");
    setMsg(status !== "active" ? `Form set to ${status}.`
      : data.admin_only ? "Live for Vedam staff only (vedam.org) — safe to test. Public can't see it."
                        : "Live for all paid applicants.");
    void loadList();
  }

  // ── draft editing ──
  const up = (fn: (d: FormDraft) => FormDraft) => setDraft((d) => (d ? fn(structuredClone(d)) : d));
  const addCategory = () => up((d) => { d.categories.push({ key: "c_" + uid(), title: "", questions: [], subcategories: [], collapsed: false }); return d; });
  const dupCategory = (ci: number) => up((d) => { const c = structuredClone(d.categories[ci]); c.key = "c_" + uid(); c.title = c.title ? c.title + " (copy)" : ""; d.categories.splice(ci + 1, 0, c); return d; });
  const addQuestion = (ci: number, si: number | null) => up((d) => { (si == null ? d.categories[ci].questions : d.categories[ci].subcategories[si].questions).push(newQuestion()); return d; });
  const addSub = (ci: number) => up((d) => { d.categories[ci].subcategories.push({ key: "s_" + uid(), title: "", questions: [] }); return d; });

  const qListOf = (d: FormDraft, ci: number, si: number | null) => (si == null ? d.categories[ci].questions : d.categories[ci].subcategories[si].questions);
  const editQ = (ci: number, si: number | null, qi: number, patch: Partial<Question>) =>
    up((d) => { const list = qListOf(d, ci, si); list[qi] = { ...list[qi], ...patch }; return d; });
  const dupQ = (ci: number, si: number | null, qi: number) =>
    up((d) => { const list = qListOf(d, ci, si); const c = structuredClone(list[qi]); c.key = "q_" + uid(); list.splice(qi + 1, 0, c); return d; });
  const delQ = (ci: number, si: number | null, qi: number) =>
    up((d) => { qListOf(d, ci, si).splice(qi, 1); return d; });
  const setRoute = (ci: number, si: number | null, qi: number, value: string, to: string) =>
    up((d) => {
      const q = qListOf(d, ci, si)[qi];
      const routes = (q.routes ?? []).filter((r) => r.value !== value);
      if (to && to !== NEXT) routes.push({ value, to });
      q.routes = routes;
      return d;
    });

  function move<T>(arr: T[], from: number, to: number) { const [x] = arr.splice(from, 1); arr.splice(to, 0, x); }
  const onDrop = (list: string, to: number) => up((d) => {
    const from = drag.current && drag.current.list === list ? drag.current.index : -1;
    drag.current = null;
    if (from < 0 || from === to) return d;
    if (list === "cat") move(d.categories, from, to);
    else {
      const m = /^cat-(\d+)(?:-sub-(\d+))?$/.exec(list);
      if (m) { const ci = +m[1]; const si = m[2] != null ? +m[2] : null; move(qListOf(d, ci, si), from, to); }
    }
    return d;
  });

  if (loading) return <div className="p-10 text-white/50">Loading…</div>;

  // ── LIST VIEW ──
  if (!draft) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-10">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-display text-2xl font-bold">VSAT Form builder</h1>
            <p className="mt-1 text-sm text-white/50">Build the application form. One form is live at a time — whoever pays the VSAT fee fills it.</p>
          </div>
          <button onClick={() => setDraft({ name: "", categories: [] })} className={`${btn} bg-gradient-to-r from-[#00cfe5] to-[#c200db] text-white`}>+ New form</button>
        </div>
        {msg && <p className="mt-4 text-sm text-[#00cfe5]">{msg}</p>}
        <div className="mt-6 space-y-3">
          {forms.length === 0 && <p className="text-sm text-white/40">No forms yet.</p>}
          {forms.map((f) => (
            <div key={f.id} className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 p-4">
              <div>
                <p className="font-semibold">{f.name}
                  {f.status === "active" && (f.admin_only
                    ? <span className="ml-2 rounded-full bg-amber-400/15 px-2 py-0.5 text-xs font-semibold text-amber-300">LIVE · STAFF ONLY</span>
                    : <span className="ml-2 rounded-full bg-[#16a34a]/20 px-2 py-0.5 text-xs text-[#4ade80]">LIVE</span>)}
                  {f.status === "archived" && <span className="ml-2 text-xs text-white/30">archived</span>}</p>
                <p className="text-xs text-white/40">{f.categories} categor{f.categories === 1 ? "y" : "ies"} · v{f.version}
                  {f.status === "active" && f.admin_only && <span className="text-amber-300/70"> · only vedam.org can see & fill it</span>}</p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => editForm(f.id)} disabled={busy} className={`${btn} border border-white/15 text-white`}>Edit</button>
                {f.status !== "active" ? (
                  <>
                    <button onClick={() => setStatus(f.id, "active", true)} disabled={busy} className={`${btn} bg-amber-500/90 text-black`} title="Enable for Vedam staff only — test it before going public">Enable (staff only)</button>
                    <button onClick={() => setStatus(f.id, "active", false)} disabled={busy} className={`${btn} bg-[#16a34a] text-white`}>Enable (public)</button>
                  </>
                ) : (
                  <>
                    {f.admin_only
                      ? <button onClick={() => setStatus(f.id, "active", false)} disabled={busy} className={`${btn} bg-[#16a34a] text-white`}>Make public</button>
                      : <button onClick={() => setStatus(f.id, "active", true)} disabled={busy} className={`${btn} bg-amber-500/90 text-black`}>Switch to staff-only</button>}
                    <button onClick={() => setStatus(f.id, "draft")} disabled={busy} className={`${btn} border border-white/15 text-white`}>Disable</button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // references for the logic selectors
  const catOpts = draft.categories.map((c) => ({ key: c.key, title: c.title || "(untitled section)" }));
  const allQs = draft.categories.flatMap((c) => [
    ...c.questions.map((q) => ({ key: q.key, label: q.label || "(untitled)", cat: c.title || "section" })),
    ...c.subcategories.flatMap((s) => s.questions.map((q) => ({ key: q.key, label: q.label || "(untitled)", cat: c.title || "section" }))),
  ]);
  const routeTargets = (ci: number) => (
    <>
      <option value={NEXT} className="bg-[#160a30]">Continue to next section</option>
      {catOpts.map((c, i) => i !== ci && <option key={c.key} value={c.key} className="bg-[#160a30]">Go to: {c.title}</option>)}
      <option value={SUBMIT} className="bg-[#160a30]">Submit the form</option>
    </>
  );

  // ── a single question editor ──
  const questionCard = (q: Question, ci: number, si: number | null, qi: number, list: string) => {
    const refs = allQs.filter((x) => x.key !== q.key);
    const refQ = q.showIf ? allQs.find((x) => x.key === q.showIf!.q) : undefined;
    return (
      <div key={q.key} draggable
        onDragStart={() => { drag.current = { list, index: qi }; }}
        onDragOver={(e) => e.preventDefault()} onDrop={() => onDrop(list, qi)}
        className="rounded-lg border border-white/10 bg-black/20 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="cursor-grab select-none px-1 text-white/30" title="Drag to reorder">⠿</span>
          <input value={q.label} onChange={(e) => editQ(ci, si, qi, { label: e.target.value })} placeholder="Question label" className={`${input} flex-1 min-w-[160px]`} />
          <select value={q.type} onChange={(e) => editQ(ci, si, qi, { type: e.target.value as QType })} className={`${input} w-44`}>
            {QTYPES.map((t) => <option key={t} value={t} className="bg-[#160a30]">{TYPE_LABEL[t]}</option>)}
          </select>
          <label className="flex items-center gap-1 text-xs text-white/60"><input type="checkbox" checked={q.required} onChange={(e) => editQ(ci, si, qi, { required: e.target.checked })} /> required</label>
          <button onClick={() => dupQ(ci, si, qi)} className="rounded px-2 py-1 text-xs text-white/40 hover:text-white" title="Duplicate">⧉</button>
          <button onClick={() => delQ(ci, si, qi)} className="rounded px-2 py-1 text-xs text-white/40 hover:text-[#ff9db0]" title="Remove">✕</button>
        </div>

        {HAS_OPTIONS(q.type) && (
          <input value={q.options ?? ""} onChange={(e) => editQ(ci, si, qi, { options: e.target.value })} placeholder="Options, comma-separated (e.g. CSE, AI/ML, ECE)" className={`${input} mt-2`} />
        )}

        {q.type === "file" && (
          <div className="mt-2 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-white/50">Allowed file types:</span>
              {FILE_PRESETS.map((p) => {
                const on = p.ext.some((e) => opts(q.accept).includes(e));
                return (
                  <label key={p.label} className={`cursor-pointer select-none rounded-md border px-2.5 py-1 text-xs ${on ? "border-[#00cfe5] bg-[#00cfe5]/15 text-white" : "border-white/15 text-white/60 hover:border-white/30"}`}>
                    <input type="checkbox" className="sr-only" checked={on}
                      onChange={() => {
                        const s = new Set(opts(q.accept));
                        if (on) p.ext.forEach((e) => s.delete(e)); else p.ext.forEach((e) => s.add(e));
                        editQ(ci, si, qi, { accept: [...s].join(", ") });
                      }} />
                    {p.label}
                  </label>
                );
              })}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <input type="number" min={1} value={q.maxSizeMb ?? ""} onChange={(e) => editQ(ci, si, qi, { maxSizeMb: e.target.value })} placeholder="Max MB" className={`${input} w-28`} />
              <label className="flex items-center gap-2 text-xs text-white/60"><input type="checkbox" checked={!!q.multiple} onChange={(e) => editQ(ci, si, qi, { multiple: e.target.checked })} /> allow multiple files</label>
            </div>
            {opts(q.accept).length === 0 && <p className="text-xs text-amber-300/70">Pick at least one type — otherwise every file type is allowed.</p>}
          </div>
        )}

        {DATASET_HINTS[q.type] && <p className="mt-2 text-xs text-white/40">{DATASET_HINTS[q.type]}</p>}

        <input value={q.help ?? ""} onChange={(e) => editQ(ci, si, qi, { help: e.target.value })} placeholder="Guidance text (optional — shown under the question)" className={`${input} mt-2 text-xs`} />

        {/* conditional: branch by answer (single-choice only) */}
        {CAN_ROUTE(q.type) && opts(q.options).length > 0 && (
          <div className="mt-2 rounded-md border border-[#00cfe5]/25 bg-[#00cfe5]/[0.06] p-2">
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#6fe3ef]">Branch by answer</p>
            <div className="space-y-1.5">
              {opts(q.options).map((o) => (
                <div key={o} className="flex items-center gap-2">
                  <span className="min-w-[90px] shrink-0 truncate text-xs text-white/70">If “{o}” →</span>
                  <select value={(q.routes ?? []).find((r) => r.value === o)?.to ?? NEXT} onChange={(e) => setRoute(ci, si, qi, o, e.target.value)} className={`${mini} flex-1`}>
                    {routeTargets(ci)}
                  </select>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* conditional: show only if */}
        <label className="mt-2 flex items-center gap-2 text-xs text-white/50">
          <input type="checkbox" checked={!!q.showIf}
            onChange={(e) => editQ(ci, si, qi, { showIf: e.target.checked ? { q: refs[0]?.key ?? "", op: "eq", value: "" } : undefined })} />
          show this question only if…
        </label>
        {q.showIf && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <select value={q.showIf.q} onChange={(e) => editQ(ci, si, qi, { showIf: { ...q.showIf!, q: e.target.value } })} className={`${mini} max-w-[180px]`}>
              {refs.length === 0 && <option value="">(add another question first)</option>}
              {refs.map((x) => <option key={x.key} value={x.key} className="bg-[#160a30]">{x.label}</option>)}
            </select>
            <select value={q.showIf.op} onChange={(e) => editQ(ci, si, qi, { showIf: { ...q.showIf!, op: e.target.value as Cond["op"] } })} className={mini}>
              <option value="eq" className="bg-[#160a30]">is</option>
              <option value="neq" className="bg-[#160a30]">is not</option>
              <option value="includes" className="bg-[#160a30]">includes</option>
            </select>
            {(() => {
              const refOpts = refQ ? opts(draft.categories.flatMap((c) => [...c.questions, ...c.subcategories.flatMap((s) => s.questions)]).find((qq) => qq.key === refQ.key)?.options) : [];
              return refOpts.length > 0 ? (
                <select value={q.showIf.value} onChange={(e) => editQ(ci, si, qi, { showIf: { ...q.showIf!, value: e.target.value } })} className={mini}>
                  <option value="" className="bg-[#160a30]">(pick a value)</option>
                  {refOpts.map((o) => <option key={o} value={o} className="bg-[#160a30]">{o}</option>)}
                </select>
              ) : (
                <input value={q.showIf.value} onChange={(e) => editQ(ci, si, qi, { showIf: { ...q.showIf!, value: e.target.value } })} placeholder="value" className={`${mini} w-28`} />
              );
            })()}
          </div>
        )}

        <label className="mt-2 flex items-center gap-2 text-xs text-white/50">
          <input type="checkbox" checked={!!q.hasException} onChange={(e) => editQ(ci, si, qi, { hasException: e.target.checked })} />
          allow a skip-exception
        </label>
        {q.hasException && (
          <input value={q.exceptionLabel ?? ""} onChange={(e) => editQ(ci, si, qi, { exceptionLabel: e.target.value })} placeholder='Exception label (e.g. "12th results not out yet")' className={`${input} mt-2`} />
        )}
      </div>
    );
  };

  // ── EDIT VIEW ──
  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <div className="flex items-center justify-between">
        <button onClick={() => { setDraft(null); setMsg(""); }} className="text-sm text-white/50 hover:text-white">← All forms</button>
        <button onClick={save} disabled={busy} className={`${btn} bg-gradient-to-r from-[#00cfe5] to-[#c200db] text-white`}>{busy ? "Saving…" : "Save"}</button>
      </div>
      {msg && <p className="mt-3 text-sm text-[#00cfe5]">{msg}</p>}

      <input value={draft.name} onChange={(e) => up((d) => { d.name = e.target.value; return d; })} placeholder="Form name (e.g. VSAT 2027 application)" className={`${input} mt-5 text-lg`} />

      <div className="mt-2 flex items-center justify-end gap-3 text-xs text-white/40">
        <button onClick={() => up((d) => { d.categories.forEach((c) => (c.collapsed = true)); return d; })} className="hover:text-white">Collapse all</button>
        <button onClick={() => up((d) => { d.categories.forEach((c) => (c.collapsed = false)); return d; })} className="hover:text-white">Expand all</button>
      </div>

      <div className="mt-3 space-y-4">
        {draft.categories.map((c, ci) => {
          const qCount = c.questions.length + c.subcategories.reduce((n, s) => n + s.questions.length, 0);
          return (
            <div key={c.key} draggable
              onDragStart={(e) => { if (e.target === e.currentTarget || (e.target as HTMLElement).dataset.draghandle) { drag.current = { list: "cat", index: ci }; } }}
              onDragOver={(e) => e.preventDefault()} onDrop={() => onDrop("cat", ci)}
              className="rounded-xl border border-white/10 bg-white/5">
              <div className="flex items-center gap-2 p-4">
                <span data-draghandle className="cursor-grab select-none px-1 text-white/30" title="Drag to reorder">⠿</span>
                <button onClick={() => up((d) => { d.categories[ci].collapsed = !d.categories[ci].collapsed; return d; })} className="shrink-0 text-white/50 hover:text-white" title={c.collapsed ? "Expand" : "Collapse"}>{c.collapsed ? "▸" : "▾"}</button>
                <input value={c.title} onChange={(e) => up((d) => { d.categories[ci].title = e.target.value; return d; })} placeholder={`Category ${ci + 1} title (e.g. Basic details)`} className={`${input} font-semibold`} />
                <span className="shrink-0 text-xs text-white/30">{qCount} Q{c.subcategories.length ? ` · ${c.subcategories.length} section${c.subcategories.length > 1 ? "s" : ""}` : ""}</span>
                <button onClick={() => dupCategory(ci)} className={`${chip} shrink-0`} title="Duplicate category">⧉ Copy</button>
                <button onClick={() => up((d) => { d.categories.splice(ci, 1); return d; })} className={`${chip} shrink-0 hover:text-[#ff9db0]`}>Remove</button>
              </div>

              {!c.collapsed && (
                <div className="space-y-3 px-4 pb-4">
                  {c.questions.map((q, qi) => questionCard(q, ci, null, qi, `cat-${ci}`))}
                  <button onClick={() => addQuestion(ci, null)} className="rounded-lg border border-dashed border-white/20 px-3 py-2 text-xs text-white/60 hover:text-white">+ Add question</button>

                  {c.subcategories.map((s, si) => (
                    <div key={s.key} className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                      <div className="flex items-center gap-2">
                        <span className="text-white/30">↳</span>
                        <input value={s.title} onChange={(e) => up((d) => { d.categories[ci].subcategories[si].title = e.target.value; return d; })} placeholder={`Sub-category ${si + 1} title (e.g. Class 12 marks)`} className={`${input} font-medium`} />
                        <button onClick={() => up((d) => { d.categories[ci].subcategories.splice(si, 1); return d; })} className={`${chip} shrink-0 hover:text-[#ff9db0]`}>Remove</button>
                      </div>
                      <div className="mt-3 space-y-3">
                        {s.questions.map((q, qi) => questionCard(q, ci, si, qi, `cat-${ci}-sub-${si}`))}
                        <button onClick={() => addQuestion(ci, si)} className="rounded-lg border border-dashed border-white/20 px-3 py-2 text-xs text-white/60 hover:text-white">+ Add question to this section</button>
                      </div>
                    </div>
                  ))}
                  <button onClick={() => addSub(ci)} className="rounded-lg border border-dashed border-white/15 px-3 py-2 text-xs text-white/40 hover:text-white">+ Add sub-category</button>

                  {/* after this section → (default routing; a question's own branch overrides this) */}
                  <div className="flex items-center gap-2 border-t border-white/10 pt-3">
                    <span className="text-xs text-white/50">After this section →</span>
                    <select value={c.next ?? NEXT} onChange={(e) => up((d) => { d.categories[ci].next = e.target.value; return d; })} className={`${mini} max-w-[220px]`}>
                      {routeTargets(ci)}
                    </select>
                  </div>
                </div>
              )}
            </div>
          );
        })}
        <button onClick={addCategory} className="w-full rounded-xl border border-dashed border-white/20 px-4 py-3 text-sm text-white/60 hover:text-white">+ Add category</button>
      </div>
    </div>
  );
}

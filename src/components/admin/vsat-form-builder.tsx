"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { cx, vx } from "@/components/admin/ui/vx";

type QType = "text" | "textarea" | "number" | "date" | "dropdown" | "checkbox" | "radio" | "file" | "school" | "state" | "city" | "board" | "dob" | "email" | "phone";
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

const QTYPES: QType[] = ["text", "textarea", "number", "date", "dob", "email", "phone", "dropdown", "checkbox", "radio", "file", "school", "state", "city", "board"];
const TYPE_LABEL: Record<QType, string> = {
  text: "Short text", textarea: "Paragraph", number: "Number", date: "Date", dob: "Date of birth (DD/MM/YYYY)",
  email: "Email address", phone: "Phone number",
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
  email: "Validated as a real email address (on the form and again on the server).",
  phone: "Digits only; validated as a 10–15 digit phone number.",
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

const input = vx.input;
const mini = "h-8 rounded-[9px] border border-vx-line2 bg-black/20 px-2 font-sans text-[13px] text-vx-ink focus:border-vx-violet focus:outline-none focus:ring-2 focus:ring-vx-violet/30";
const chip = cx(vx.btn, vx.ghost, vx.sm);
const add = cx(vx.dashed, "px-3 py-2 text-[13px]");
const opt = "bg-vx-raised"; // <option> background in the native dropdown
const DocIcon = () => (
  <svg viewBox="0 0 24 24" className="h-[22px] w-[22px]" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6M8 13h8M8 17h5" />
  </svg>
);
/** Status of a form, as a coloured chip + the icon-tile colours that go with it. */
function formState(f: FormRow) {
  if (f.status === "active" && f.admin_only) return { label: "Live for staff", chip: "border-vx-orange/30 bg-vx-orange/10 text-vx-orange-t", dot: "bg-vx-orange", tile: "border-vx-orange/30 bg-vx-orange/10 text-vx-orange-t" };
  if (f.status === "active") return { label: "Live for public", chip: "border-vx-green/30 bg-vx-green/10 text-vx-green", dot: "bg-vx-green shadow-[0_0_0_3px_rgba(43,217,159,0.18)]", tile: "border-vx-green/30 bg-vx-green/10 text-vx-green" };
  if (f.status === "archived") return { label: "Archived", chip: "border-vx-line bg-white/[0.05] text-vx-faint", dot: "bg-vx-faint", tile: "border-vx-line bg-white/[0.04] text-vx-faint" };
  return { label: "Not live", chip: "border-vx-line bg-white/[0.05] text-vx-mut", dot: "bg-vx-faint", tile: "border-vx-violet/30 bg-vx-violet/[0.14] text-vx-violet-t" };
}

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

  if (loading) return <div className={cx(vx.page, "text-vx-mut")}>Loading…</div>;

  // ── LIST VIEW ──
  if (!draft) {
    return (
      <div className={vx.page}>
        <div className={vx.head}>
          <div>
            <h1 className={vx.h1}>Form builder</h1>
            <p className={vx.sub}>Build the application form. One form is live at a time — whoever pays the VSAT fee fills it.</p>
          </div>
          <button onClick={() => setDraft({ name: "", categories: [] })} className={cx(vx.btn, vx.cta, "h-11 px-5")}>
            <span aria-hidden="true" className="text-lg leading-none">+</span>New form
          </button>
        </div>
        {msg && <p role="status" className={cx(vx.info, "mb-4")}>{msg}</p>}
        <div className="space-y-3">
          {forms.length === 0 && <div className={cx(vx.card, vx.pad, "text-center text-sm text-vx-mut")}>No forms yet. Create one with “New form”.</div>}
          {forms.map((f) => {
            const st = formState(f);
            return (
              <div key={f.id} className={cx(vx.card, vx.hover, "flex flex-wrap items-center gap-x-[18px] gap-y-4 p-5 sm:px-6")}>
                <div className={cx("grid h-12 w-12 flex-none place-items-center rounded-[14px] border", st.tile)}><DocIcon /></div>
                <div className="min-w-0 flex-1">
                  <h2 className={cx(vx.h2, "truncate")}>{f.name}</h2>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <span className={cx("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[12.5px] font-medium", st.chip)}><span className={cx(vx.dot, st.dot)} />{st.label}</span>
                    <span className={vx.chip}>{f.categories} categor{f.categories === 1 ? "y" : "ies"}</span>
                    <span className={vx.chip}>Version {f.version}</span>
                  </div>
                  {f.status === "active" && f.admin_only && <p className="mt-2 text-[13px] text-vx-orange-t/80">Only vedam.org accounts can see and fill it.</p>}
                </div>
                <div className="flex w-full flex-wrap gap-2 sm:w-auto">
                  <button onClick={() => editForm(f.id)} disabled={busy} className={cx(vx.btn, vx.ghost)}>Edit</button>
                  {f.status !== "active" ? (
                    <>
                      <button onClick={() => setStatus(f.id, "active", true)} disabled={busy} className={cx(vx.btn, vx.secondary)} title="Turn it on for Vedam staff only, to test it before going public">
                        <span className={cx(vx.dot, "bg-vx-orange")} aria-hidden="true" />Enable for staff
                      </button>
                      <button onClick={() => setStatus(f.id, "active", false)} disabled={busy} className={cx(vx.btn, vx.primary)}>Enable for public</button>
                    </>
                  ) : (
                    <>
                      {f.admin_only
                        ? <button onClick={() => setStatus(f.id, "active", false)} disabled={busy} className={cx(vx.btn, vx.primary)}>Make public</button>
                        : <button onClick={() => setStatus(f.id, "active", true)} disabled={busy} className={cx(vx.btn, vx.secondary)}><span className={cx(vx.dot, "bg-vx-orange")} aria-hidden="true" />Switch to staff only</button>}
                      <button onClick={() => setStatus(f.id, "draft")} disabled={busy} className={cx(vx.btn, vx.ghost)}>Turn off</button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
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
      <option value={NEXT} className={opt}>Continue to next section</option>
      {catOpts.map((c, i) => i !== ci && <option key={c.key} value={c.key} className={opt}>Go to: {c.title}</option>)}
      <option value={SUBMIT} className={opt}>Submit the form</option>
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
        className={cx(vx.well, "p-4")}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="cursor-grab select-none px-1 text-vx-faint" title="Drag to reorder">⠿</span>
          <input value={q.label} onChange={(e) => editQ(ci, si, qi, { label: e.target.value })} placeholder="Question label" className={cx(vx.field, "min-w-[160px] flex-1")} />
          <select value={q.type} onChange={(e) => editQ(ci, si, qi, { type: e.target.value as QType })} className={cx(vx.field, "w-44")}>
            {QTYPES.map((t) => <option key={t} value={t} className={opt}>{TYPE_LABEL[t]}</option>)}
          </select>
          <label className="flex items-center gap-1.5 text-[13px] text-vx-mut"><input type="checkbox" className={vx.check} checked={q.required} onChange={(e) => editQ(ci, si, qi, { required: e.target.checked })} /> required</label>
          <button onClick={() => dupQ(ci, si, qi)} className="rounded-md px-2 py-1 text-sm text-vx-faint hover:bg-white/[0.05] hover:text-vx-ink" title="Duplicate" aria-label="Duplicate question">⧉</button>
          <button onClick={() => delQ(ci, si, qi)} className="rounded-md px-2 py-1 text-sm text-vx-faint hover:bg-white/[0.05] hover:text-vx-red" title="Remove" aria-label="Remove question">✕</button>
        </div>

        {HAS_OPTIONS(q.type) && (
          <input value={q.options ?? ""} onChange={(e) => editQ(ci, si, qi, { options: e.target.value })} placeholder="Options, comma-separated (e.g. CSE, AI/ML, ECE)" className={cx(input, "mt-2")} />
        )}

        {q.type === "file" && (
          <div className="mt-2 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[13px] text-vx-mut">Allowed file types:</span>
              {FILE_PRESETS.map((p) => {
                const on = p.ext.some((e) => opts(q.accept).includes(e));
                return (
                  <label key={p.label} className={cx("cursor-pointer select-none rounded-full border px-3 py-1 text-[12.5px] transition-colors", on ? "border-vx-violet bg-vx-violet/15 text-vx-ink" : "border-vx-line2 text-vx-mut hover:border-vx-violet/50")}>
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
              <input type="number" min={1} value={q.maxSizeMb ?? ""} onChange={(e) => editQ(ci, si, qi, { maxSizeMb: e.target.value })} placeholder="Max MB" className={cx(vx.field, "w-28")} />
              <label className="flex items-center gap-2 text-[13px] text-vx-mut"><input type="checkbox" className={vx.check} checked={!!q.multiple} onChange={(e) => editQ(ci, si, qi, { multiple: e.target.checked })} /> allow multiple files</label>
            </div>
            {opts(q.accept).length === 0 && <p className="text-[13px] text-vx-orange-t/80">Pick at least one type — otherwise every file type is allowed.</p>}
          </div>
        )}

        {DATASET_HINTS[q.type] && <p className="mt-2 text-[13px] text-vx-faint">{DATASET_HINTS[q.type]}</p>}

        <input value={q.help ?? ""} onChange={(e) => editQ(ci, si, qi, { help: e.target.value })} placeholder="Guidance text (optional — shown under the question)" className={cx(input, "mt-2 text-[13px]")} />

        {/* conditional: branch by answer (single-choice only) */}
        {CAN_ROUTE(q.type) && opts(q.options).length > 0 && (
          <div className="mt-3 rounded-xl border border-vx-violet/25 bg-vx-violet/[0.06] p-3">
            <p className="mb-2 text-[13px] font-medium text-vx-violet-t">Branch by answer</p>
            <div className="space-y-1.5">
              {opts(q.options).map((o) => (
                <div key={o} className="flex items-center gap-2">
                  <span className="min-w-[90px] shrink-0 truncate text-[13px] text-vx-mut">If “{o}” →</span>
                  <select value={(q.routes ?? []).find((r) => r.value === o)?.to ?? NEXT} onChange={(e) => setRoute(ci, si, qi, o, e.target.value)} className={cx(mini, "flex-1")}>
                    {routeTargets(ci)}
                  </select>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* conditional: show only if */}
        <label className="mt-3 flex items-center gap-2 text-[13px] text-vx-mut">
          <input type="checkbox" className={vx.check} checked={!!q.showIf}
            onChange={(e) => editQ(ci, si, qi, { showIf: e.target.checked ? { q: refs[0]?.key ?? "", op: "eq", value: "" } : undefined })} />
          show this question only if…
        </label>
        {q.showIf && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <select value={q.showIf.q} onChange={(e) => editQ(ci, si, qi, { showIf: { ...q.showIf!, q: e.target.value } })} className={cx(mini, "max-w-[180px]")}>
              {refs.length === 0 && <option value="">(add another question first)</option>}
              {refs.map((x) => <option key={x.key} value={x.key} className={opt}>{x.label}</option>)}
            </select>
            <select value={q.showIf.op} onChange={(e) => editQ(ci, si, qi, { showIf: { ...q.showIf!, op: e.target.value as Cond["op"] } })} className={mini}>
              <option value="eq" className={opt}>is</option>
              <option value="neq" className={opt}>is not</option>
              <option value="includes" className={opt}>includes</option>
            </select>
            {(() => {
              const refOpts = refQ ? opts(draft.categories.flatMap((c) => [...c.questions, ...c.subcategories.flatMap((s) => s.questions)]).find((qq) => qq.key === refQ.key)?.options) : [];
              return refOpts.length > 0 ? (
                <select value={q.showIf.value} onChange={(e) => editQ(ci, si, qi, { showIf: { ...q.showIf!, value: e.target.value } })} className={mini}>
                  <option value="" className={opt}>(pick a value)</option>
                  {refOpts.map((o) => <option key={o} value={o} className={opt}>{o}</option>)}
                </select>
              ) : (
                <input value={q.showIf.value} onChange={(e) => editQ(ci, si, qi, { showIf: { ...q.showIf!, value: e.target.value } })} placeholder="value" className={cx(mini, "w-28")} />
              );
            })()}
          </div>
        )}

        <label className="mt-2 flex items-center gap-2 text-[13px] text-vx-mut">
          <input type="checkbox" className={vx.check} checked={!!q.hasException} onChange={(e) => editQ(ci, si, qi, { hasException: e.target.checked })} />
          allow a skip-exception
        </label>
        {q.hasException && (
          <input value={q.exceptionLabel ?? ""} onChange={(e) => editQ(ci, si, qi, { exceptionLabel: e.target.value })} placeholder='Exception label (e.g. "12th results not out yet")' className={cx(input, "mt-2")} />
        )}
      </div>
    );
  };

  // ── EDIT VIEW ──
  return (
    <div className={vx.page}>
      <div className="flex items-center justify-between gap-3">
        <button onClick={() => { setDraft(null); setMsg(""); }} className={cx(vx.btn, vx.ghost, vx.sm)}>← All forms</button>
        <button onClick={save} disabled={busy} className={cx(vx.btn, vx.cta, "px-6")}>{busy ? "Saving…" : "Save"}</button>
      </div>
      {msg && <p role="status" className={cx(vx.info, "mt-4")}>{msg}</p>}

      <input value={draft.name} onChange={(e) => up((d) => { d.name = e.target.value; return d; })} placeholder="Form name (e.g. VSAT 2027 application)" aria-label="Form name"
        className={cx(input, "mt-6 h-12 text-lg font-semibold")} />

      <div className="mt-3 flex items-center justify-end gap-1 text-[13px]">
        <button onClick={() => up((d) => { d.categories.forEach((c) => (c.collapsed = true)); return d; })} className="rounded-md px-2 py-1 text-vx-mut hover:bg-white/[0.04] hover:text-vx-ink">Collapse all</button>
        <button onClick={() => up((d) => { d.categories.forEach((c) => (c.collapsed = false)); return d; })} className="rounded-md px-2 py-1 text-vx-mut hover:bg-white/[0.04] hover:text-vx-ink">Expand all</button>
      </div>

      <div className="mt-3 space-y-4">
        {draft.categories.map((c, ci) => {
          const qCount = c.questions.length + c.subcategories.reduce((n, s) => n + s.questions.length, 0);
          return (
            <div key={c.key} draggable
              onDragStart={(e) => { if (e.target === e.currentTarget || (e.target as HTMLElement).dataset.draghandle) { drag.current = { list: "cat", index: ci }; } }}
              onDragOver={(e) => e.preventDefault()} onDrop={() => onDrop("cat", ci)}
              className={vx.card}>
              <div className="flex items-center gap-2 p-4 sm:px-5">
                <span data-draghandle className="cursor-grab select-none px-1 text-vx-faint" title="Drag to reorder">⠿</span>
                <button onClick={() => up((d) => { d.categories[ci].collapsed = !d.categories[ci].collapsed; return d; })} className="shrink-0 rounded-md px-1 text-vx-mut hover:text-vx-ink" title={c.collapsed ? "Expand" : "Collapse"} aria-expanded={!c.collapsed}>{c.collapsed ? "▸" : "▾"}</button>
                <input value={c.title} onChange={(e) => up((d) => { d.categories[ci].title = e.target.value; return d; })} placeholder={`Category ${ci + 1} title (e.g. Basic details)`} className={cx(input, "font-semibold")} />
                <span className="shrink-0 text-[12.5px] text-vx-faint">{qCount} Q{c.subcategories.length ? ` · ${c.subcategories.length} section${c.subcategories.length > 1 ? "s" : ""}` : ""}</span>
                <button onClick={() => dupCategory(ci)} className={cx(chip, "shrink-0")} title="Duplicate category">⧉ Copy</button>
                <button onClick={() => up((d) => { d.categories.splice(ci, 1); return d; })} className={cx(chip, "shrink-0 hover:text-vx-red")}>Remove</button>
              </div>

              {!c.collapsed && (
                <div className="space-y-3 px-4 pb-4 sm:px-5 sm:pb-5">
                  {c.questions.map((q, qi) => questionCard(q, ci, null, qi, `cat-${ci}`))}
                  <button onClick={() => addQuestion(ci, null)} className={add}>+ Add question</button>

                  {c.subcategories.map((s, si) => (
                    <div key={s.key} className="rounded-xl border border-vx-line bg-white/[0.025] p-3 sm:p-4">
                      <div className="flex items-center gap-2">
                        <span className="text-vx-faint">↳</span>
                        <input value={s.title} onChange={(e) => up((d) => { d.categories[ci].subcategories[si].title = e.target.value; return d; })} placeholder={`Sub-category ${si + 1} title (e.g. Class 12 marks)`} className={cx(input, "font-medium")} />
                        <button onClick={() => up((d) => { d.categories[ci].subcategories.splice(si, 1); return d; })} className={cx(chip, "shrink-0 hover:text-vx-red")}>Remove</button>
                      </div>
                      <div className="mt-3 space-y-3">
                        {s.questions.map((q, qi) => questionCard(q, ci, si, qi, `cat-${ci}-sub-${si}`))}
                        <button onClick={() => addQuestion(ci, si)} className={add}>+ Add question to this section</button>
                      </div>
                    </div>
                  ))}
                  <button onClick={() => addSub(ci)} className={add}>+ Add sub-category</button>

                  {/* after this section → (default routing; a question's own branch overrides this) */}
                  <div className="flex items-center gap-2 border-t border-vx-line pt-3">
                    <span className="text-[13px] text-vx-mut">After this section →</span>
                    <select value={c.next ?? NEXT} onChange={(e) => up((d) => { d.categories[ci].next = e.target.value; return d; })} className={cx(mini, "max-w-[220px]")}>
                      {routeTargets(ci)}
                    </select>
                  </div>
                </div>
              )}
            </div>
          );
        })}
        <button onClick={addCategory} className={cx(vx.dashed, "w-full py-3.5")}>+ Add category</button>
      </div>
    </div>
  );
}

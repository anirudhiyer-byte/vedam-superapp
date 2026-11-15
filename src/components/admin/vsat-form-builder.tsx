"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type QType = "text" | "textarea" | "number" | "date" | "dropdown" | "checkbox" | "radio" | "file" | "school" | "state" | "city";
type Question = {
  label: string; type: QType; required: boolean;
  options?: string;     // dropdown / checkbox / radio — comma separated
  help?: string;        // guidance text shown under the label (any type)
  accept?: string;      // file — comma separated types/extensions (e.g. "application/pdf, .jpg")
  maxSizeMb?: string;   // file — max size per file in MB
  multiple?: boolean;   // file — allow more than one
  hasException?: boolean; exceptionLabel?: string;
};
type SubCategory = { title: string; questions: Question[] };
type Category = { title: string; questions: Question[]; subcategories: SubCategory[]; collapsed?: boolean };
type FormDraft = { id?: string; name: string; categories: Category[] };
type FormRow = { id: string; name: string; status: string; version: number; categories: number; updatedAt: string };

// school/state/city are DATASET-backed searchable dropdowns (no manual options).
const QTYPES: QType[] = ["text", "textarea", "number", "date", "dropdown", "checkbox", "radio", "file", "school", "state", "city"];
const TYPE_LABEL: Record<QType, string> = {
  text: "Short text", textarea: "Paragraph", number: "Number", date: "Date",
  dropdown: "Dropdown (pick one)", checkbox: "Checkboxes (pick many)", radio: "Multiple choice (pick one)",
  file: "File upload", school: "School (searchable)", state: "State / UT", city: "City",
};
const HAS_OPTIONS = (t: QType) => t === "dropdown" || t === "checkbox" || t === "radio";
const DATASET_HINTS: Partial<Record<QType, string>> = {
  school: "Searchable from the school database (name · district · state).",
  state: "Indian states/UTs — searchable dropdown.",
  city: "Cascades off the nearest State question above it — add a State question first.",
};

function slug(s: string, fallback: string): string {
  const v = (s || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return v || fallback;
}

// ── draft <-> server schema ──
function qToSchema(q: Question, qi: number, used: Set<string>): Record<string, unknown> {
  let qk = slug(q.label, `q_${qi + 1}`);
  while (used.has(qk)) qk = qk + "_" + (qi + 1);
  used.add(qk);
  const out: Record<string, unknown> = { key: qk, label: q.label.trim() || `Question ${qi + 1}`, type: q.type, required: !!q.required };
  if (HAS_OPTIONS(q.type)) out.options = (q.options || "").split(",").map((o) => o.trim()).filter(Boolean);
  if (q.type === "file") {
    const accept = (q.accept || "").split(",").map((o) => o.trim()).filter(Boolean);
    if (accept.length) out.accept = accept;
    const mb = Number(q.maxSizeMb);
    if (Number.isFinite(mb) && mb > 0) out.maxSizeMb = mb;
    if (q.multiple) out.multiple = true;
  }
  if ((q.help || "").trim()) out.help = q.help!.trim();
  if (q.hasException) out.exception = { key: qk + "_exc", label: (q.exceptionLabel || "Not applicable").trim() };
  return out;
}

function toSchema(d: FormDraft) {
  const usedC = new Set<string>();
  const categories = d.categories.map((c, ci) => {
    let ck = slug(c.title, `cat_${ci + 1}`);
    while (usedC.has(ck)) ck = ck + "_" + (ci + 1);
    usedC.add(ck);
    const usedQ = new Set<string>(); // keys unique across the whole category (direct + subcategories share one answer namespace)
    const questions = c.questions.map((q, qi) => qToSchema(q, qi, usedQ));
    const usedS = new Set<string>();
    const subcategories = (c.subcategories || []).map((s, si) => {
      let sk = slug(s.title, `sub_${si + 1}`);
      while (usedS.has(sk)) sk = sk + "_" + (si + 1);
      usedS.add(sk);
      return { key: sk, title: s.title.trim() || `Section ${si + 1}`, questions: s.questions.map((q, qi) => qToSchema(q, qi, usedQ)) };
    });
    const out: Record<string, unknown> = { key: ck, title: c.title.trim() || `Category ${ci + 1}`, questions };
    if (subcategories.length) out.subcategories = subcategories;
    return out;
  });
  return { categories };
}

function qFromSchema(q: Record<string, unknown>): Question {
  return {
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
  };
}

function fromSchema(id: string, name: string, schema: { categories?: Array<Record<string, unknown>> }): FormDraft {
  const categories = (schema.categories ?? []).map((c) => ({
    title: String(c.title ?? ""),
    questions: ((c.questions as Array<Record<string, unknown>>) ?? []).map(qFromSchema),
    subcategories: ((c.subcategories as Array<Record<string, unknown>>) ?? []).map((s) => ({
      title: String(s.title ?? ""),
      questions: ((s.questions as Array<Record<string, unknown>>) ?? []).map(qFromSchema),
    })),
    collapsed: true,
  }));
  return { id, name, categories };
}

const newQuestion = (): Question => ({ label: "", type: "text", required: false });

const input = "w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 focus:border-[#00cfe5] focus:outline-none";
const btn = "rounded-lg px-4 py-2 text-sm font-semibold";
const chip = "rounded-lg border border-white/15 px-2.5 py-1 text-xs text-white/70 hover:text-white hover:border-white/30";

export function VsatFormBuilder() {
  const [supabase] = useState(() => createClient());
  const [forms, setForms] = useState<FormRow[]>([]);
  const [draft, setDraft] = useState<FormDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  // drag state: a list id ("cat", `cat-${ci}`, `cat-${ci}-sub-${si}`) + the dragged index
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

  async function setStatus(id: string, status: "active" | "draft" | "archived") {
    setBusy(true); setMsg("");
    const { data } = await supabase.rpc("vsat_form_set_status", { p: { id, status } });
    setBusy(false);
    if (!data?.ok) return setMsg(data?.code || "Couldn't change status.");
    setMsg(status === "active" ? "This form is now live for all paid applicants." : `Form set to ${status}.`);
    void loadList();
  }

  // ── draft editing ──
  const up = (fn: (d: FormDraft) => FormDraft) => setDraft((d) => (d ? fn(structuredClone(d)) : d));
  const addCategory = () => up((d) => { d.categories.push({ title: "", questions: [], subcategories: [], collapsed: false }); return d; });
  const dupCategory = (ci: number) => up((d) => { const c = structuredClone(d.categories[ci]); c.title = c.title ? c.title + " (copy)" : ""; d.categories.splice(ci + 1, 0, c); return d; });
  const addQuestion = (ci: number, si: number | null) => up((d) => { (si == null ? d.categories[ci].questions : d.categories[ci].subcategories[si].questions).push(newQuestion()); return d; });
  const addSub = (ci: number) => up((d) => { d.categories[ci].subcategories.push({ title: "", questions: [] }); return d; });

  const qListOf = (d: FormDraft, ci: number, si: number | null) => (si == null ? d.categories[ci].questions : d.categories[ci].subcategories[si].questions);
  const editQ = (ci: number, si: number | null, qi: number, patch: Partial<Question>) =>
    up((d) => { const list = qListOf(d, ci, si); list[qi] = { ...list[qi], ...patch }; return d; });
  const dupQ = (ci: number, si: number | null, qi: number) =>
    up((d) => { const list = qListOf(d, ci, si); list.splice(qi + 1, 0, structuredClone(list[qi])); return d; });
  const delQ = (ci: number, si: number | null, qi: number) =>
    up((d) => { qListOf(d, ci, si).splice(qi, 1); return d; });

  // drag reorder within the same list id
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
                <p className="font-semibold">{f.name} {f.status === "active" && <span className="ml-2 rounded-full bg-[#16a34a]/20 px-2 py-0.5 text-xs text-[#4ade80]">LIVE</span>}{f.status === "archived" && <span className="ml-2 text-xs text-white/30">archived</span>}</p>
                <p className="text-xs text-white/40">{f.categories} categor{f.categories === 1 ? "y" : "ies"} · v{f.version}</p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => editForm(f.id)} disabled={busy} className={`${btn} border border-white/15 text-white`}>Edit</button>
                {f.status !== "active"
                  ? <button onClick={() => setStatus(f.id, "active")} disabled={busy} className={`${btn} bg-[#16a34a] text-white`}>Enable</button>
                  : <button onClick={() => setStatus(f.id, "draft")} disabled={busy} className={`${btn} border border-white/15 text-white`}>Disable</button>}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── a single question editor (shared by category-level and subcategory questions) ──
  const questionCard = (q: Question, ci: number, si: number | null, qi: number, list: string) => (
    <div
      key={qi}
      draggable
      onDragStart={() => { drag.current = { list, index: qi }; }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={() => onDrop(list, qi)}
      className="rounded-lg border border-white/10 bg-black/20 p-3"
    >
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
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <input value={q.accept ?? ""} onChange={(e) => editQ(ci, si, qi, { accept: e.target.value })} placeholder="Allowed types (e.g. application/pdf, .jpg, image/*)" className={`${input} sm:col-span-2`} />
          <input type="number" min={1} value={q.maxSizeMb ?? ""} onChange={(e) => editQ(ci, si, qi, { maxSizeMb: e.target.value })} placeholder="Max MB" className={input} />
          <label className="flex items-center gap-2 text-xs text-white/60 sm:col-span-3"><input type="checkbox" checked={!!q.multiple} onChange={(e) => editQ(ci, si, qi, { multiple: e.target.checked })} /> allow multiple files</label>
        </div>
      )}

      {DATASET_HINTS[q.type] && <p className="mt-2 text-xs text-white/40">{DATASET_HINTS[q.type]}</p>}

      <input value={q.help ?? ""} onChange={(e) => editQ(ci, si, qi, { help: e.target.value })} placeholder="Guidance text (optional — shown under the question to help students)" className={`${input} mt-2 text-xs`} />

      <label className="mt-2 flex items-center gap-2 text-xs text-white/50">
        <input type="checkbox" checked={!!q.hasException} onChange={(e) => editQ(ci, si, qi, { hasException: e.target.checked })} />
        allow a skip-exception
      </label>
      {q.hasException && (
        <input value={q.exceptionLabel ?? ""} onChange={(e) => editQ(ci, si, qi, { exceptionLabel: e.target.value })} placeholder='Exception label (e.g. "12th results not out yet")' className={`${input} mt-2`} />
      )}
    </div>
  );

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
            <div
              key={ci}
              draggable
              onDragStart={(e) => { if (e.target === e.currentTarget || (e.target as HTMLElement).dataset.draghandle) { drag.current = { list: "cat", index: ci }; } }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => onDrop("cat", ci)}
              className="rounded-xl border border-white/10 bg-white/5"
            >
              {/* category header (click to collapse) */}
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
                  {/* category-level questions */}
                  {c.questions.map((q, qi) => questionCard(q, ci, null, qi, `cat-${ci}`))}
                  <button onClick={() => addQuestion(ci, null)} className="rounded-lg border border-dashed border-white/20 px-3 py-2 text-xs text-white/60 hover:text-white">+ Add question</button>

                  {/* subcategories */}
                  {c.subcategories.map((s, si) => (
                    <div key={si} className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
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

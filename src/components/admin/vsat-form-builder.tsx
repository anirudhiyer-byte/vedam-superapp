"use client";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type QType = "text" | "textarea" | "number" | "date" | "dropdown" | "file";
type Question = { label: string; type: QType; required: boolean; options?: string; hasException?: boolean; exceptionLabel?: string };
type Category = { title: string; questions: Question[] };
type FormDraft = { id?: string; name: string; categories: Category[] };
type FormRow = { id: string; name: string; status: string; version: number; categories: number; updatedAt: string };

const QTYPES: QType[] = ["text", "textarea", "number", "date", "dropdown", "file"];

function slug(s: string, fallback: string): string {
  const v = (s || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return v || fallback;
}

// build the server schema (stable, unique keys derived from titles/labels)
function toSchema(d: FormDraft) {
  const usedC = new Set<string>();
  const categories = d.categories.map((c, ci) => {
    let ck = slug(c.title, `cat_${ci + 1}`);
    while (usedC.has(ck)) ck = ck + "_" + (ci + 1);
    usedC.add(ck);
    const usedQ = new Set<string>();
    const questions = c.questions.map((q, qi) => {
      let qk = slug(q.label, `q_${qi + 1}`);
      while (usedQ.has(qk)) qk = qk + "_" + (qi + 1);
      usedQ.add(qk);
      const out: Record<string, unknown> = { key: qk, label: q.label.trim() || `Question ${qi + 1}`, type: q.type, required: !!q.required };
      if (q.type === "dropdown") out.options = (q.options || "").split(",").map((o) => o.trim()).filter(Boolean);
      if (q.hasException) out.exception = { key: qk + "_exc", label: (q.exceptionLabel || "Not applicable").trim() };
      return out;
    });
    return { key: ck, title: c.title.trim() || `Category ${ci + 1}`, questions };
  });
  return { categories };
}

// load a server schema back into the editable draft
function fromSchema(id: string, name: string, schema: { categories?: Array<Record<string, unknown>> }): FormDraft {
  const categories = (schema.categories ?? []).map((c) => ({
    title: String(c.title ?? ""),
    questions: ((c.questions as Array<Record<string, unknown>>) ?? []).map((q) => ({
      label: String(q.label ?? ""),
      type: (QTYPES.includes(q.type as QType) ? q.type : "text") as QType,
      required: !!q.required,
      options: Array.isArray(q.options) ? (q.options as string[]).join(", ") : "",
      hasException: !!q.exception,
      exceptionLabel: (q.exception as { label?: string } | undefined)?.label ?? "",
    })),
  }));
  return { id, name, categories };
}

const input = "w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 focus:border-[#00cfe5] focus:outline-none";
const btn = "rounded-lg px-4 py-2 text-sm font-semibold";

export function VsatFormBuilder() {
  const [supabase] = useState(() => createClient());
  const [forms, setForms] = useState<FormRow[]>([]);
  const [draft, setDraft] = useState<FormDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

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

  // ── draft editing helpers ──
  const up = (fn: (d: FormDraft) => FormDraft) => setDraft((d) => (d ? fn(structuredClone(d)) : d));
  const addCategory = () => up((d) => { d.categories.push({ title: "", questions: [] }); return d; });
  const addQuestion = (ci: number) => up((d) => { d.categories[ci].questions.push({ label: "", type: "text", required: false }); return d; });

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

  // ── EDIT VIEW ──
  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <div className="flex items-center justify-between">
        <button onClick={() => { setDraft(null); setMsg(""); }} className="text-sm text-white/50 hover:text-white">← All forms</button>
        <div className="flex items-center gap-2">
          <button onClick={save} disabled={busy} className={`${btn} bg-gradient-to-r from-[#00cfe5] to-[#c200db] text-white`}>{busy ? "Saving…" : "Save"}</button>
        </div>
      </div>
      {msg && <p className="mt-3 text-sm text-[#00cfe5]">{msg}</p>}

      <input value={draft.name} onChange={(e) => up((d) => { d.name = e.target.value; return d; })} placeholder="Form name (e.g. VSAT 2027 application)" className={`${input} mt-5 text-lg`} />

      <div className="mt-6 space-y-5">
        {draft.categories.map((c, ci) => (
          <div key={ci} className="rounded-xl border border-white/10 bg-white/5 p-4">
            <div className="flex items-center gap-2">
              <input value={c.title} onChange={(e) => up((d) => { d.categories[ci].title = e.target.value; return d; })} placeholder={`Category ${ci + 1} title (e.g. Basic details)`} className={`${input} font-semibold`} />
              <button onClick={() => up((d) => { d.categories.splice(ci, 1); return d; })} className="shrink-0 rounded-lg border border-white/15 px-3 py-2 text-xs text-white/60 hover:text-[#ff9db0]">Remove</button>
            </div>
            <div className="mt-3 space-y-3">
              {c.questions.map((q, qi) => (
                <div key={qi} className="rounded-lg border border-white/10 bg-black/20 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <input value={q.label} onChange={(e) => up((d) => { d.categories[ci].questions[qi].label = e.target.value; return d; })} placeholder="Question label" className={`${input} flex-1 min-w-[180px]`} />
                    <select value={q.type} onChange={(e) => up((d) => { d.categories[ci].questions[qi].type = e.target.value as QType; return d; })} className={`${input} w-32`}>
                      {QTYPES.map((t) => <option key={t} value={t} className="bg-[#160a30]">{t}</option>)}
                    </select>
                    <label className="flex items-center gap-1 text-xs text-white/60"><input type="checkbox" checked={q.required} onChange={(e) => up((d) => { d.categories[ci].questions[qi].required = e.target.checked; return d; })} /> required</label>
                    <button onClick={() => up((d) => { d.categories[ci].questions.splice(qi, 1); return d; })} className="rounded px-2 py-1 text-xs text-white/40 hover:text-[#ff9db0]">✕</button>
                  </div>
                  {q.type === "dropdown" && (
                    <input value={q.options ?? ""} onChange={(e) => up((d) => { d.categories[ci].questions[qi].options = e.target.value; return d; })} placeholder="Options, comma-separated (e.g. CSE, AI/ML, ECE)" className={`${input} mt-2`} />
                  )}
                  <label className="mt-2 flex items-center gap-2 text-xs text-white/50">
                    <input type="checkbox" checked={!!q.hasException} onChange={(e) => up((d) => { d.categories[ci].questions[qi].hasException = e.target.checked; return d; })} />
                    allow a skip-exception
                  </label>
                  {q.hasException && (
                    <input value={q.exceptionLabel ?? ""} onChange={(e) => up((d) => { d.categories[ci].questions[qi].exceptionLabel = e.target.value; return d; })} placeholder='Exception label (e.g. "12th results not out yet")' className={`${input} mt-2`} />
                  )}
                </div>
              ))}
              <button onClick={() => addQuestion(ci)} className="rounded-lg border border-dashed border-white/20 px-3 py-2 text-xs text-white/60 hover:text-white">+ Add question</button>
            </div>
          </div>
        ))}
        <button onClick={addCategory} className="w-full rounded-xl border border-dashed border-white/20 px-4 py-3 text-sm text-white/60 hover:text-white">+ Add category</button>
      </div>
    </div>
  );
}

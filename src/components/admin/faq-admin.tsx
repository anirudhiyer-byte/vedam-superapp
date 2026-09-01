"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Faq = { id: string; question: string; answer: string; category: string; order: number; published: boolean };
const field = "w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-[color:rgb(var(--accent))]";

export function FaqAdmin() {
  const [supabase] = useState(() => createClient());
  const [faqs, setFaqs] = useState<Faq[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() { const { data } = await supabase.from("faqs").select("*").order("order"); setFaqs((data as Faq[]) ?? []); setLoading(false); }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  async function add() { await supabase.from("faqs").insert({ question: "New question", answer: "", order: faqs.length + 1 }); load(); }
  async function save(f: Faq) { await supabase.from("faqs").update({ question: f.question, answer: f.answer, category: f.category, order: f.order, published: f.published }).eq("id", f.id); }
  async function del(id: string) { if (confirm("Delete this FAQ?")) { await supabase.from("faqs").delete().eq("id", id); load(); } }
  const set = (id: string, patch: Partial<Faq>) => setFaqs((fs) => fs.map((f) => f.id === id ? { ...f, ...patch } : f));

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <div className="mb-6 flex items-end justify-between">
        <div><span className="font-mono text-xs font-semibold lowercase tracking-[0.12em] text-accent">// faqs</span>
          <h1 className="mt-2 font-display text-3xl font-extrabold tracking-tight text-heading">FAQs</h1>
          <p className="mt-1 font-body text-sm text-muted">Add questions & answers. Only published ones show on the home page.</p></div>
        <button onClick={add} className="rounded-xl bg-brand-gradient px-5 py-2.5 text-sm font-semibold text-white">+ Add FAQ</button>
      </div>
      {loading ? <div className="h-40 animate-pulse rounded-2xl border border-border bg-surface" /> : (
        <div className="space-y-3">
          {faqs.map((f) => (
            <div key={f.id} className="rounded-2xl border border-border bg-surface p-4">
              <div className="flex items-center gap-2">
                <input type="number" value={f.order} onChange={(e) => set(f.id, { order: +e.target.value })} onBlur={() => save(f)} className={field + " w-16"} />
                <input value={f.question} onChange={(e) => set(f.id, { question: e.target.value })} onBlur={() => save(f)} placeholder="Question" className={field + " flex-1 font-semibold"} />
                <label className="flex shrink-0 items-center gap-1.5 font-mono text-xs text-muted"><input type="checkbox" checked={f.published} onChange={(e) => { set(f.id, { published: e.target.checked }); setTimeout(() => save({ ...f, published: e.target.checked }), 0); }} className="h-4 w-4 accent-[color:rgb(var(--accent))]" />published</label>
                <button onClick={() => del(f.id)} className="shrink-0 font-mono text-xs text-red-500">delete</button>
              </div>
              <textarea value={f.answer} onChange={(e) => set(f.id, { answer: e.target.value })} onBlur={() => save(f)} rows={2} placeholder="Answer" className={field + " mt-2"} />
            </div>
          ))}
          {faqs.length === 0 && <p className="font-body text-sm text-muted">No FAQs yet — add one.</p>}
        </div>
      )}
    </div>
  );
}

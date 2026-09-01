"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Faq = { id: string; question: string; answer: string };

export function FaqAccordion() {
  const [supabase] = useState(() => createClient());
  const [faqs, setFaqs] = useState<Faq[]>([]);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    supabase.from("faqs").select("id, question, answer").eq("published", true).order("order")
      .then(({ data }) => { const list = (data as Faq[]) ?? []; setFaqs(list); if (list[0]) setOpen(list[0].id); });
  }, [supabase]);

  if (faqs.length === 0) return null;
  return (
    <section className="mx-auto max-w-3xl px-6 py-14 sm:px-10">
      <span className="font-mono text-xs font-semibold lowercase tracking-[0.12em] text-accent">// faqs</span>
      <h2 className="mt-2 font-display text-3xl font-extrabold tracking-tight text-heading">Got questions?</h2>
      <div className="mt-6 space-y-2">
        {faqs.map((f) => (
          <div key={f.id} className="overflow-hidden rounded-2xl border border-border bg-surface">
            <button onClick={() => setOpen(open === f.id ? null : f.id)} className="flex w-full items-center justify-between gap-3 p-4 text-left font-display text-[15px] font-semibold text-heading">
              {f.question}<span className="text-muted">{open === f.id ? "−" : "+"}</span>
            </button>
            {open === f.id && <p className="whitespace-pre-line px-4 pb-4 font-body text-sm text-muted">{f.answer}</p>}
          </div>
        ))}
      </div>
    </section>
  );
}

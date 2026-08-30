"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Module = { id: string; slug: string; title: string; subtitle: string | null; taught_by: string | null; level: string | null; duration_label: string | null; lessons: number };
const GRADS = ["linear-gradient(120deg,#F97D03,#E80074)", "linear-gradient(120deg,#8A18FF,#3a1470)", "linear-gradient(120deg,#12b3a6,#2B135C)", "linear-gradient(120deg,#6E56CF,#F97D03)"];
const FAQS = [
  ["What is CodeSprint?", "A free program for 12th-grade students starting B.Tech CS this year, to build coding fundamentals before college begins."],
  ["Who can join?", "Anyone who has completed 12th and is about to start B.Tech in CS or a related field."],
  ["What will I learn?", "Programming fundamentals, problem-solving, and the key concepts you'll meet in your first year."],
  ["Is there a certificate?", "Yes — finish a module and you get a Certificate of Completion for that module, plus points."],
];

export function CsLanding() {
  const [supabase] = useState(() => createClient());
  const router = useRouter();
  const [modules, setModules] = useState<Module[]>([]);
  const [authed, setAuthed] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("cs_modules").select("id, slug, title, subtitle, taught_by, level, duration_label, cs_lessons(count)").eq("published", true).order("order");
      const mods = (data ?? []).map((m: Record<string, unknown>) => ({ ...m, lessons: (m.cs_lessons as { count: number }[])?.[0]?.count ?? 0 })) as Module[];
      setModules(mods);
      const { data: s } = await supabase.auth.getSession();
      setAuthed(!!s.session);
    })();
  }, [supabase]);

  async function register() {
    if (!authed) { router.push("/login?next=/codesprint"); return; }
    await supabase.rpc("cs_enroll");
    router.push("/codesprint/learn");
  }
  function startModule(slug: string) {
    const dest = `/codesprint/learn?module=${slug}`;
    if (!authed) { router.push(`/login?next=${encodeURIComponent(dest)}`); return; }
    router.push(dest);
  }
  const totalHours = useMemo(() => modules.length, [modules]);

  return (
    <div className="mx-auto max-w-5xl px-6 py-12 sm:px-10">
      {/* hero */}
      <div className="text-center">
        <span className="font-mono text-xs font-semibold uppercase tracking-[0.22em] text-accent">Start smart, start early</span>
        <h1 className="mx-auto mt-3 max-w-[16ch] font-display text-4xl font-extrabold leading-[1.05] tracking-tight text-heading sm:text-5xl">Sprint into college with a <span className="text-brand-gradient">clear advantage</span></h1>
        <p className="mx-auto mt-4 max-w-[44ch] font-body text-base text-muted">A free, self-paced program for 12th-grade students starting B.Tech CS this year.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <button onClick={register} className="rounded-xl bg-brand-gradient px-6 py-3 text-sm font-semibold text-white">Register for CodeSprint</button>
          <a href="https://t.me/vedamschooloftechnology" target="_blank" rel="noreferrer" className="rounded-xl border border-border-strong px-6 py-3 text-sm font-semibold text-foreground hover:bg-surface-warm">Join Community</a>
        </div>
        <div className="mt-4 flex flex-wrap justify-center gap-x-6 gap-y-2 font-mono text-xs text-muted">
          <span>✓ Beginner friendly</span><span>✓ Free of cost</span><span>✓ No prior experience</span>
        </div>
      </div>

      {/* modules */}
      <div className="mb-4 mt-14 flex items-baseline justify-between">
        <h2 className="font-display text-2xl font-bold text-heading">Built for coders who want to start early</h2>
        <span className="font-mono text-xs text-muted">{modules.length} module{modules.length === 1 ? "" : "s"}</span>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {modules.map((m, i) => (
          <button key={m.id} onClick={() => startModule(m.slug)} className="group flex flex-col overflow-hidden rounded-2xl border border-border bg-surface text-left transition-all hover:-translate-y-1 hover:shadow-[0_20px_44px_-24px_rgba(43,19,92,0.4)]">
            <div className="relative flex h-24 items-end p-4 text-white" style={{ background: GRADS[i % GRADS.length] }}>
              <div aria-hidden className="absolute inset-0 opacity-20" style={{ backgroundImage: "radial-gradient(#fff 1px, transparent 1.3px)", backgroundSize: "16px 16px" }} />
              <h3 className="relative font-display text-lg font-extrabold leading-tight">{m.title}</h3>
              {m.taught_by && <span className="absolute right-3 top-3 rounded-full bg-white/20 px-2.5 py-1 font-mono text-[10px] font-semibold backdrop-blur">by {m.taught_by}</span>}
            </div>
            <div className="flex flex-1 flex-col p-5">
              {m.subtitle && <p className="font-body text-sm text-muted">{m.subtitle}</p>}
              <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 font-mono text-xs text-muted">
                <span>{m.level || "Beginner"}</span>{m.duration_label && <span>· {m.duration_label}</span>}<span>· {m.lessons} lesson{m.lessons === 1 ? "" : "s"}</span>
              </div>
              <span className="mt-4 rounded-lg bg-brand-gradient px-4 py-2.5 text-center text-sm font-semibold text-white">Start Free →</span>
            </div>
          </button>
        ))}
        {modules.length === 0 && <p className="font-body text-sm text-muted">Modules are being set up — check back soon.</p>}
      </div>

      {/* cert note */}
      <div className="mt-12 rounded-2xl border border-border bg-surface-warm p-6 text-center">
        <h3 className="font-display text-lg font-bold text-heading">Get a Certificate of Completion at the end</h3>
        <p className="mt-1 font-body text-sm text-muted">Finish every lesson in a module to earn its certificate, verifiable and ready to share.</p>
      </div>

      {/* FAQ */}
      <h2 className="mb-4 mt-14 font-display text-2xl font-bold text-heading">Got questions?</h2>
      <div className="space-y-2">
        {FAQS.map(([q, a], i) => (
          <div key={i} className="overflow-hidden rounded-2xl border border-border bg-surface">
            <button onClick={() => setOpenFaq(openFaq === i ? null : i)} className="flex w-full items-center justify-between p-4 text-left font-display text-sm font-semibold text-heading">{q}<span className="text-muted">{openFaq === i ? "−" : "+"}</span></button>
            {openFaq === i && <p className="px-4 pb-4 font-body text-sm text-muted">{a}</p>}
          </div>
        ))}
      </div>
      <p className="mt-3 font-mono text-[10px] text-muted">// {totalHours} modules · self-paced</p>
    </div>
  );
}

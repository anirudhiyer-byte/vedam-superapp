"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useProductGate } from "@/components/funnel/use-product-gate";
import { useResumeAction } from "@/lib/funnel/use-resume-action";
import VedamCertificate from "@/components/events/vedam-certificate";
import { CsHero } from "@/components/codesprint/cs-hero";
import { CsBand, HeroCurve } from "@/components/codesprint/cs-band";
import { CsModuleCard } from "@/components/codesprint/cs-module-card";

type Module = { id: string; slug: string; title: string; subtitle: string | null; taught_by: string | null; level: string | null; duration_label: string | null; thumbnail_url: string | null; lessons: number };

const BANNERS = [
  "radial-gradient(circle at 28% 55%, #ffe0b0, #ffbf85 45%, #ff9a6b 72%, #ffd4ef)",
  "radial-gradient(circle at 28% 55%, #bff5d4, #93e7d6 45%, #86d2ea 72%, #c6ecff)",
  "radial-gradient(circle at 28% 55%, #d3c4ff, #b299ff 45%, #ff9a6b 82%)",
  "radial-gradient(circle at 28% 55%, #ffc9e6, #ffb1c4 45%, #ffd6a6 82%)",
];
const FAQS = [
  ["What is CodeSprint?", "A free program for 12th-grade students starting B.Tech CS this year, to build coding fundamentals before college begins."],
  ["Who can join?", "Anyone who has completed 12th and is about to start B.Tech in CS or a related field."],
  ["What will I learn?", "Programming fundamentals, problem-solving, and the key concepts you'll meet in your first year."],
  ["Is there a certificate?", "Yes — finish a module and you get a Certificate of Completion for that module, plus points."],
];

/** Placeholder slot the design team drops a Figma frame into. */
function FigmaSlot({ label }: { label: string }) {
  return (
    <div className="my-12 grid min-h-[160px] place-items-center rounded-2xl border-2 border-dashed border-border-strong bg-surface/40 text-center">
      <div>
        <p className="font-mono text-xs font-semibold uppercase tracking-wider text-muted">Figma frame</p>
        <p className="mt-1 font-body text-sm text-muted">{label}</p>
      </div>
    </div>
  );
}

/** Live, scaled preview of the actual completion certificate. */
function CertPreview() {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.6);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const update = () => setScale(el.clientWidth / 1123);
    update();
    const ro = new ResizeObserver(update); ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={ref} className="mx-auto w-full max-w-[720px] overflow-hidden rounded-2xl border border-border shadow-[0_24px_60px_-28px_rgba(43,19,92,0.5)]" style={{ aspectRatio: "1123 / 793" }}>
      <div style={{ width: 1123, height: 793, transformOrigin: "top left", transform: `scale(${scale})` }}>
        <VedamCertificate fullName="Aarav Sharma" bootcampName="Prompt Engineering in CodeSprint" kind="completion" certificateId="CS-PREVIEW" showQr={false} issueDate={new Date()} />
      </div>
    </div>
  );
}

export function CsLanding() {
  const [supabase] = useState(() => createClient());
  const router = useRouter();
  const [modules, setModules] = useState<Module[]>([]);
  const [authed, setAuthed] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  const { gate, Modals } = useProductGate();

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("cs_modules").select("id, slug, title, subtitle, taught_by, level, duration_label, thumbnail_url, cs_lessons(count)").eq("published", true).order("order");
      setModules((data ?? []).map((m: Record<string, unknown>) => ({ ...m, lessons: (m.cs_lessons as { count: number }[])?.[0]?.count ?? 0 })) as Module[]);
      const { data: s } = await supabase.auth.getSession();
      setAuthed(!!s.session);
    })();
  }, [supabase]);

  async function doEnroll() { try { await supabase.rpc("cs_enroll"); } catch {} try { await supabase.rpc("cs_log_enroll"); } catch {} router.push("/codesprint/learn"); }
  function doStartModule(slug: string) { router.push(`/codesprint/learn?module=${slug}`); }
  const register = () => gate({ kind: "start_codesprint" }, doEnroll, "Create your account to start CodeSprint.");
  const startModule = (slug: string) => gate({ kind: "start_codesprint", moduleSlug: slug }, () => doStartModule(slug), "Create your account to start this module.");
  // resume after login/signup/profile-completion
  useResumeAction((a) => { if (a.kind === "start_codesprint") { if (a.moduleSlug) doStartModule(a.moduleSlug); else void doEnroll(); } });
  const totalHours = useMemo(() => modules.length, [modules]);

  return (
    <div className="bg-[#0d0d0d]">
      {/* HERO (new) with its ⌣ bottom */}
      <div className="relative">
        <CsHero onStartNow={register} />
        <HeroCurve />
      </div>

      {/* ORANGE stats band + module cards on the black section (module 1 straddles the seam) */}
      <div id="modules">
        <CsBand>
          {modules.map((m, i) => (
            <CsModuleCard key={m.id} m={m} straddle={i === 0} onStart={() => startModule(m.slug)} />
          ))}
          {modules.length === 0 && <p className="py-10 text-center font-body text-sm text-white/50">Modules are being set up — check back soon.</p>}
        </CsBand>
      </div>

      {/* CERT + FAQ (kept until those sections are rebuilt) */}
      <div className="mx-auto max-w-5xl px-6 py-14 sm:px-10">
        <div className="text-center">
          <h3 className="font-display text-2xl font-bold text-white">Get a Certificate of Completion at the end</h3>
          <p className="mx-auto mt-1 max-w-[46ch] font-body text-sm text-white/60">Finish every lesson in a module to earn its certificate — here&apos;s exactly what yours will look like:</p>
          <div className="mt-6"><CertPreview /></div>
        </div>
        <h2 className="mb-4 mt-14 font-display text-2xl font-bold text-white">Got questions?</h2>
        <div className="space-y-2">
          {FAQS.map(([q, a], i) => (
            <div key={i} className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04]">
              <button onClick={() => setOpenFaq(openFaq === i ? null : i)} className="flex w-full items-center justify-between p-4 text-left font-display text-sm font-semibold text-white">{q}<span className="text-white/50">{openFaq === i ? "−" : "+"}</span></button>
              {openFaq === i && <p className="px-4 pb-4 font-body text-sm text-white/60">{a}</p>}
            </div>
          ))}
        </div>
        <p className="mt-3 font-mono text-[10px] text-white/40">// {totalHours} modules · self-paced</p>
      </div>
      <Modals />
    </div>
  );
}

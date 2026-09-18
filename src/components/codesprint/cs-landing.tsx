"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useProductGate } from "@/components/funnel/use-product-gate";
import { useResumeAction } from "@/lib/funnel/use-resume-action";
import VedamCertificate from "@/components/events/vedam-certificate";
import { CsHero } from "@/components/codesprint/cs-hero";
import { CsBand } from "@/components/codesprint/cs-band";
import { CsBandMobile } from "@/components/codesprint/cs-band-mobile";
import { CsModuleCard } from "@/components/codesprint/cs-module-card";
import { CsCertSection } from "@/components/codesprint/cs-cert-section";
import { CsTestimonials } from "@/components/codesprint/cs-testimonials";

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

  const STAR_LINES = ["Learn coding basics, logic and problem-solving", "Learn practical AI app development skills", "Learn HTML and create responsive websites", "Learn prompting, AI tools and workflows"];
  return (
    <div className="bg-[#0d0d0d]">
      {/* HERO (new) with its ⌣ bottom */}
      <div className="relative">
        <CsHero onStartNow={register} />
      </div>

      {/* ORANGE stats band + module cards on the black section (module 1 straddles the seam) */}
      <div id="modules">
        {/* desktop band + cards */}
        <div className="hidden lg:block">
          <CsBand>
            {modules.map((m, i) => (
              <CsModuleCard key={m.id} m={{ ...m, subtitle: STAR_LINES[i] ?? m.subtitle ?? null }} straddle={i === 0} onStart={() => startModule(m.slug)} />
            ))}
            {modules.length === 0 && <p className="py-10 text-center font-body text-sm text-white/50">Modules are being set up — check back soon.</p>}
          </CsBand>
        </div>
        {/* mobile band + 2-col cards */}
        <div className="lg:hidden">
          <CsBandMobile modules={modules.map((m, i) => ({ ...m, subtitle: STAR_LINES[i] ?? m.subtitle ?? null }))} onStart={startModule} />
        </div>
      </div>

      {/* CERTIFICATE section */}
      <CsCertSection onStartLearning={register} />

      {/* TESTIMONIALS */}
      <CsTestimonials />

      {/* FAQ */}
      <section className="relative overflow-hidden bg-[#0d0d0d] px-6 py-16 sm:px-10">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/cs-polka.webp" alt="" aria-hidden className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-[0.22]" />
        <div className="relative z-10 mx-auto max-w-5xl">
        <style dangerouslySetInnerHTML={{ __html: `.cs-faq-box{position:relative;border-radius:16px;background:radial-gradient(140% 120% at 15% 10%,#141418,#0a0a0c 55%,#050506)}.cs-faq-box::before{content:"";position:absolute;inset:0;border-radius:16px;padding:1px;background:linear-gradient(120deg,rgba(255,180,31,.7),rgba(253,83,0,.28) 40%,rgba(255,180,31,.6));-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude;pointer-events:none}` }} />
        <h2 className="mb-5 font-display text-2xl font-bold text-white">Got questions?</h2>
        <div className="space-y-3">
          {FAQS.map(([q, a], i) => (
            <div key={i} className="cs-faq-box overflow-hidden">
              <button onClick={() => setOpenFaq(openFaq === i ? null : i)} className="flex w-full items-center justify-between p-4 text-left font-display text-sm font-semibold text-white">{q}<span className="text-[#FD8B03]">{openFaq === i ? "−" : "+"}</span></button>
              {openFaq === i && <p className="px-4 pb-4 font-body text-sm text-white/65">{a}</p>}
            </div>
          ))}
        </div>
        </div>
      </section>
      <Modals />
    </div>
  );
}

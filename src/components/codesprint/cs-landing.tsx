"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import VedamCertificate from "@/components/events/vedam-certificate";

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

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("cs_modules").select("id, slug, title, subtitle, taught_by, level, duration_label, thumbnail_url, cs_lessons(count)").eq("published", true).order("order");
      setModules((data ?? []).map((m: Record<string, unknown>) => ({ ...m, lessons: (m.cs_lessons as { count: number }[])?.[0]?.count ?? 0 })) as Module[]);
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
          <button onClick={register} className="rounded-xl bg-brand-gradient px-6 py-3 text-sm font-semibold text-white">{authed ? "Start learning" : "Register for CodeSprint"}</button>
          <a href="https://t.me/vedamschooloftechnology" target="_blank" rel="noreferrer" className="rounded-xl border border-border-strong px-6 py-3 text-sm font-semibold text-foreground hover:bg-surface-warm">Join Community</a>
        </div>
        {/* prominent badges */}
        <div className="mt-6 flex flex-wrap justify-center gap-2.5">
          {["Beginner friendly", "Free of cost", "No prior experience required"].map((t) => (
            <span key={t} className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-4 py-2 font-body text-sm font-semibold text-foreground shadow-sm">
              <span className="grid h-5 w-5 place-items-center rounded-full bg-[#12b3a6] text-[11px] text-white">✓</span>{t}
            </span>
          ))}
        </div>
      </div>

      <FigmaSlot label="Between hero & modules — outcomes / achievements banner, student shorts, etc." />

      {/* modules — screenshot-style horizontal cards */}
      <div className="mb-6 flex items-baseline justify-between">
        <h2 className="font-display text-2xl font-bold text-heading">Built for coders who want to start early</h2>
        <span className="font-mono text-xs text-muted">{modules.length} module{modules.length === 1 ? "" : "s"}</span>
      </div>
      <div className="space-y-5">
        {modules.map((m, i) => (
          <div key={m.id} className="flex flex-col overflow-hidden rounded-3xl border border-border bg-surface shadow-sm md:flex-row">
            {/* instructor banner */}
            <div className="relative flex min-h-[190px] items-center justify-center overflow-hidden p-6 md:w-[52%]" style={{ background: BANNERS[i % BANNERS.length] }}>
              {m.thumbnail_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={m.thumbnail_url} alt={m.taught_by ?? ""} className="absolute bottom-0 left-0 h-full w-auto object-contain" />
              )}
              <div className="relative text-center" style={{ marginLeft: m.thumbnail_url ? "28%" : 0 }}>
                <div className="text-2xl">⭐</div>
                <div className="my-1 flex items-center justify-center gap-2"><span className="h-px w-8 bg-black/30" /><span className="font-mono text-[11px] font-bold tracking-[0.2em] text-black/70">TAUGHT BY</span><span className="h-px w-8 bg-black/30" /></div>
                <div style={{ fontFamily: "var(--font-outfit), sans-serif", fontWeight: 800, fontSize: 30, lineHeight: 1, color: "#fff", WebkitTextStroke: "1.4px #241206", textTransform: "uppercase" }}>{m.taught_by || "Vedam"}</div>
                <div style={{ fontFamily: "var(--font-outfit), sans-serif", fontWeight: 800, fontSize: 24, lineHeight: 1.1, color: "#F97D03" }}>Instructor</div>
              </div>
            </div>
            {/* details */}
            <div className="flex flex-1 flex-col justify-center gap-2 p-6">
              <h3 className="font-display text-2xl font-extrabold leading-tight text-heading">{m.title}</h3>
              <div className="flex flex-wrap gap-x-5 gap-y-1 font-body text-sm text-foreground">
                <span className="inline-flex items-center gap-1.5">👤 {m.level || "Beginner Level"}</span>
                <span className="inline-flex items-center gap-1.5">🕐 {m.duration_label || `${m.lessons} lessons`}</span>
              </div>
              <div className="inline-flex items-center gap-1.5 font-body text-sm text-foreground">👁 Popular</div>
              {m.subtitle && <div className="inline-flex items-start gap-1.5 font-body text-sm text-muted">⭐ {m.subtitle}</div>}
              <button onClick={() => startModule(m.slug)} className="mt-3 rounded-xl px-4 py-3 text-center text-sm font-bold text-white transition-opacity hover:opacity-90" style={{ background: "#7C3AED" }}>Start Free</button>
            </div>
          </div>
        ))}
        {modules.length === 0 && <p className="font-body text-sm text-muted">Modules are being set up — check back soon.</p>}
      </div>

      <FigmaSlot label="After modules — testimonials / 'what students build' / stats" />

      {/* cert section with LIVE preview */}
      <div className="mt-4 text-center">
        <h3 className="font-display text-2xl font-bold text-heading">Get a Certificate of Completion at the end</h3>
        <p className="mx-auto mt-1 max-w-[46ch] font-body text-sm text-muted">Finish every lesson in a module to earn its certificate — here&apos;s exactly what yours will look like:</p>
        <div className="mt-6"><CertPreview /></div>
      </div>

      <FigmaSlot label="Before FAQs — 4-year program teaser / VSAT CTA" />

      {/* FAQ */}
      <h2 className="mb-4 font-display text-2xl font-bold text-heading">Got questions?</h2>
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

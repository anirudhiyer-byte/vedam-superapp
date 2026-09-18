"use client";
import type { CsModule } from "@/components/codesprint/cs-module-card";
const logoFor = (t?: string | null) => `/cs-logo-${String(t || "google").toLowerCase().replace(/[^a-z0-9]/g, "")}.webp`;
const ORANGE = "linear-gradient(120deg,#FFB41F,#FD5300)";

const CSS = `
.cs-mmc{position:relative;border-radius:16px;padding:12px;display:flex;flex-direction:column;gap:9px;overflow:hidden;
  background:radial-gradient(140% 120% at 15% 10%,#141418,#0a0a0c 55%,#050506);
  box-shadow:0 18px 40px -22px rgba(0,0,0,.85),inset 0 1px 0 rgba(255,255,255,.14),inset 0 0 30px rgba(255,255,255,.03)}
.cs-mmc::before{content:"";position:absolute;inset:0;border-radius:16px;padding:1px;background:linear-gradient(120deg,rgba(255,180,31,.85),rgba(253,83,0,.3) 40%,rgba(255,180,31,.7));-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude;pointer-events:none;z-index:2}
.cs-mmc::after{content:"";position:absolute;inset:0;border-radius:16px;background:linear-gradient(120deg,rgba(255,255,255,.06),transparent 28%,transparent 72%,rgba(255,255,255,.05));pointer-events:none;z-index:1}
.cs-mmc>*{position:relative;z-index:3}`;

function MobileCard({ m, onStart }: { m: CsModule; onStart: () => void }) {
  const company = (m.taught_by || "GOOGLE").trim();
  return (
    <div className="cs-mmc">
      <div className="flex items-center gap-2.5">
        <div className="relative h-[54px] w-[54px] flex-none rounded-full border border-[rgba(255,160,40,0.6)]" style={{ background: ORANGE }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {m.thumbnail_url ? <img src={m.thumbnail_url} alt="" className="absolute inset-0 h-full w-full rounded-full object-cover object-bottom" /> : null}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logoFor(m.taught_by)} alt="" className="absolute -right-1 top-1/2 h-5 w-5 -translate-y-1/2 rounded-full bg-white object-contain p-0.5" />
        </div>
        <div className="flex h-[54px] flex-col justify-between text-left">
          <div className="text-[7px] font-medium tracking-[1.5px] text-[#c9c9c9]">TAUGHT BY</div>
          <div className="font-[family-name:var(--font-inter)] text-[14px] font-extrabold uppercase text-white">{company}</div>
          <div className="font-[family-name:var(--font-playfair)] text-[12px] italic" style={{ backgroundImage: ORANGE, WebkitBackgroundClip: "text", backgroundClip: "text", WebkitTextFillColor: "transparent", color: "transparent" }}>Instructor</div>
        </div>
      </div>
      <h3 className="font-[family-name:var(--font-inter)] text-[13px] font-bold text-white">{m.title}</h3>
      <div className="flex flex-col gap-1 text-[8px] text-white">
        <div className="flex flex-wrap gap-2"><span><span className="text-[#5ce38a]">🧑</span> {m.level || "Beginner Level"}</span><span><span className="text-[#5ce38a]">👁</span> Popular</span></div>
        <span><span className="text-[#5ce38a]">⏱</span> {m.duration_label || ""}</span>
        <span><span className="text-[#5ce38a]">⭐</span> {m.subtitle || "Learn coding basics, logic and problem-solving"}</span>
      </div>
      <button onClick={onStart} className="mt-auto grid h-8 place-items-center rounded-2xl text-[12px] font-bold text-white" style={{ background: "linear-gradient(95deg,rgba(253,83,0,0.85),rgba(255,180,31,0.85))", border: "1px solid rgba(255,190,90,0.5)" }}>Start Free</button>
    </div>
  );
}

/** Mobile band + 2-col module cards with ⌣ curves. Rendered below lg only. */
export function CsBandMobile({ modules, onStart }: { modules: CsModule[]; onStart: (slug: string) => void }) {
  return (
    <div className="bg-[#0d0d0d]">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      {/* ORANGE stats band — ⌣ top + ⌣ bottom */}
      <section className="relative px-4 pb-11 pt-11 text-center" style={{ background: "linear-gradient(180deg,#FF9E12,#FD7B03 60%,#F97101)" }}>
        <svg className="absolute left-0 top-[-1px] block h-10 w-full" viewBox="0 0 390 40" preserveAspectRatio="none"><path d="M0,0 L390,0 L390,4 Q195,46 0,4 Z" fill="#0d0d0d" /></svg>
        <h2 className="relative z-[2] font-[family-name:var(--font-inter)] text-[19px] font-medium text-white">Built for coders who want to <span className="font-[family-name:var(--font-playfair)] italic">start early</span></h2>
        <div className="relative z-[2] mt-3.5 flex justify-center">
          {[["Courses offered", "4 Modules"], ["Duration", "<4 Hours each"], ["Taught by", "MAANG Experts"]].map(([l, v], i) => (
            <div key={l} className="flex flex-1 items-stretch">
              {i > 0 && <span className="w-px bg-white/50" />}
              <div className="flex-1 px-1.5"><div className="text-[11px] text-white">{l}</div><div className="mt-0.5 text-[12px] font-semibold text-[#231a10]">{v}</div></div>
            </div>
          ))}
        </div>
        <svg className="absolute bottom-[-1px] left-0 block h-[46px] w-full" viewBox="0 0 390 46" preserveAspectRatio="none"><path d="M0,46 L0,6 Q195,52 390,6 L390,46 Z" fill="#141414" /></svg>
      </section>

      {/* MODULES 2-col + ⌣ bottom */}
      <section className="relative grid grid-cols-2 items-stretch gap-3 bg-[#141414] px-3 pb-11 pt-5">
        {modules.map((m) => <MobileCard key={m.id} m={m} onStart={() => onStart(m.slug)} />)}
        {modules.length === 0 && <p className="col-span-2 py-6 text-center text-xs text-white/50">Modules coming soon.</p>}
        <svg className="absolute bottom-[-1px] left-0 col-span-2 block h-[34px] w-full" viewBox="0 0 390 34" preserveAspectRatio="none"><path d="M0,34 L0,5 Q195,40 390,5 L390,34 Z" fill="#FD7B03" /></svg>
      </section>

      {/* thin orange band ⌣ bottom */}
      <div className="relative h-3" style={{ background: "linear-gradient(180deg,#FD7B03,#F97101)" }}>
        <svg className="absolute bottom-[-1px] left-0 block h-3.5 w-full" viewBox="0 0 390 14" preserveAspectRatio="none"><path d="M0,14 L0,2 Q195,18 390,2 L390,14 Z" fill="#0d0d0d" /></svg>
      </div>
    </div>
  );
}

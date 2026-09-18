"use client";
export type CsModule = { id: string; slug: string; title: string; subtitle?: string | null; instructor_name?: string | null; taught_by?: string | null; level?: string | null; duration_label?: string | null; thumbnail_url?: string | null; lessons?: number | null; imgPos?: string | null };

/** logo per company: taught_by -> /cs-logo-<slug>.webp (Cars24 -> cs-logo-cars24.webp). */
const logoFor = (taughtBy?: string | null) => `/cs-logo-${String(taughtBy || "google").toLowerCase().replace(/[^a-z0-9]/g, "")}.webp`;

/** One module card — 3D glass, spotlight glow, green meta icons. First card has a
 *  downward-C (⌣) curved top and straddles the band seam. */
export function CsModuleCard({ m, straddle, onStart }: { m: CsModule; straddle?: boolean; onStart: () => void }) {
  const company = (m.taught_by || "GOOGLE").trim();
  const meta = [[m.level || "Beginner Level"], [m.duration_label || `${m.lessons ?? ""} lessons`.trim()], ["Popular"]].map((x) => x[0]).filter(Boolean) as string[];
  const icons = ["👤", "⏱", "👁"];
  const shift = straddle ? { transform: "translateY(-10%)" } as const : undefined;
  return (
    <div
      className={["relative mx-auto mb-5 grid max-w-[1170px] items-center gap-7 overflow-hidden rounded-[24px] border border-white/30 sm:grid-cols-[180px_1fr_1fr]",
        straddle ? "-mt-[100px] px-7 pb-[16px] pt-[72px] [clip-path:url(#csCardCurveTop)]" : "p-7"].join(" ")}
      style={{ background: "radial-gradient(140% 120% at 15% 10%,#0e0e12 0%,#070709 50%,#010102 100%)", boxShadow: "0 30px 70px -30px rgba(0,0,0,0.9), inset 0 1px 0 rgba(255,255,255,0.22), inset 0 0 60px rgba(255,255,255,0.04), inset 0 -1px 0 rgba(0,0,0,0.55)" }}>
      {/* glass sheen */}
      <div aria-hidden className="pointer-events-none absolute inset-0 rounded-[24px]" style={{ background: "linear-gradient(120deg,rgba(255,255,255,0.10) 0%,transparent 24%,transparent 72%,rgba(255,255,255,0.07) 100%)" }} />
      {/* clip-path def (once, on the first card) */}
      {straddle && <svg className="absolute h-0 w-0"><defs><clipPath id="csCardCurveTop" clipPathUnits="objectBoundingBox"><path d="M0,0 Q0.5,0.16 1,0 L1,1 L0,1 Z" /></clipPath></defs></svg>}

      {/* instructor */}
      <div className="relative z-[2] mx-auto h-[165px] w-[165px]" style={shift}>
        <div className="absolute inset-0 rounded-full border-[1.5px] border-[rgba(255,160,40,0.6)]" />
        <div className="absolute inset-[11px] overflow-hidden rounded-full" style={{ background: "linear-gradient(160deg,#FFB41F,#FD5300)" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {m.thumbnail_url ? <img src={m.thumbnail_url} alt={m.instructor_name || ""} className="absolute inset-0 h-full w-full object-cover" style={{ objectPosition: m.imgPos || "50% 50%" }} /> : null}
        </div>
        <div className="absolute right-[-4px] top-[34%] z-10 grid h-[34px] w-[34px] place-items-center overflow-hidden rounded-full bg-white shadow-md">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logoFor(m.taught_by)} alt="" className="h-[62%] w-[62%] object-contain" />
        </div>
        <span className="absolute right-[3px] top-[60%] z-10 text-lg text-[#FFB41F]">★</span>
      </div>

      {/* taught by — with circular spotlight glow behind the whole block */}
      <div className="relative z-[2] text-center" style={shift}>
        <div aria-hidden className="pointer-events-none absolute left-1/2 top-[52%] -z-[1] h-[300px] w-[300px] -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ background: "radial-gradient(closest-side,rgba(255,255,255,0.22),rgba(255,255,255,0.08) 45%,transparent 72%)", filter: "blur(14px)" }} />
        <div className="flex items-center justify-center gap-2.5 text-[12px] font-medium tracking-[4px] text-[#c9c9c9]"><span className="h-px w-11 bg-[linear-gradient(90deg,transparent,#00cfe5)]" />TAUGHT BY<span className="h-px w-11 bg-[linear-gradient(90deg,#00cfe5,transparent)]" /></div>
        <div className="relative mt-1.5"><div className="relative font-[family-name:var(--font-inter)] text-[40px] font-extrabold uppercase tracking-[3px] text-white" style={{ textShadow: "0 2px 10px rgba(255,255,255,0.25)" }}>{company}</div></div>
        <div className="-mt-1 font-[family-name:var(--font-playfair)] text-[32px] font-semibold italic" style={{ backgroundImage: "linear-gradient(120deg,#FFB41F,#FD5300)", WebkitBackgroundClip: "text", backgroundClip: "text", WebkitTextFillColor: "transparent", color: "transparent" }}>Instructor</div>
      </div>

      {/* details — green meta icons */}
      <div className="relative z-[2]" style={shift}>
        <h3 className="font-[family-name:var(--font-inter)] text-[23px] font-bold tracking-tight text-white">{m.title}</h3>
        <div className="mt-3 grid grid-cols-2 gap-x-9 gap-y-2.5 text-[14px] text-white/80">
          {meta.map((p, i) => <span key={p}><span className="text-[#5ce38a]">{icons[i]}</span> {p}</span>)}
          <span />
          <span className="col-span-2"><span className="text-[#5ce38a]">⭐</span> {m.subtitle || "Learn coding basics, logic and problem-solving"}</span>
        </div>
        <button onClick={onStart} className="mt-4.5 mt-5 inline-flex h-11 items-center justify-center rounded-[22px] px-16 font-[family-name:var(--font-inter)] text-[15px] font-bold text-white transition-transform hover:-translate-y-0.5" style={{ background: "linear-gradient(95deg,rgba(253,83,0,0.82),rgba(255,180,31,0.82))", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)", border: "1px solid rgba(255,190,90,0.55)" }}>Start Free</button>
      </div>
    </div>
  );
}

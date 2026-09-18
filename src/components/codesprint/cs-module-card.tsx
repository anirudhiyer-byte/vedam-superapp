"use client";
export type CsModule = { id: string; slug: string; title: string; instructor_name?: string | null; taught_by?: string | null; level?: string | null; duration_label?: string | null; thumbnail_url?: string | null; points_per_lesson?: number | null };

const META_LOGO: Record<string, string> = { google: "/cs-logo-google.webp", microsoft: "/cs-logo-microsoft.webp", amazon: "/cs-logo-amazon.webp", meta: "/cs-logo-meta.webp" };

/** One module card — instructor circle · TAUGHT BY <company> Instructor · details · Start Free. */
export function CsModuleCard({ m, straddle, onStart }: { m: CsModule; straddle?: boolean; onStart: () => void }) {
  const company = (m.taught_by || "GOOGLE").trim();
  const logo = META_LOGO[company.toLowerCase()] || "/cs-logo-google.webp";
  const points = [m.level && `👤 ${m.level}`, m.duration_label && `⏱ ${m.duration_label}`, "👁 Popular"].filter(Boolean) as string[];
  return (
    <div className={["mx-auto mb-6 grid max-w-[1560px] items-center gap-9 rounded-[28px] border border-white/[0.07] p-8 shadow-[0_30px_70px_-30px_rgba(0,0,0,0.7)] sm:grid-cols-[240px_1fr_1fr]",
      straddle ? "-mt-[150px]" : ""].join(" ")} style={{ background: "radial-gradient(120% 160% at 12% 40%,#1a1a1a,#0a0a0a 60%)" }}>
      {/* instructor */}
      <div className="relative mx-auto h-[220px] w-[220px]">
        <div className="absolute inset-0 rounded-full border-[1.5px] border-[rgba(255,160,40,0.6)]" />
        <div className="absolute inset-3.5 grid place-items-end overflow-hidden rounded-full bg-white">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {m.thumbnail_url ? <img src={m.thumbnail_url} alt={m.instructor_name || ""} className="h-[96%] w-[88%] object-cover object-bottom" /> : <div className="h-[96%] w-[88%] bg-gradient-to-b from-neutral-300 to-neutral-400" />}
        </div>
        <div className="absolute right-5 top-[44%] grid h-12 w-12 place-items-center overflow-hidden rounded-full bg-white shadow">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logo} alt="" className="h-[62%] w-[62%] object-contain" />
        </div>
        <span className="absolute bottom-8 right-9 text-2xl text-[#FFB41F]">★</span>
      </div>
      {/* taught by */}
      <div className="text-center">
        <div className="flex items-center justify-center gap-3 text-[14px] font-medium tracking-[4px] text-[#c9c9c9]"><span className="h-px w-14 bg-[linear-gradient(90deg,transparent,#00cfe5)]" />TAUGHT BY<span className="h-px w-14 bg-[linear-gradient(90deg,#00cfe5,transparent)]" /></div>
        <div className="mt-2 font-[family-name:var(--font-inter)] text-[48px] font-extrabold uppercase tracking-[3px] text-white">{company}</div>
        <div className="-mt-1 font-[family-name:var(--font-playfair)] text-[38px] font-semibold italic" style={{ backgroundImage: "linear-gradient(120deg,#FFB41F,#FD5300)", WebkitBackgroundClip: "text", backgroundClip: "text", WebkitTextFillColor: "transparent", color: "transparent" }}>Instructor</div>
      </div>
      {/* details */}
      <div>
        <h3 className="font-[family-name:var(--font-inter)] text-[28px] font-bold tracking-tight text-white">{m.title}</h3>
        <div className="mt-3.5 grid grid-cols-2 gap-x-10 gap-y-2.5 text-[15px] text-white/80">
          {points.map((p) => <span key={p}>{p}</span>)}
          <span className="col-span-2">⭐ Learn coding basics, logic and problem-solving</span>
        </div>
        <button onClick={onStart} className="mt-5 inline-flex h-12 items-center justify-center rounded-3xl px-20 font-[family-name:var(--font-inter)] text-[16px] font-bold text-white transition-transform hover:-translate-y-0.5" style={{ background: "linear-gradient(95deg,#FD5300,#FFB41F)", boxShadow: "0 8px 20px -6px rgba(253,120,3,0.5)" }}>Start Free</button>
      </div>
    </div>
  );
}

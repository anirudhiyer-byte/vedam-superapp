"use client";

/** Each testimonial is a full card IMAGE in /public: T1.webp … T9.webp.
 *  The orange "Trusted by 25k+" card uses testimonial-group.webp for the 3 students. */
const CARDS = ["/T1.webp", "/T2.webp", "/T3.webp", "/T4.webp", "/T5.webp", "/T6.webp", "/T7.webp", "/T8.webp", "/T9.webp"];

const CSS = `
@keyframes cs-marquee { from { transform: translateX(0); } to { transform: translateX(-50%); } }
.cs-marquee-track { display:flex; gap:20px; width:max-content; animation: cs-marquee 55s linear infinite; }
.cs-marquee-wrap:hover .cs-marquee-track { animation-play-state: paused; }`;

export function CsTestimonials() {
  const loop = [...CARDS, ...CARDS]; // duplicated for a seamless endless loop
  return (
    <section className="bg-[#0d0d0d] px-6 pb-24 sm:px-10 lg:px-[90px]">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="relative overflow-hidden rounded-[36px] border border-white/10 bg-[#0f0f0f] p-6 sm:p-8">
        <div className="cs-marquee-wrap relative overflow-hidden" style={{ paddingLeft: "340px" }}>
          {/* endless-loop track of card images */}
          <div className="cs-marquee-track">
            {loop.map((src, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={i} src={src} alt="" className="h-[320px] w-auto flex-none rounded-[18px] object-contain" />
            ))}
          </div>
          {/* left fade so cards disappear cleanly before the orange card */}
          <div aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-[360px]" style={{ background: "linear-gradient(90deg,#0f0f0f 60%,transparent)" }} />
          {/* fixed ORANGE "Trusted by 25k+" card */}
          <div className="absolute left-0 top-0 flex h-full w-[300px] flex-col justify-end rounded-[22px] p-6" style={{ background: "linear-gradient(155deg,#FFB41F,#FD5300)" }}>
            <div className="font-[family-name:var(--font-inter)] text-white" style={{ fontSize: "clamp(24px,2.4vw,34px)", fontWeight: 500 }}>Trusted by <b className="font-extrabold">25k+</b></div>
            <div className="mt-3 flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/testimonial-group.webp" alt="" className="h-9 w-auto" />
              <span className="font-[family-name:var(--font-inter)] text-[15px] font-medium text-white">Students</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

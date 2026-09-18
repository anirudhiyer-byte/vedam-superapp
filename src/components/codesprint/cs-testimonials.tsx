"use client";

/** Each testimonial is a full card IMAGE in /public: T1.webp … T9.webp.
 *  The orange "Trusted by 25k+" card uses testimonial-group.webp for the 3 students. */
const CARDS = ["/T1.webp", "/T2.webp", "/T3.webp", "/T4.webp", "/T5.webp", "/T6.webp", "/T7.webp", "/T8.webp", "/T9.webp"];

const CSS = `
@keyframes cs-marquee { from { transform: translateX(0); } to { transform: translateX(-50%); } }
.cs-marquee-track { display:flex; gap:20px; width:max-content; animation: cs-marquee 55s linear infinite; }
.cs-marquee-wrap:hover .cs-marquee-track { animation-play-state: paused; }
.cs-testi-box{ position:relative; border-radius:36px; background:#0f0f0f; }
.cs-testi-box::before{ content:""; position:absolute; inset:0; border-radius:36px; padding:1px;
  background:linear-gradient(120deg,rgba(255,180,31,.95),rgba(253,83,0,.35) 32%,rgba(255,205,130,.7) 58%,rgba(255,180,31,.95));
  -webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0); -webkit-mask-composite:xor; mask-composite:exclude; pointer-events:none; z-index:6; }
.cs-testi-box::after{ content:""; position:absolute; inset:0; border-radius:36px; pointer-events:none; z-index:5;
  background:linear-gradient(120deg,rgba(255,255,255,.06) 0%,transparent 26%,transparent 74%,rgba(255,255,255,.045) 100%); }`;

export function CsTestimonials() {
  const loop = [...CARDS, ...CARDS]; // duplicated for a seamless endless loop
  return (
    <section className="relative overflow-hidden bg-[#0d0d0d] px-6 pb-24 sm:px-10 lg:px-[90px]">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      {/* orange spotlight behind the box — left side, half-cut by the edge */}
      <div aria-hidden className="pointer-events-none absolute left-[-280px] top-1/2 z-0 -translate-y-1/2" style={{ width: "580px", height: "580px", borderRadius: "50%", background: "radial-gradient(closest-side,rgba(253,120,3,0.28),transparent 72%)" }} />
      <div className="cs-testi-box relative z-10 overflow-hidden p-6 sm:p-8">
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
          <div className="absolute left-0 top-0 flex h-full w-[300px] flex-col items-center justify-center rounded-[22px] p-6 text-center" style={{ background: "linear-gradient(155deg,#FFB41F,#FD5300)" }}>
            <div className="font-[family-name:var(--font-inter)] font-medium text-white" style={{ fontSize: "clamp(20px,2vw,28px)" }}>Trusted by</div>
            <div className="font-[family-name:var(--font-inter)] font-medium text-white" style={{ fontSize: "clamp(22px,2.3vw,32px)" }}><b className="font-extrabold">25K+</b> Students</div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/testimonial-group.webp" alt="" className="mt-4 h-10 w-auto" />
          </div>
        </div>
      </div>
    </section>
  );
}

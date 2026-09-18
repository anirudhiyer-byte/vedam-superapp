"use client";
import { forwardRef } from "react";

/** CodeSprint hero — faithful to the reference (v5). Static orbit. Port-responsive.
 *  Assets (drop in /public): cs-polka.webp, cs-expert-1/2/3.webp, and the logo webps below. */
const ORANGE = "linear-gradient(124deg,#FFB41F 2%,#FD5300 86%)";
const ORANGE2 = "linear-gradient(107deg,#FFB41F 2%,#FD5300 86%)";

const LOGOS: { f: string; x: number; y: number; s: number }[] = [
  { f: "/cs-logo-amazon.webp", x: 17, y: 267, s: 82 }, { f: "/cs-logo-google.webp", x: 471, y: 76, s: 82 },
  { f: "/cs-logo-cars24.webp", x: 562, y: 481, s: 82 }, { f: "/cs-logo-microsoft.webp", x: 748, y: 256, s: 82 },
  { f: "/cs-logo-atlassian.webp", x: 170, y: 407, s: 55 }, { f: "/cs-logo-apple.webp", x: 275, y: 36, s: 55 },
  { f: "/cs-logo-oracle.webp", x: 770, y: 462, s: 55 },
];
const EXPERTS = [{ f: "/cs-expert-1.webp", x: 74, y: 82 }, { f: "/cs-expert-2.webp", x: 662, y: 23 }, { f: "/cs-expert-3.webp", x: 295, y: 441 }];
const PLUS = [{ x: 484, y: 562 }, { x: 227, y: 45 }, { x: 703, y: 210 }, { x: 735, y: 452 }, { x: 122, y: 402 }, { x: 444, y: 36 }, { x: 354, y: 146, c: "#666" }];
const BADGES = ["Beginner Friendly", "Certificate on Completion", "No prior experience required"];

const BTN_CSS = `
.cs-start{position:relative;height:50px;display:inline-flex;align-items:center;padding:0 30px;border-radius:14px;
  background:linear-gradient(180deg,rgba(24,16,7,.62),rgba(6,4,2,.72));backdrop-filter:blur(9px);-webkit-backdrop-filter:blur(9px);
  box-shadow:inset 0 1px 0 rgba(255,200,140,.22), inset 0 0 18px rgba(253,120,3,.10);overflow:hidden;transition:box-shadow .28s,background .28s}
.cs-start::before{content:"";position:absolute;inset:0;border-radius:14px;padding:1px;background:linear-gradient(120deg,rgba(255,180,31,1),rgba(253,83,0,.7) 50%,rgba(255,160,70,.85));
  -webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude;pointer-events:none}
.cs-start::after{content:"";position:absolute;top:0;left:-70%;width:40%;height:100%;background:linear-gradient(100deg,transparent,rgba(255,210,150,.30),transparent);transform:skewX(-18deg);transition:left .6s;pointer-events:none}
.cs-start:hover{background:linear-gradient(180deg,rgba(253,120,3,.32),rgba(253,83,0,.20));box-shadow:inset 0 1px 0 rgba(255,220,170,.4), inset 0 0 26px rgba(253,120,3,.35)}
.cs-start:hover::after{left:130%}`;

export const CsHero = forwardRef<HTMLDivElement, { onStartNow?: () => void }>(function CsHero({ onStartNow }, ref) {
  return (
    <section ref={ref} className="relative overflow-hidden bg-[#0d0d0d]">
      <style dangerouslySetInnerHTML={{ __html: BTN_CSS }} />
      {/* polka texture — more visible (opacity ~0.28), spans the hero */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/cs-polka.webp" alt="" aria-hidden className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-[0.28]" />

      <div className="relative z-10 mx-auto grid max-w-[1920px] items-center gap-10 px-6 py-16 sm:px-10 lg:grid-cols-[minmax(0,600px)_1fr] lg:gap-6 lg:px-[146px] lg:py-20">
        {/* LEFT — copy */}
        <div>
          <p className="font-[family-name:var(--font-inter)] text-[15px] font-extralight tracking-wide text-white/90 sm:text-[16px]">START SMART, START EARLY</p>
          <h1 className="mt-2.5 inline-block font-[family-name:var(--font-inter)] leading-[1.06] tracking-[-2.3px]" style={{ fontSize: "clamp(33px,4.2vw,60px)" }}>
            <span className="font-semibold" style={{ backgroundImage: ORANGE, WebkitBackgroundClip: "text", backgroundClip: "text", WebkitTextFillColor: "transparent", color: "transparent" }}>Sprint into<br />College with a<br /></span>
            <span className="font-[family-name:var(--font-playfair)] font-semibold italic" style={{ backgroundImage: ORANGE, WebkitBackgroundClip: "text", backgroundClip: "text", WebkitTextFillColor: "transparent", color: "transparent" }}>Clear advantage</span>
          </h1>
          <p className="mt-[34px] max-w-[520px] font-[family-name:var(--font-inter)] font-light leading-[1.4] text-white" style={{ fontSize: "clamp(15px,1.65vw,22px)", letterSpacing: "-0.9px" }}>A free program for Class 12 students<br />aspiring to pursue B.Tech in CS.</p>
          <button onClick={onStartNow} className="cs-start mt-6">
            <span className="font-[family-name:var(--font-inter)] text-[20px] font-medium tracking-[-1px]" style={{ backgroundImage: "linear-gradient(92deg,#FD5300 0.4%,#FFB41F 74%)", WebkitBackgroundClip: "text", backgroundClip: "text", WebkitTextFillColor: "transparent", color: "transparent" }}>Start Now</span>
          </button>
          <div className="mt-7 flex flex-wrap gap-2.5 sm:flex-nowrap">
            {BADGES.map((b) => (
              <span key={b} className="inline-flex flex-none items-center gap-1.5 rounded-[8px] px-2.5 py-1" style={{ background: "linear-gradient(-32deg,rgba(52,199,89,0.9) 1%,rgba(30,30,30,0) 42%)" }}>
                <span className="grid h-3.5 w-3.5 place-items-center rounded-full bg-[#34c759] text-[9px] font-bold text-white">✓</span>
                <span className="whitespace-nowrap font-[family-name:var(--font-inter)] text-[13px] font-normal text-white">{b}</span>
              </span>
            ))}
          </div>
        </div>

        {/* RIGHT — Tech Experts orbit (static), nudged down to clear the header */}
        <div className="relative mx-auto mt-10 w-full max-w-[940px] lg:mt-10">
          <div className="relative mx-auto aspect-[873/600] w-full" style={{ containerType: "inline-size" }}>
            <Orbit />
          </div>
        </div>
      </div>
    </section>
  );
});

function Orbit() {
  const W = 873, H = 600;
  const pct = (v: number, tot: number) => `${(v / tot) * 100}%`;
  const ring = (l: number, t: number, w: number, h: number, color: string, bg?: string) => (
    <div className="absolute" style={{ left: pct(l, W), top: pct(t, H), width: pct(w, W), height: pct(h, H), border: `1.1px solid ${color}`, borderRadius: 9999, opacity: 0.4, background: bg }} />
  );
  return (
    <div className="absolute inset-0">
      {ring(0, 0, W, H, "#fd5300")}{ring(72, 76, 728, 448, "#ffb41f")}
      {ring(154, 165, 565, 270, "#ffb41f", "rgba(0,0,0,0.25)")}{ring(234, 221, 405, 158, "#ffb41f")}
      <div className="absolute -translate-x-1/2 -translate-y-1/2 text-center" style={{ left: "48%", top: "50%" }}>
        <span className="font-[family-name:var(--font-inter)] font-normal text-white" style={{ fontSize: "clamp(11px,1.55cqw,17px)", textShadow: "2px 2px 6px rgba(255,255,255,0.35)" }}>Tech Experts</span>
      </div>
      {PLUS.map((p, i) => <span key={i} className="absolute -translate-x-1/2 -translate-y-1/2 opacity-40" style={{ left: pct(p.x, W), top: pct(p.y, H), color: p.c || "#fff", fontSize: "clamp(16px,2.8cqw,28px)" }}>+</span>)}
      {EXPERTS.map((e, i) => (
        <div key={i} className="absolute overflow-hidden rounded-full" style={{ left: pct(e.x, W), top: pct(e.y, H), width: pct(152, W), aspectRatio: "1", background: ORANGE2 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={e.f} alt="" className="absolute inset-0 h-full w-full object-cover object-bottom" />
        </div>
      ))}
      {LOGOS.map((l, i) => (
        <div key={i} className="absolute grid place-items-center overflow-hidden rounded-full bg-white" style={{ left: pct(l.x, W), top: pct(l.y, H), width: pct(l.s, W), aspectRatio: "1" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={l.f} alt="" className="h-[62%] w-[62%] object-contain" />
        </div>
      ))}
    </div>
  );
}

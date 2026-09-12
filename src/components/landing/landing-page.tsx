"use client";
import Image from "next/image";
import Link from "next/link";

const NAV = [
  { label: "Home", href: "/" },
  { label: "Bootcamps", href: "/events" },
  { label: "Codesprint", href: "/codesprint" },
  { label: "College Predictor", href: "/predict" },
];
const LOGOS = ["google", "microsoft", "meta", "cars24", "atlassian", "oracle"];
const CARDS = [
  { key: "bootcamps", title: "Bootcamps", href: "/events", live: true, glow: "232,0,116", desc: "Build real world projects with AI and attend live sessions before college even starts", ill: "ill-bootcamps.webp" },
  { key: "codesprint", title: "Codesprint", href: "/codesprint", soon: true, desc: "Learn Coding from basics by Top engineers before college even starts", ill: "ill-codesprint.webp" },
  { key: "predict", title: "College Predictor", href: "/predict", soon: true, desc: "Explore the best colleges you can get based on your JEE rank or marks", ill: "ill-college-predictor.webp" },
  { key: "vedamxp", title: "Vedam Xp", href: "/vedam-xp", live: true, glow: "138,24,255", desc: "Learn, Compete and Earn", ill: "ill-vedam-xp.webp" },
];

export function LandingPage() {
  const scrollToExplore = () => document.getElementById("explore")?.scrollIntoView({ behavior: "smooth" });

  return (
    <div className="landing font-[family-name:var(--font-inter)] text-white">
      <style>{`
        .landing{background:#0b0318}
        @keyframes ld-spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}
        @keyframes ld-spinrev{from{transform:rotate(0)}to{transform:rotate(-360deg)}}
        @keyframes ld-scroll{from{transform:translateX(0)}to{transform:translateX(-50%)}}
        @keyframes ld-blink{0%,100%{opacity:1}50%{opacity:.25}}
        .ld-orbit{animation:ld-spin 46s linear infinite}
        .ld-orbit .m .in{animation:ld-spinrev 46s linear infinite}
        .ld-track{animation:ld-scroll 20s linear infinite}
        .ld-blink{animation:ld-blink 1.2s ease-in-out infinite}
        @keyframes ld-shine{0%{left:-80%}100%{left:180%}}
        .group:hover .ld-shine{animation:ld-shine 0.75s cubic-bezier(.2,.8,.2,1)}
        @keyframes ld-silver{0%{background-position:200% 0}100%{background-position:-80% 0}}100%{background-position:-60% 0}}100%{background-position:-150% 0}}100%{background-position:200% 200%}}
        .ld-silver{background:linear-gradient(100deg,#8f93a3 0%,#c9cdd9 30%,#ffffff 44%,#ffffff 50%,#ffffff 56%,#c9cdd9 70%,#8f93a3 100%);background-size:280% 100%;-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:transparent;filter:drop-shadow(0 1px 3px rgba(255,255,255,0.25)) drop-shadow(0 2px 2px rgba(0,0,0,0.3));animation:ld-silver 3.2s ease-in-out infinite}
        @media (prefers-reduced-motion: reduce){.ld-silver{animation:none}}
        @media (prefers-reduced-motion: reduce){.ld-orbit,.ld-orbit .m .in,.ld-track,.ld-blink{animation:none}}
      `}</style>

      {/* ===== HERO ===== */}
      <section className="relative overflow-hidden" style={{ background: "radial-gradient(120% 100% at 80% 35%, #331660 0%, #1a0b38 45%, #0b0318 100%)" }}>
        {/* texture */}
        <div className="pointer-events-none absolute inset-0 z-[1] opacity-[0.28] sm:opacity-[0.16]" style={{ backgroundImage: "radial-gradient(rgba(205,165,255,0.6) 1.3px, transparent 1.6px)", backgroundSize: "24px 24px" }} />
        <div className="pointer-events-none absolute right-16 top-24 z-[1] h-[700px] w-[820px] rounded-full opacity-70 blur-[40px]" style={{ background: "radial-gradient(closest-side, rgba(150,40,220,.45), transparent 70%)" }} />
        <div className="pointer-events-none absolute inset-x-0 top-0 z-[10] h-36" style={{ background: "linear-gradient(to bottom, #000 20%, rgba(0,0,0,0.6) 55%, transparent)" }} />

        {/* HERO BODY */}
        {/* image layer — absolute to the full-width section so it's flush to the viewport edge (no gap) */}
        <div className="pointer-events-none absolute inset-y-0 right-0 z-[2] hidden w-[60%] lg:block">
          <Image src="/landing/purple-glow.webp" alt="" width={1000} height={1000} className="pointer-events-none absolute left-1/2 top-1/2 z-0 w-[92%] max-w-none -translate-x-1/2 -translate-y-1/2" />
          <div className="ld-orbit absolute left-[46%] top-[56%] z-[1] h-0 w-0">
            {[0, 90, 180, 270].map((deg, i) => (
              <div key={i} className="m absolute left-0 top-0 -m-14 h-28 w-28" style={{ transform: `rotate(${deg}deg) translateY(-270px)` }}>
                <div className="in grid h-full w-full place-items-center"><Image src={`/landing/motion-${i + 1}.webp`} alt="" width={112} height={112} className="h-full w-full object-contain" style={i === 2 ? { transform: "rotate(180deg)" } : undefined} /></div>
              </div>
            ))}
          </div>
          <Image src="/landing/hero-students.webp" alt="Vedam students" width={1100} height={800} priority className="absolute bottom-0 right-0 z-[2] h-auto w-[98%] max-w-none" />
        </div>

        {/* copy — constrained to the left so it never sits under the image */}
        <div className="relative z-20 mx-auto max-w-[1800px] px-6 sm:px-10">
          <div className="mx-auto max-w-[560px] pb-0 pt-8 text-center sm:pl-16 lg:mx-0 lg:max-w-[48%] lg:pb-[150px] lg:pt-[80px] lg:text-left">
            <div className="inline-block text-left lg:block">
            <h1 className="ld-silver font-[family-name:var(--font-inter)] font-normal uppercase leading-[0.8] tracking-[-0.05em]" style={{ fontSize: "clamp(52px,6.5vw,108px)" }}>Vedam</h1>
            <div className="mt-1.5 flex items-center justify-start gap-2.5">
              <span className="ld-silver font-[family-name:var(--font-playfair)] italic tracking-tight" style={{ fontSize: "clamp(22px,4.2vw,68px)", fontWeight: 600, lineHeight: 1.15, display: "inline-block", paddingRight: "0.08em", marginTop: "-0.12em" }}>One</span>
              <span className="h-[26px] w-0.5 bg-white/60 sm:h-[46px]" />
              <span className="whitespace-nowrap font-semibold leading-[1.05]" style={{ fontSize: "clamp(12px,1.9vw,26px)" }}>The Home of<small className="mt-0.5 block font-medium tracking-[0.5px] text-white" style={{ fontSize: "clamp(11px,1.4vw,19px)" }}>Future Engineers</small></span>
            </div>
            </div>
            <div className="mt-8">
              <span className="block font-medium tracking-tight text-[#7a7a7a]" style={{ fontSize: "clamp(12px,1.45vw,22px)" }}>Learn, Code, Build and Compete.</span>
              <span className="mt-2 block italic font-light tracking-tight text-white" style={{ fontSize: "clamp(11px,1.45vw,22px)" }}>Specially designed for class 12th students</span>
            </div>
            <div className="mt-10">
              <button onClick={scrollToExplore} className="group relative inline-flex rounded-full p-[1.5px] transition-all hover:shadow-[0_0_28px_rgba(255,47,176,0.75),0_0_56px_rgba(47,155,255,0.6)] active:scale-[0.98]" style={{ background: "linear-gradient(100deg,#ff2fb0 0%,#c04bff 46%,#5b6bff 60%,#2f9bff 100%)", boxShadow: "0 0 22px rgba(255,47,176,.55),0 0 44px rgba(91,107,255,.45)" }}>
                <span className="relative inline-flex items-center overflow-hidden rounded-full px-5 py-2.5 font-medium tracking-tight text-white backdrop-blur-xl" style={{ fontSize: "clamp(12px,1.05vw,15px)", background: "linear-gradient(180deg,#2b135c,#1a0b38)", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.20)" }}>
                  <span className="relative z-10 leading-none">Start Building</span>
                  <span aria-hidden className="ld-shine pointer-events-none absolute inset-y-0 -left-full z-[5] w-1/2 -skew-x-12" style={{ background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.45), transparent)" }} />
                </span>
              </button>
            </div>
            <div className="mt-6 font-normal tracking-[3px] text-transparent bg-clip-text" style={{ fontSize: "clamp(12px,0.95vw,16px)", backgroundImage: "linear-gradient(96deg,#35e8fb 0%,#7b5cff 55%,#c200db 100%)" }}>LEARN · BUILD · CONNECT · RISE</div>
          </div>
          {/* mobile image — below the copy, no overlap */}
          <div className="relative mt-4 -mx-6 lg:hidden">
            <Image src="/landing/purple-glow.webp" alt="" width={800} height={800} className="pointer-events-none absolute left-1/2 top-1/2 z-0 w-[115%] max-w-none -translate-x-1/2 -translate-y-1/2" />
            {/* mobile orbit — smaller, behind the students */}
            <div className="ld-orbit pointer-events-none absolute left-1/2 top-[42%] z-[1] h-0 w-0">
              {[0, 90, 180, 270].map((deg, i) => (
                <div key={i} className="m absolute left-0 top-0 -m-8 h-16 w-16" style={{ transform: `rotate(${deg}deg) translateY(-138px)` }}>
                  <div className="in grid h-full w-full place-items-center"><Image src={`/landing/motion-${i + 1}.webp`} alt="" width={64} height={64} className="h-full w-full object-contain" style={i === 2 ? { transform: "rotate(180deg)" } : undefined} /></div>
                </div>
              ))}
            </div>
            <Image src="/landing/hero-students.webp" alt="Vedam students" width={1100} height={800} className="relative z-[2] block h-auto w-full" />
          </div>
        </div>

        {/* MARQUEE — translucent band with glow + border, image shows through, bigger logos */}
        <div className="relative z-[25] -mt-4 flex h-[40px] items-center overflow-hidden border-y border-white/25 backdrop-blur-md sm:h-[52px] lg:-mt-[46px]" style={{ background: "rgba(255,255,255,.07)", boxShadow: "0 0 55px rgba(138,24,255,.32) inset" }}>
          <div className="z-[4] flex h-full flex-shrink-0 flex-col justify-center px-4 leading-[1.05] sm:flex-row sm:items-center sm:gap-1.5 sm:whitespace-nowrap sm:px-12" style={{ background: "linear-gradient(to right,#0b0318 74%,rgba(11,3,24,.9) 88%,transparent)", fontSize: "clamp(12px,2vw,26px)" }}><span>Learn From</span> <span className="font-[family-name:var(--font-playfair)] italic">Mentors</span></div>
          <div className="pointer-events-none absolute right-0 top-0 z-[2] h-full w-[200px]" style={{ background: "linear-gradient(to left,#0b0318 15%,transparent)" }} />
          <div className="ld-track flex items-center">
            {[...LOGOS, ...LOGOS].map((l, i) => (
              <div key={i} className="flex w-[104px] shrink-0 items-center justify-center sm:w-[150px]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/landing/logo-${l}.webp`} alt={l} className="max-h-4 w-auto max-w-[76px] object-contain sm:max-h-5 sm:max-w-[112px]" />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== EXPLORE ===== */}
      <section id="explore" className="px-6 py-8 sm:px-16 sm:pb-20 sm:pt-8" style={{ background: "#0b0318" }}>
        <div className="mx-auto max-w-[1800px] rounded-[20px] border border-[#7a7a7a] bg-[#171717] p-5 sm:rounded-[30px] sm:p-11" >
          <h2 className="whitespace-nowrap font-medium tracking-tight" style={{ fontSize: "clamp(24px,4.1vw,55px)" }}><span className="ld-silver">Explore Vedam </span><span className="ld-silver font-[family-name:var(--font-playfair)] italic">One</span></h2>
          <p className="mt-6 max-w-[1360px] font-light leading-relaxed tracking-tight text-[#b5b5b5]" style={{ fontSize: "clamp(12px,1.4vw,23px)" }}>Start coding early, build real products with AI, compete in hackathons, join live tech sessions and learn from people working across MAANG and top tech companies.</p>
          <div className="mt-8 grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-4">
            {CARDS.map((c) => (
              <Link key={c.key} href={c.href} className="group relative block overflow-hidden rounded-[25px] border border-white/15 bg-white/[0.06] backdrop-blur-xl transition-all duration-300 hover:-translate-y-1.5"
                onMouseEnter={(e) => { if (c.live) e.currentTarget.style.boxShadow = `0 0 85px rgba(${c.glow},0.6)`; }}
                onMouseLeave={(e) => { e.currentTarget.style.boxShadow = ""; }}>
                <Image src={`/landing/${c.ill}`} alt={c.title} width={440} height={500} className="h-auto w-full" />
                {c.live && <span aria-hidden className="pointer-events-none absolute inset-0 z-[3]" style={{ background: "linear-gradient(125deg, rgba(255,255,255,0.28) 0%, rgba(255,255,255,0.06) 18%, transparent 40%, transparent 66%, rgba(255,255,255,0.12) 100%)" }} />}
                {c.live && <span aria-hidden className="ld-shine pointer-events-none absolute inset-y-0 -left-full z-[4] w-2/3 -skew-x-[20deg]" style={{ background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.10) 30%, rgba(255,255,255,0.55) 50%, rgba(255,255,255,0.10) 70%, transparent)" }} />}
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ===== FOOTER ===== */}
      <footer className="flex flex-row flex-wrap gap-8 border-t border-white/10 px-6 py-12 sm:gap-32 sm:px-16 sm:py-14" style={{ background: "#0b0318" }}>
        <div><h4 className="mb-2.5 text-base font-semibold sm:text-xl">Quick Links</h4>
          <Link href="/privacy" className="block text-[15px] font-medium leading-[30px] text-white/80 hover:text-white">Privacy Policy</Link>
          <Link href="/terms" className="block text-[15px] font-medium leading-[30px] text-white/80 hover:text-white">Terms of Service</Link>
        </div>
        <div><h4 className="mb-2.5 text-base font-semibold sm:text-xl">Contact Us</h4>
          <a href="mailto:connect@vedam.org" className="block text-[15px] font-medium leading-[30px] text-white/80 hover:text-white">connect@vedam.org</a>
          <a href="tel:+919201010176" className="block text-[15px] font-medium leading-[30px] text-white/80 hover:text-white">+91 92010 10176</a>
        </div>
        <div><h4 className="mb-2.5 text-base font-semibold sm:text-xl">Follow Us</h4>
          <div className="mt-2 flex gap-3.5">
            {[["YouTube", "https://www.youtube.com/@vedamschooloftechnology", "M23 7.5a3 3 0 0 0-2.1-2.1C19 5 12 5 12 5s-7 0-8.9.4A3 3 0 0 0 1 7.5 31 31 0 0 0 .5 12 31 31 0 0 0 1 16.5a3 3 0 0 0 2.1 2.1C5 19 12 19 12 19s7 0 8.9-.4a3 3 0 0 0 2.1-2.1 31 31 0 0 0 .5-4.5 31 31 0 0 0-.5-4.5zM9.8 15.3V8.7l5.7 3.3z"], ["Instagram", "https://www.instagram.com/vedamschooloftechnology/", "M12 2.2c3.2 0 3.6 0 4.9.1 3.3.1 4.8 1.7 4.9 4.9.1 1.3.1 1.6.1 4.8s0 3.6-.1 4.8c-.1 3.2-1.6 4.8-4.9 4.9-1.3.1-1.6.1-4.9.1s-3.6 0-4.8-.1c-3.3-.1-4.8-1.7-4.9-4.9C2.2 15.6 2.2 15.2 2.2 12s0-3.6.1-4.8C2.4 3.9 4 2.4 7.2 2.3 8.4 2.2 8.8 2.2 12 2.2m0 3.3A6.5 6.5 0 1 0 18.5 12 6.5 6.5 0 0 0 12 5.5m0 10.7A4.2 4.2 0 1 1 16.2 12 4.2 4.2 0 0 1 12 16.2m6.8-11a1.5 1.5 0 1 0 1.5 1.5 1.5 1.5 0 0 0-1.5-1.5"], ["LinkedIn", "https://www.linkedin.com/school/vedam-school-of-technology/", "M4.98 3.5A2.5 2.5 0 1 0 5 8.5a2.5 2.5 0 0 0 0-5zM3 9h4v12H3zM9 9h3.8v1.7h.05c.53-1 1.8-2 3.7-2 4 0 4.7 2.6 4.7 6V21h-4v-5.3c0-1.3 0-3-1.8-3s-2.1 1.4-2.1 2.9V21H9z"], ["Telegram", "https://t.me/vedamschooloftechnology", "M21.9 4.3 2.8 11.6c-1 .4-1 1.4-.1 1.7l4.9 1.5 1.9 5.9c.2.6.5.7 1 .3l2.7-2.2 4.7 3.5c.6.4 1.2.2 1.4-.6l3.3-15.6c.2-1-.4-1.5-1.6-1z"]].map(([t, href, d]) => (
              <a key={t} title={t} href={href} target="_blank" rel="noreferrer" className="grid h-9 w-9 place-items-center rounded-[9px] bg-[#1e1e1e] transition-colors hover:bg-[#8A18FF]"><svg viewBox="0 0 24 24" fill="#fff" width="17" height="17"><path d={d} /></svg></a>
            ))}
          </div>
        </div>
      </footer>
    </div>
  );
}
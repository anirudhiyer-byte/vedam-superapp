"use client";
import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { createClient } from "@/lib/supabase/client";

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
  const [supabase] = useState(() => createClient());
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [name, setName] = useState("");
  const [points, setPoints] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        setAuthed(true);
        const { data: p } = await supabase.from("profiles").select("full_name").eq("id", session.user.id).maybeSingle();
        setName(p?.full_name || "You");
        const { data: pts } = await supabase.from("points_ledger").select("points").eq("user_id", session.user.id);
        setPoints((pts as { points: number }[] ?? []).reduce((a, r) => a + (r.points || 0), 0));
      }
    })();
    const onClick = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false); };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [supabase]);

  const isDark = theme !== "light";
  const initials = name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase() || "V";
  const scrollToExplore = () => document.getElementById("explore")?.scrollIntoView({ behavior: "smooth" });
  async function logout() { await supabase.auth.signOut(); setMenuOpen(false); router.refresh(); }

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
        .ld-track{animation:ld-scroll 34s linear infinite}
        .ld-blink{animation:ld-blink 1.2s ease-in-out infinite}
        @media (prefers-reduced-motion: reduce){.ld-orbit,.ld-orbit .m .in,.ld-track,.ld-blink{animation:none}}
      `}</style>

      {/* ===== HERO ===== */}
      <section className="relative overflow-hidden" style={{ background: "radial-gradient(120% 100% at 80% 35%, #331660 0%, #1a0b38 45%, #0b0318 100%)" }}>
        {/* texture */}
        <div className="pointer-events-none absolute inset-0 z-[1] opacity-[0.14]" style={{ backgroundImage: "url(/landing/polka-dots.webp)", backgroundSize: "300px" }} />
        <div className="pointer-events-none absolute right-16 top-24 z-[1] h-[700px] w-[820px] rounded-full opacity-70 blur-[40px]" style={{ background: "radial-gradient(closest-side, rgba(150,40,220,.45), transparent 70%)" }} />

        {/* HEADER */}
        <header className="relative z-30 mx-auto flex max-w-[1800px] items-center justify-between px-6 py-5 sm:px-10">
          <div className="flex items-center gap-2.5">
            <Image src="/landing/vedam-logo-dark.png" alt="Vedam" width={40} height={40} priority className="h-9 w-auto" />
            <span className="hidden leading-tight sm:block"><b className="block text-[22px] font-semibold tracking-tight">Vedam</b><small className="block text-[10px] tracking-wide text-white/60">School of Technology</small></span>
          </div>
          {/* desktop nav */}
          <nav className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-2 lg:flex">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className={["rounded-lg px-5 py-2 text-[15px] font-medium transition-colors", n.href === "/" ? "bg-[#7629fc] text-white" : "text-white/85 hover:bg-[#7629fc] hover:text-white"].join(" ")}>{n.label}</Link>
            ))}
          </nav>
          <div className="flex items-center gap-2.5">
            {authed ? (
              <>
                <span className="hidden items-center gap-2 rounded-full border border-white/15 bg-black/40 px-3.5 py-1.5 text-sm font-semibold sm:flex" title="Streak (coming soon)"><span className="grid h-6 w-6 place-items-center rounded-full" style={{ background: "linear-gradient(120deg,#8a4dff,#7629fc)" }}>🔥</span>100</span>
                <span className="flex items-center gap-2 rounded-full border border-white/15 bg-black/40 px-3.5 py-1.5 text-sm font-semibold"><span className="hidden sm:inline">Total</span><span className="grid h-6 w-6 place-items-center rounded-full" style={{ background: "linear-gradient(120deg,#8a4dff,#7629fc)" }}>⭐</span>{points}</span>
                <div ref={menuRef} className="relative">
                  <button onClick={() => setMenuOpen((o) => !o)} className="grid h-10 w-10 place-items-center rounded-full text-[15px] font-semibold" style={{ background: "linear-gradient(135deg,#9a4dff,#7629fc)" }}>{initials}</button>
                  {menuOpen && (
                    <div className="absolute right-0 top-12 z-50 w-52 overflow-hidden rounded-xl border border-white/10 bg-[#160a30] py-1.5 text-sm shadow-2xl">
                      <div className="px-4 py-2 text-white/60">{name}</div>
                      <Link href="/dashboard" className="block px-4 py-2 hover:bg-white/5">Dashboard</Link>
                      <Link href="/leaderboard" className="block px-4 py-2 hover:bg-white/5">Leaderboard</Link>
                      <button onClick={() => mounted && setTheme(isDark ? "light" : "dark")} className="flex w-full items-center justify-between px-4 py-2 hover:bg-white/5">🌙 Theme</button>
                      <button onClick={logout} className="block w-full px-4 py-2 text-left text-[#ff6a8e] hover:bg-white/5">↪ Log out</button>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <Link href="/login" className="rounded-lg bg-[#7629fc] px-5 py-2 text-[15px] font-medium">Sign in</Link>
            )}
            <button onClick={() => setNavOpen((o) => !o)} className="ml-1 grid h-10 w-10 place-items-center rounded-lg border border-white/15 lg:hidden">☰</button>
          </div>
        </header>
        {navOpen && (
          <div className="relative z-30 mx-6 mb-2 rounded-xl border border-white/10 bg-[#160a30] p-2 lg:hidden">
            {NAV.map((n) => <Link key={n.href} href={n.href} className="block rounded-lg px-4 py-2.5 font-medium hover:bg-white/5">{n.label}</Link>)}
          </div>
        )}

        {/* HERO BODY */}
        {/* image layer — absolute to the full-width section so it's flush to the viewport edge (no gap) */}
        <div className="pointer-events-none absolute inset-y-0 right-0 z-[2] hidden w-[54%] lg:block">
          <div className="ld-orbit absolute left-[46%] top-[52%] z-[1] h-0 w-0">
            {[0, 90, 180, 270].map((deg, i) => (
              <div key={i} className="m absolute left-0 top-0 -m-14 h-28 w-28" style={{ transform: `rotate(${deg}deg) translateY(-260px)` }}>
                <div className="in grid h-full w-full place-items-center"><Image src={`/landing/motion-${i + 1}.webp`} alt="" width={112} height={112} className="h-full w-full object-contain" /></div>
              </div>
            ))}
          </div>
          <Image src="/landing/hero-students.webp" alt="Vedam students" width={1100} height={800} priority className="absolute bottom-0 right-0 z-[2] h-auto w-full max-w-none" />
        </div>

        {/* copy — constrained to the left so it never sits under the image */}
        <div className="relative z-20 mx-auto max-w-[1800px] px-6 sm:px-10">
          <div className="max-w-[560px] pb-16 pt-10 sm:pl-16 lg:max-w-[48%] lg:pb-[150px] lg:pt-[80px]">
            <h1 className="font-[family-name:var(--font-inter)] font-normal uppercase leading-[0.8] tracking-[-0.05em]" style={{ fontSize: "clamp(45px,7.2vw,120px)" }}>Vedam</h1>
            <div className="mt-2 flex items-center gap-4">
              <span className="font-[family-name:var(--font-playfair)] italic leading-[0.78] tracking-tight" style={{ fontSize: "clamp(35px,5.2vw,83px)", fontWeight: 600 }}>One</span>
              <span className="h-[36px] w-0.5 bg-white/60 sm:h-[52px]" />
              <span className="font-semibold leading-[1.05]" style={{ fontSize: "clamp(14px,1.5vw,22px)" }}>The Home of<small className="mt-1 block font-medium tracking-[2.5px] text-white" style={{ fontSize: "clamp(10px,0.95vw,15px)" }}>FUTURE ENGINEERS</small></span>
            </div>
            <div className="mt-8">
              <span className="block font-medium tracking-tight text-[#7a7a7a]" style={{ fontSize: "clamp(18px,2.1vw,32px)" }}>Learn, Code, Build and Compete.</span>
              <span className="mt-2 block italic font-light tracking-tight text-white" style={{ fontSize: "clamp(16px,2.1vw,32px)" }}>Specially designed for class 12th students</span>
            </div>
            <div className="mt-10">
              <button onClick={scrollToExplore} className="inline-flex items-center rounded-full bg-white/[0.14] px-6 py-3.5 font-medium tracking-tight backdrop-blur transition-all hover:bg-[rgba(138,24,255,0.42)] hover:shadow-[0_0_34px_rgba(138,24,255,0.5)]" style={{ fontSize: "clamp(15px,1.3vw,19px)" }}>Start Building</button>
            </div>
            <div className="mt-6 font-normal tracking-[3px] text-transparent bg-clip-text" style={{ fontSize: "clamp(15px,1.2vw,20px)", backgroundImage: "linear-gradient(96deg,#35e8fb 0%,#7b5cff 55%,#c200db 100%)" }}>LEARN · BUILD · CONNECT · RISE</div>
          </div>
          {/* mobile image — below the copy, no overlap */}
          <div className="-mx-6 mt-4 lg:hidden">
            <Image src="/landing/hero-students.webp" alt="Vedam students" width={1100} height={800} className="h-auto w-full" />
          </div>
        </div>

        {/* MARQUEE — translucent band with glow + border, image shows through, bigger logos */}
        <div className="relative z-[25] mt-6 flex h-[92px] items-center overflow-hidden border-y border-white/15 backdrop-blur-[2px] lg:-mt-[46px]" style={{ background: "rgba(24,12,48,.28)", boxShadow: "0 0 60px rgba(138,24,255,.25) inset" }}>
          <div className="z-[4] flex h-full flex-shrink-0 items-center gap-1.5 whitespace-nowrap px-6 sm:px-12" style={{ background: "linear-gradient(to right,#0b0318 78%,rgba(11,3,24,.9) 90%,transparent)", fontSize: "clamp(20px,2.6vw,34px)" }}>Learn From <span className="font-[family-name:var(--font-playfair)] italic">Mentors</span></div>
          <div className="pointer-events-none absolute right-0 top-0 z-[2] h-full w-[200px]" style={{ background: "linear-gradient(to left,#0b0318 15%,transparent)" }} />
          <div className="ld-track flex items-center">
            {[...LOGOS, ...LOGOS].map((l, i) => <div key={i} className="flex items-center px-10 sm:px-16"><Image src={`/landing/logo-${l}.webp`} alt={l} width={180} height={48} className="h-9 w-auto object-contain sm:h-12" /></div>)}
          </div>
        </div>
      </section>

      {/* ===== EXPLORE ===== */}
      <section id="explore" className="px-6 py-8 sm:px-16 sm:pb-20 sm:pt-8" style={{ background: "#0b0318" }}>
        <div className="mx-auto max-w-[1800px] rounded-[30px] border border-[#7a7a7a] bg-[#171717] p-6 sm:p-11" >
          <h2 className="font-medium tracking-tight" style={{ fontSize: "clamp(34px,4.5vw,58px)" }}>Explore VEDAM<span className="font-[family-name:var(--font-playfair)] italic">One</span></h2>
          <p className="mt-6 max-w-[1360px] font-light leading-relaxed tracking-tight text-[#b5b5b5]" style={{ fontSize: "clamp(17px,1.6vw,25px)" }}>Start coding early, build real products with AI, compete in hackathons, join live tech sessions and learn from people working across MAANG and top tech companies.</p>
          <div className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {CARDS.map((c) => (
              <Link key={c.key} href={c.href} className="group relative block overflow-hidden rounded-[25px] transition-all duration-300 hover:-translate-y-1.5"
                onMouseEnter={(e) => { if (c.live) e.currentTarget.style.boxShadow = `0 0 45px rgba(${c.glow},0.5)`; }}
                onMouseLeave={(e) => { e.currentTarget.style.boxShadow = ""; }}>
                <Image src={`/landing/${c.ill}`} alt={c.title} width={440} height={500} className="h-auto w-full" />
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ===== FOOTER ===== */}
      <footer className="flex flex-col gap-10 border-t border-white/10 px-6 py-14 sm:flex-row sm:gap-32 sm:px-16" style={{ background: "#0b0318" }}>
        <div><h4 className="mb-3 text-xl font-semibold">Quick Links</h4>
          <Link href="/privacy" className="block text-[15px] font-medium leading-[30px] text-white/80 hover:text-white">Privacy Policy</Link>
          <Link href="/terms" className="block text-[15px] font-medium leading-[30px] text-white/80 hover:text-white">Terms of Service</Link>
        </div>
        <div><h4 className="mb-3 text-xl font-semibold">Contact Us</h4>
          <a href="mailto:connect@vedam.org" className="block text-[15px] font-medium leading-[30px] text-white/80 hover:text-white">connect@vedam.org</a>
          <a href="tel:+919201010176" className="block text-[15px] font-medium leading-[30px] text-white/80 hover:text-white">+91 92010 10176</a>
        </div>
        <div><h4 className="mb-3 text-xl font-semibold">Follow Us</h4>
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

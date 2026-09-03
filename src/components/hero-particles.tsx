"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";

/** Cinematic dark particle-constellation hero. Points drift into a soft form,
 *  breathe, and part around the cursor. Falls back to static on reduced-motion. */
export function HeroParticles() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [animated, setAnimated] = useState(true);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const canvas = canvasRef.current;
    if (!canvas || reduce) { setAnimated(false); return; }
    const ctx = canvas.getContext("2d"); if (!ctx) { setAnimated(false); return; }

    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    let W = 0, H = 0;
    function resize() { W = canvas!.clientWidth; H = canvas!.clientHeight; canvas!.width = Math.floor(W * dpr); canvas!.height = Math.floor(H * dpr); ctx!.setTransform(dpr, 0, 0, dpr, 0, 0); build(); }

    type P = { hx: number; hy: number; x: number; y: number; vx: number; vy: number; s: number; c: string };
    let pts: P[] = [];
    const COLORS = ["rgba(249,125,3,", "rgba(232,0,116,", "rgba(180,150,255,", "rgba(138,24,255,"];
    function build() {
      const N = Math.min(1300, Math.floor((W * H) / 1500));
      pts = [];
      for (let i = 0; i < N; i++) {
        // home position: soft elliptical cloud centred a touch above middle
        const a = Math.random() * Math.PI * 2;
        const r = Math.pow(Math.random(), 0.62) * Math.min(W, H) * 0.42;
        const hx = W / 2 + Math.cos(a) * r * 1.15;
        const hy = H * 0.46 + Math.sin(a) * r * 0.8;
        pts.push({ hx, hy, x: Math.random() * W, y: Math.random() * H, vx: 0, vy: 0, s: Math.random() * 1.3 + 0.5, c: COLORS[(Math.random() * COLORS.length) | 0] });
      }
    }

    const mouse = { x: -999, y: -999 };
    function move(e: MouseEvent) { const r = canvas!.getBoundingClientRect(); mouse.x = e.clientX - r.left; mouse.y = e.clientY - r.top; }
    function leave() { mouse.x = -999; mouse.y = -999; }
    resize(); window.addEventListener("resize", resize); window.addEventListener("mousemove", move); canvas.addEventListener("mouseleave", leave);

    let raf = 0; const t0 = performance.now();
    function loop(now: number) {
      const t = (now - t0) / 1000;
      ctx!.clearRect(0, 0, W, H);
      ctx!.globalCompositeOperation = "lighter";
      for (const p of pts) {
        const bx = p.hx + Math.sin(t * 0.5 + p.hx * 0.012) * 12;
        const by = p.hy + Math.cos(t * 0.45 + p.hy * 0.012) * 12;
        p.vx += (bx - p.x) * 0.006; p.vy += (by - p.y) * 0.006;
        const dx = p.x - mouse.x, dy = p.y - mouse.y, d2 = dx * dx + dy * dy;
        if (d2 < 16000) { const f = ((16000 - d2) / 16000) * 2.6; const d = Math.sqrt(d2) + 0.01; p.vx += (dx / d) * f; p.vy += (dy / d) * f; }
        p.vx *= 0.9; p.vy *= 0.9; p.x += p.vx; p.y += p.vy;
        ctx!.fillStyle = p.c + "0.9)";
        ctx!.beginPath(); ctx!.arc(p.x, p.y, p.s, 0, 6.283); ctx!.fill();
      }
      ctx!.globalCompositeOperation = "source-over";
      raf = requestAnimationFrame(loop);
    }
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", resize); window.removeEventListener("mousemove", move); canvas.removeEventListener("mouseleave", leave); };
  }, []);

  return (
    <section className="relative flex min-h-[92vh] items-center justify-center overflow-hidden text-white"
      style={{ background: "radial-gradient(130% 100% at 50% 8%, #170e34 0%, #0a0620 46%, #060410 100%)" }}>
      {animated
        ? <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-hidden />
        : <div aria-hidden className="absolute inset-0" style={{ backgroundImage: "radial-gradient(circle at 50% 44%, rgba(138,24,255,.22), transparent 60%)" }} />}
      <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.05]" style={{ backgroundImage: "radial-gradient(#fff .5px, transparent .6px)", backgroundSize: "3px 3px" }} />
      <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(55% 50% at 50% 50%, rgba(6,4,16,.5), transparent 72%)" }} />

      <div className="relative z-10 mx-auto max-w-3xl px-6 text-center">
        <span className="inline-flex items-center gap-2 font-mono text-xs font-medium tracking-wide text-white/55">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: "linear-gradient(135deg,#F97D03,#8A18FF)" }} />
          Vedam School of Technology
        </span>
        <h1 className="mt-6 text-[clamp(2.6rem,7vw,5.4rem)] font-extrabold leading-[0.98] tracking-tight" style={{ fontFamily: "var(--font-outfit)" }}>
          You don&apos;t just learn to code —{" "}
          <span style={{ fontFamily: "var(--font-fraunces)", fontStyle: "italic", fontWeight: 500, background: "linear-gradient(115deg,#ffd9a0,#E80074 55%,#c9a3ff)", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>you build.</span>
        </h1>
        <p className="mx-auto mt-6 max-w-[34em] text-lg leading-relaxed text-white/60" style={{ fontFamily: "var(--font-nunito)" }}>
          One login for your entire journey — Events, CodeSprint and College Predictor, taking you from Class 12 to a career in tech.
        </p>
        <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
          <Link href="/register" className="rounded-xl px-7 py-3.5 text-sm font-bold text-white transition-transform hover:-translate-y-0.5" style={{ background: "linear-gradient(120deg,#F97D03,#8A18FF)", boxShadow: "0 14px 38px -10px rgba(138,24,255,.6)" }}>Get started</Link>
          <Link href="/events" className="rounded-xl border border-white/25 px-7 py-3.5 text-sm font-semibold text-white transition-colors hover:border-white/50">Explore events</Link>
        </div>
      </div>
      <div aria-hidden className="pointer-events-none absolute bottom-0 left-0 right-0 h-28" style={{ background: "linear-gradient(to bottom, transparent, rgb(var(--background)))" }} />
    </section>
  );
}

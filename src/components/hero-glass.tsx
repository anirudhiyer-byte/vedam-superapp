"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";

/** Cinematic dark hero with a REAL glass crystal (Three.js MeshPhysicalMaterial
 *  transmission → true refraction of brand-coloured light behind it). Slow spin +
 *  cursor tilt. Lazy-loads three; static fallback on reduced-motion / failure. */
export function HeroGlass() {
  const mountRef = useRef<HTMLDivElement>(null);
  const [ok, setOk] = useState(true);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const mount = mountRef.current;
    if (!mount || reduce) { setOk(false); return; }
    let disposed = false;
    let cleanup = () => {};

    (async () => {
      let THREE;
      try { THREE = await import("three"); } catch { setOk(false); return; }
      if (disposed) return;

      const W = () => mount.clientWidth, H = () => mount.clientHeight;
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      renderer.setSize(W(), H());
      mount.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(45, W() / H(), 0.1, 100);
      camera.position.set(0, 0, 6);

      // ---- coloured light sources BEHIND the glass (what it refracts) ----
      const mkGlow = (color: number, x: number, y: number, z: number, s: number) => {
        const m = new THREE.Mesh(new THREE.SphereGeometry(s, 32, 32), new THREE.MeshBasicMaterial({ color }));
        m.position.set(x, y, z); scene.add(m); return m;
      };
      const g1 = mkGlow(0xF97D03, -2.4, 1.6, -3, 1.5);   // orange
      const g2 = mkGlow(0x8A18FF, 2.6, -1.2, -3.5, 1.8); // violet
      const g3 = mkGlow(0xE80074, 0.4, -2.2, -3, 1.2);   // pink

      // ---- the glass crystal ----
      const geo = new THREE.IcosahedronGeometry(1.7, 1); // faceted crystal
      const mat = new THREE.MeshPhysicalMaterial({
        transmission: 1, thickness: 2.2, roughness: 0.06, ior: 1.46,
        iridescence: 1, iridescenceIOR: 1.3, iridescenceThicknessRange: [120, 480],
        clearcoat: 1, clearcoatRoughness: 0.1, metalness: 0, envMapIntensity: 1,
        attenuationColor: new THREE.Color(0x8A18FF), attenuationDistance: 3.5,
      });
      const crystal = new THREE.Mesh(geo, mat); scene.add(crystal);

      // lights for highlights
      scene.add(new THREE.AmbientLight(0x8899ff, 0.5));
      const l1 = new THREE.DirectionalLight(0xffffff, 1.2); l1.position.set(3, 4, 5); scene.add(l1);
      const l2 = new THREE.PointLight(0xF97D03, 8, 20); l2.position.set(-4, 2, 3); scene.add(l2);
      const l3 = new THREE.PointLight(0x8A18FF, 8, 20); l3.position.set(4, -2, 3); scene.add(l3);

      const mouse = { x: 0, y: 0, tx: 0, ty: 0 };
      const onMove = (e: MouseEvent) => { mouse.tx = (e.clientX / window.innerWidth - 0.5); mouse.ty = (e.clientY / window.innerHeight - 0.5); };
      window.addEventListener("mousemove", onMove);
      const onResize = () => { renderer.setSize(W(), H()); camera.aspect = W() / H(); camera.updateProjectionMatrix(); };
      window.addEventListener("resize", onResize);

      let raf = 0;
      const animate = () => {
        mouse.x += (mouse.tx - mouse.x) * 0.05; mouse.y += (mouse.ty - mouse.y) * 0.05;
        crystal.rotation.y += 0.0032; crystal.rotation.x += 0.0014;
        crystal.rotation.y += mouse.x * 0.06; crystal.rotation.x += -mouse.y * 0.06;
        g1.position.x = -2.4 + mouse.x * 1.5; g2.position.x = 2.6 + mouse.x * 1.5;
        camera.position.x = mouse.x * 0.6; camera.position.y = -mouse.y * 0.4; camera.lookAt(0, 0, 0);
        renderer.render(scene, camera);
        raf = requestAnimationFrame(animate);
      };
      raf = requestAnimationFrame(animate);

      cleanup = () => {
        cancelAnimationFrame(raf);
        window.removeEventListener("mousemove", onMove); window.removeEventListener("resize", onResize);
        geo.dispose(); mat.dispose(); renderer.dispose();
        if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
      };
    })();

    return () => { disposed = true; cleanup(); };
  }, []);

  return (
    <section className="relative flex min-h-[92vh] items-center justify-center overflow-hidden text-white"
      style={{ background: "radial-gradient(130% 100% at 50% 20%, #150c30 0%, #0a0620 46%, #060410 100%)" }}>
      {/* glass canvas OR fallback */}
      {ok ? <div ref={mountRef} className="absolute inset-0" aria-hidden />
        : <div aria-hidden className="absolute inset-0" style={{ background: "radial-gradient(40% 40% at 50% 44%, rgba(138,24,255,.35), rgba(249,125,3,.15), transparent 70%)" }} />}
      <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.05]" style={{ backgroundImage: "radial-gradient(#fff .5px, transparent .6px)", backgroundSize: "3px 3px" }} />
      <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(60% 55% at 50% 52%, rgba(6,4,16,.55), transparent 72%)" }} />

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

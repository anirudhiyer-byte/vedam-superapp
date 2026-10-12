"use client";

import { useEffect, useRef } from "react";

/**
 * Ambient 3D depth field behind the College Predictor page.
 *
 * Subtle, brand-tinted particles drifting in 3D with a gentle pointer
 * parallax — dark, dimmed and non-interactive so the content stays the hero.
 * Keeps the page's dark theme; readability is protected by a vignette on top.
 *
 * Performance / safety:
 *  - three.js is lazy-loaded (dynamic import) only on the client, after mount
 *  - device-pixel-ratio capped, fewer particles on mobile, low-power hint
 *  - honors prefers-reduced-motion (renders a single static frame)
 *  - pauses when the tab is hidden; fully disposes on unmount
 *  - graceful no-op if three / WebGL is unavailable (plain dark bg)
 */
export function PredictBackground() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let raf = 0;
    let disposed = false;
    let cleanup: (() => void) | null = null;

    (async () => {
      let THREE: typeof import("three");
      try {
        THREE = await import("three");
      } catch {
        return; // three unavailable → graceful no-op
      }
      if (disposed) return;

      let renderer: import("three").WebGLRenderer;
      try {
        renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false, powerPreference: "low-power" });
      } catch {
        return; // no WebGL → graceful no-op
      }
      renderer.setClearColor(0x000000, 0);

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 100);
      camera.position.z = 15;

      const resize = () => {
        const w = canvas.clientWidth || window.innerWidth;
        const h = canvas.clientHeight || window.innerHeight;
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      };
      resize();

      const mobile = window.innerWidth < 640;
      const COUNT = mobile ? 180 : 380;
      const positions = new Float32Array(COUNT * 3);
      const colors = new Float32Array(COUNT * 3);
      const palette = [
        new THREE.Color("#8a18ff"),
        new THREE.Color("#ff7a3d"),
        new THREE.Color("#ff3d9a"),
        new THREE.Color("#22d3ee"),
      ];
      for (let i = 0; i < COUNT; i++) {
        positions[i * 3] = (Math.random() - 0.5) * 36;
        positions[i * 3 + 1] = (Math.random() - 0.5) * 24;
        positions[i * 3 + 2] = (Math.random() - 0.5) * 20;
        const c = palette[(Math.random() * palette.length) | 0];
        colors[i * 3] = c.r;
        colors[i * 3 + 1] = c.g;
        colors[i * 3 + 2] = c.b;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      const mat = new THREE.PointsMaterial({
        size: mobile ? 0.14 : 0.12,
        vertexColors: true,
        transparent: true,
        opacity: 0.5,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const points = new THREE.Points(geo, mat);
      scene.add(points);

      let tx = 0, ty = 0, cx = 0, cy = 0;
      const onPointer = (e: PointerEvent) => {
        tx = (e.clientX / window.innerWidth - 0.5) * 2;
        ty = (e.clientY / window.innerHeight - 0.5) * 2;
      };
      const onResize = () => resize();
      window.addEventListener("pointermove", onPointer, { passive: true });
      window.addEventListener("resize", onResize);

      const draw = () => {
        points.rotation.y += 0.0005;
        points.rotation.x += 0.00018;
        cx += (tx * 1.6 - cx) * 0.03;
        cy += (-ty * 1.1 - cy) * 0.03;
        camera.position.x = cx;
        camera.position.y = cy;
        camera.lookAt(0, 0, 0);
        renderer.render(scene, camera);
      };

      const loop = () => {
        if (disposed) return;
        draw();
        raf = window.requestAnimationFrame(loop);
      };

      const onVis = () => {
        if (document.hidden) {
          window.cancelAnimationFrame(raf);
          raf = 0;
        } else if (!reduce && !raf) {
          loop();
        }
      };
      document.addEventListener("visibilitychange", onVis);

      if (reduce) draw();
      else loop();

      cleanup = () => {
        window.cancelAnimationFrame(raf);
        window.removeEventListener("pointermove", onPointer);
        window.removeEventListener("resize", onResize);
        document.removeEventListener("visibilitychange", onVis);
        geo.dispose();
        mat.dispose();
        renderer.dispose();
      };
    })();

    return () => {
      disposed = true;
      if (cleanup) cleanup();
    };
  }, []);

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <canvas ref={canvasRef} className="sticky top-0 block h-screen w-full" />
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(85% 55% at 50% 16%, rgba(0,0,0,0) 0%, rgba(0,0,0,0.38) 55%, rgba(0,0,0,0.74) 100%)",
        }}
      />
    </div>
  );
}

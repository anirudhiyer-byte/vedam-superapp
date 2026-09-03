"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";

/** Cinematic dark WebGL "flowing light" hero. Falls back to a static dark
 *  gradient when WebGL is unavailable or the user prefers reduced motion. */
export function HeroFlowingLight() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [webgl, setWebgl] = useState(true);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const canvas = canvasRef.current;
    if (!canvas || reduce) { setWebgl(false); return; }
    const gl = canvas.getContext("webgl", { antialias: false, alpha: false });
    if (!gl) { setWebgl(false); return; }

    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    function resize() { canvas!.width = Math.floor(canvas!.clientWidth * dpr); canvas!.height = Math.floor(canvas!.clientHeight * dpr); gl!.viewport(0, 0, canvas!.width, canvas!.height); }

    const vs = `attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}`;
    // DARK flowing light: deep base, brand light concentrated + bloomed toward cursor, strong falloff.
    const fs = `precision highp float;uniform float t;uniform vec2 res;uniform vec2 mo;
    float hash(vec2 p){return fract(sin(dot(p,vec2(41.3,289.1)))*43758.5);}
    float nse(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
      return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
    float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<5;i++){v+=a*nse(p);p*=2.02;a*=.5;}return v;}
    void main(){
      vec2 uv=gl_FragCoord.xy/res.xy;vec2 p=(uv-.5);p.x*=res.x/res.y;
      vec2 m=(mo-.5);m.x*=res.x/res.y;
      // flowing domain-warped field
      vec2 q=p*1.6+vec2(0.,t*.03);
      float w=fbm(q+fbm(q*1.3+t*.06)*1.2);
      // light concentrated near center, pulled toward cursor
      float d=length(p-m*.55);
      float bloom=exp(-d*2.4)*1.15 + exp(-d*5.5)*.8;
      // brand ramp, kept DARK: base near-black violet, light emerges from the field
      vec3 base=vec3(.035,.02,.075);
      vec3 c1=vec3(.98,.49,.02);          // orange
      vec3 c2=vec3(.54,.09,1.);           // violet
      vec3 c3=vec3(.91,0.,.45);           // pink
      float mix1=smoothstep(.35,.75,w);
      vec3 light=mix(c2,c1,mix1);
      light=mix(light,c3,smoothstep(.55,.9,fbm(q*1.1-t*.05)));
      float intensity=pow(w,1.7)*bloom;
      vec3 col=base+light*intensity*.9;
      // vignette + overall darkening so copy stays readable
      col*=1.0-smoothstep(.35,1.15,length(p));
      col=mix(col,base,.25);
      col=pow(col,vec3(1.08));
      gl_FragColor=vec4(col,1.);
    }`;
    function sh(type: number, src: string) { const x = gl!.createShader(type)!; gl!.shaderSource(x, src); gl!.compileShader(x); return x; }
    const prog = gl.createProgram()!; gl.attachShader(prog, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(prog); gl.useProgram(prog);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "p"); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const uT = gl.getUniformLocation(prog, "t"), uRes = gl.getUniformLocation(prog, "res"), uMo = gl.getUniformLocation(prog, "mo");
    resize(); window.addEventListener("resize", resize);

    const mouse = { x: 0.5, y: 0.4, tx: 0.5, ty: 0.4 };
    function move(e: MouseEvent) { mouse.tx = e.clientX / window.innerWidth; mouse.ty = e.clientY / window.innerHeight; }
    window.addEventListener("mousemove", move);

    let raf = 0; const t0 = performance.now();
    function loop(now: number) {
      mouse.x += (mouse.tx - mouse.x) * 0.05; mouse.y += (mouse.ty - mouse.y) * 0.05;
      gl!.uniform1f(uT, (now - t0) / 1000);
      gl!.uniform2f(uRes, canvas!.width, canvas!.height);
      gl!.uniform2f(uMo, mouse.x, 1 - mouse.y);
      gl!.drawArrays(gl!.TRIANGLES, 0, 3);
      raf = requestAnimationFrame(loop);
    }
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", resize); window.removeEventListener("mousemove", move); };
  }, []);

  return (
    <section className="relative flex min-h-[92vh] items-center justify-center overflow-hidden bg-[#070510] text-white">
      {/* animated field OR static fallback */}
      {webgl
        ? <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-hidden />
        : <div aria-hidden className="absolute inset-0" style={{ background: "radial-gradient(120% 90% at 50% 30%, #1a0f3a 0%, #0c0722 45%, #070510 100%)" }} />}
      {/* grain + scrim for readability */}
      <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.05]" style={{ backgroundImage: "radial-gradient(#fff .5px, transparent .6px)", backgroundSize: "3px 3px" }} />
      <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(60% 55% at 50% 50%, rgba(7,5,16,.55), transparent 70%)" }} />

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
      {/* fade into the page below */}
      <div aria-hidden className="pointer-events-none absolute bottom-0 left-0 right-0 h-28" style={{ background: "linear-gradient(to bottom, transparent, rgb(var(--background)))" }} />
    </section>
  );
}

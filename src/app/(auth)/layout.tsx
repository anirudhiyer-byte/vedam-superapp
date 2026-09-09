import Link from "next/link";
import Image from "next/image";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-screen overflow-hidden font-[family-name:var(--font-inter)] text-white" style={{ background: "radial-gradient(120% 100% at 80% 0%, #331660 0%, #1a0b38 45%, #0b0318 100%)" }}>
      {/* polka texture + purple glow, matching the landing */}
      <div aria-hidden className="pointer-events-none absolute inset-0 z-[1] opacity-[0.16]" style={{ backgroundImage: "radial-gradient(rgba(205,165,255,0.6) 1.3px, transparent 1.6px)", backgroundSize: "24px 24px" }} />
      <div aria-hidden className="pointer-events-none absolute -right-32 top-10 z-[1] h-[560px] w-[620px] rounded-full opacity-70 blur-[50px]" style={{ background: "radial-gradient(closest-side, rgba(150,40,220,.4), transparent 70%)" }} />
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 z-[10] h-28" style={{ background: "linear-gradient(to bottom, #000 25%, transparent)" }} />

      <header className="relative z-30 flex h-16 items-center px-5 sm:px-8">
        <Link href="/" aria-label="Vedam home" className="flex items-center">
          <Image src="/landing/vedam-logo-dark.png" alt="Vedam School of Technology" width={200} height={48} priority className="h-10 w-auto" />
        </Link>
      </header>

      <main className="relative z-20 flex min-h-[calc(100vh-4rem)] items-start justify-center px-4 pb-16 pt-6 sm:items-center sm:pt-0">
        <div className="w-full max-w-md">
          <div className="mb-6 text-center">
            <h1 className="font-[family-name:var(--font-inter)] text-4xl font-normal uppercase leading-[0.85] tracking-[-0.04em]">
              Vedam <span className="font-[family-name:var(--font-playfair)] text-3xl italic tracking-tight" style={{ fontWeight: 600 }}>One</span>
            </h1>
            <p className="mt-2 font-light italic text-white/60">The Home of Future Engineers</p>
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}

import Link from "next/link";
import { EcosystemHub } from "@/components/ecosystem-hub";
import { HeroCta } from "@/components/hero-cta";

const APPS = [
  {
    name: "Events",
    blurb: "Discover, register, and show up — every event tied to your profile.",
    live: true,
  },
];

export default function HomePage() {
  return (
    <>
      <section className="relative overflow-hidden px-6 py-16 sm:px-10 lg:px-16 lg:py-24">
        {/* brand glows */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10"
          style={{
            background:
              "radial-gradient(680px 420px at 78% 8%, var(--glow-violet), transparent 62%), radial-gradient(560px 420px at 8% 92%, var(--glow-orange), transparent 60%)",
          }}
        />
        {/* dotted grid */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 opacity-80"
          style={{
            backgroundImage: "radial-gradient(var(--dot) 1px, transparent 1.4px)",
            backgroundSize: "26px 26px",
            WebkitMaskImage: "radial-gradient(circle at 70% 40%, #000 0%, transparent 70%)",
            maskImage: "radial-gradient(circle at 70% 40%, #000 0%, transparent 70%)",
          }}
        />

        <div className="relative z-10 mx-auto grid max-w-6xl items-center gap-10 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16">
          <div>
            <span
              className="mb-6 inline-flex items-center gap-2 rounded-full border px-3 py-1.5 font-mono text-xs font-medium text-accent"
              style={{ borderColor: "var(--border-strong)", background: "var(--pill-bg)" }}
            >
              <span
                className="h-1.5 w-1.5 rounded-full bg-primary"
                style={{ boxShadow: "0 0 0 3px rgba(249,125,3,.25)" }}
              />
              // the vedam ecosystem
            </span>

            <h1 className="font-display text-4xl font-bold leading-[1.04] tracking-tight text-heading sm:text-5xl lg:text-6xl">
              One login.
              <br />
              Your whole journey from
              <br />
              <span className="text-brand-gradient">ambition to expertise.</span>
            </h1>

            <p className="mt-6 max-w-[30em] font-body text-base leading-relaxed text-muted sm:text-lg">
              Learn to code, predict your colleges, connect with seniors who&apos;ve
              walked your path, and join every Vedam event — all from a single
              account that grows with you.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <HeroCta />
              <Link
                href="/events"
                className="rounded-xl border px-6 py-3 text-sm font-semibold text-foreground transition-colors hover:bg-surface"
                style={{ borderColor: "var(--border-strong)" }}
              >
                Explore events
              </Link>
            </div>

            <div className="mt-8 flex flex-wrap gap-4">
              {["Learn", "Predict", "Connect", "Grow"].map((c) => (
                <span
                  key={c}
                  className="inline-flex items-center gap-2 font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-muted before:h-[5px] before:w-[5px] before:rounded-full before:bg-primary before:content-['']"
                >
                  {c}
                </span>
              ))}
            </div>
          </div>

          <div className="order-first lg:order-none">
            <EcosystemHub />
          </div>
        </div>
      </section>

      {/* ecosystem app cards */}
      <section className="relative z-10 mx-auto grid max-w-6xl gap-4 px-6 pb-16 sm:grid-cols-2 sm:px-10 lg:grid-cols-4 lg:px-16 lg:pb-24">
        {APPS.map((app) => (
          <div
            key={app.name}
            className="flex flex-col gap-2.5 rounded-2xl border border-border bg-surface p-5 transition-transform hover:-translate-y-1"
          >
            <span
              className={[
                "inline-flex h-10 w-10 items-center justify-center rounded-xl text-lg",
                app.live ? "bg-brand-gradient text-white" : "text-accent",
              ].join(" ")}
              style={app.live ? undefined : { background: "var(--node-muted-bg)" }}
              aria-hidden
            >
              ◆
            </span>
            <h3 className="font-display text-base font-semibold text-heading">
              {app.name}
            </h3>
            <p className="font-body text-[13px] leading-relaxed text-muted">
              {app.blurb}
            </p>
          </div>
        ))}
      </section>
    </>
  );
}

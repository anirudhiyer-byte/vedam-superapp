import Link from "next/link";

/**
 * Landing hero.
 *
 * Signature element: a thin orange->violet gradient ring, lifted straight from
 * the brand book's cover, sitting behind the headline. It nods to the logo's
 * own story — the circle as the student's transformation — so the one bold
 * device on the page is drawn from Vedam's actual identity, not decoration.
 * Everything else stays quiet.
 */
export default function HomePage() {
  return (
    <section className="relative overflow-hidden">
      {/* signature gradient ring */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 -z-10 h-[130vw] w-[130vw] max-h-[900px] max-w-[900px] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-60"
        style={{
          background:
            "conic-gradient(from 210deg, #F97D03, #E80074, #8A18FF, #2B135C, #F97D03)",
          WebkitMask:
            "radial-gradient(circle, transparent 60%, black 60.4%, black 61%, transparent 61.4%)",
          mask:
            "radial-gradient(circle, transparent 60%, black 60.4%, black 61%, transparent 61.4%)",
        }}
      />

      <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-3xl flex-col items-center justify-center px-6 py-20 text-center">
        <span className="mb-6 inline-flex items-center rounded-full border border-border bg-surface/50 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-muted">
          The Vedam Ecosystem
        </span>

        <h1 className="font-display text-4xl font-bold leading-[1.05] tracking-tight text-foreground sm:text-6xl">
          One login. <br className="hidden sm:block" />
          Your entire{" "}
          <span className="text-brand-gradient">Vedam journey.</span>
        </h1>

        <p className="mt-6 max-w-xl font-body text-base leading-relaxed text-muted sm:text-lg">
          Learn to code, predict your colleges, meet the seniors who&apos;ve
          walked your path, and join every Vedam event — all from one place,
          one account.
        </p>

        <div className="mt-9 flex flex-col items-center gap-3 sm:flex-row">
          <Link
            href="/register"
            className="w-full rounded-xl bg-brand-gradient px-7 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90 sm:w-auto"
          >
            Create your account
          </Link>
          <Link
            href="/events"
            className="w-full rounded-xl border border-border px-7 py-3 text-sm font-semibold text-foreground/80 transition-colors hover:bg-surface hover:text-foreground sm:w-auto"
          >
            Explore events
          </Link>
        </div>

        <p className="mt-6 text-xs text-muted">
          From raw ambition to refined expertise — the whole way, together.
        </p>
      </div>
    </section>
  );
}

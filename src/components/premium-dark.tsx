/** Forced-dark premium backdrop (matches the landing) for dashboard / leaderboard.
 *  The .vd-dark class (in globals.css) re-maps the theme tokens to dark-glass,
 *  so the existing bg-surface / border-border / text-* classes render premium-dark. */
export function PremiumDark({ children }: { children: React.ReactNode }) {
  return (
    <div className="vd-premium vd-dark min-h-screen" style={{ background: "radial-gradient(120% 80% at 80% 0%, #331660 0%, #1a0b38 40%, #0b0318 100%)" }}>
      <div aria-hidden className="pointer-events-none absolute inset-0 z-0 opacity-[0.12]" style={{ backgroundImage: "radial-gradient(rgba(205,165,255,0.6) 1.3px, transparent 1.6px)", backgroundSize: "24px 24px" }} />
      <div aria-hidden className="pointer-events-none absolute -right-32 top-6 z-0 h-[520px] w-[600px] rounded-full opacity-60 blur-[60px]" style={{ background: "radial-gradient(closest-side, rgba(150,40,220,.35), transparent 70%)" }} />
      <div aria-hidden className="pointer-events-none absolute -left-40 bottom-0 z-0 h-[440px] w-[520px] rounded-full opacity-40 blur-[60px]" style={{ background: "radial-gradient(closest-side, rgba(249,125,3,.22), transparent 70%)" }} />
      <div className="relative z-10">{children}</div>
    </div>
  );
}

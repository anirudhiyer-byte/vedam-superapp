/**
 * PLACEHOLDER MARK — replace with the official Vedam SVG assets.
 *
 * The brand book forbids recreating or altering the mark, so this is a
 * deliberate stand-in (orange rhomboid + violet dot, echoing the real logo's
 * geometry) purely so the shell renders. Drop the official files into
 * /public (e.g. logo-mark.svg, logo-wordmark-light.svg, logo-wordmark-dark.svg)
 * and swap this component to render them.
 */
export function Logo({ withWordmark = true }: { withWordmark?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2 select-none">
      <svg width="26" height="30" viewBox="0 0 26 30" fill="none" aria-hidden>
        {/* rhomboid — raw ambition */}
        <path d="M8 2h14l-4 12H4L8 2z" fill="#F97D03" />
        {/* dot — the pause to absorb & grow */}
        <circle cx="13" cy="23" r="6" fill="#8A18FF" />
      </svg>
      {withWordmark && (
        <span className="flex flex-col leading-none">
          <span className="font-display text-lg font-bold tracking-tight text-foreground">
            Vedam
          </span>
          <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted">
            School of Technology
          </span>
        </span>
      )}
    </span>
  );
}

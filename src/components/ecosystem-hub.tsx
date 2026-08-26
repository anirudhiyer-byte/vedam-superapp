/**
 * The hero signature: one central identity ("Vedam · one login") wired to the
 * four ecosystem apps. Events is lit (live); the rest are muted (soon). The
 * connectors carry a slow pulse. It draws the whole pitch — one account,
 * every platform. Theme-dependent colours come from CSS vars so it adapts to
 * light/dark automatically; brand hues are constant so they're hardcoded.
 */
export function EcosystemHub() {
  return (
    <div className="flex items-center justify-center">
      <svg
        viewBox="0 0 460 460"
        fill="none"
        role="img"
        aria-label="One Vedam identity connected to every platform"
        className="w-full max-w-[420px] md:max-w-[460px]"
      >
        <circle cx="230" cy="230" r="200" stroke="var(--hub-ring)" strokeWidth="1" />
        <circle cx="230" cy="230" r="140" stroke="var(--hub-ring)" strokeWidth="1" />

        <g className="[stroke-dasharray:4_7] motion-safe:animate-[flow_2.6s_linear_infinite]">
          <line x1="230" y1="230" x2="230" y2="66" stroke="#F97D03" strokeWidth="1.5" />
          <line x1="230" y1="230" x2="394" y2="230" stroke="#8A18FF" strokeWidth="1.5" />
          <line x1="230" y1="230" x2="230" y2="394" stroke="#8A18FF" strokeWidth="1.5" />
          <line x1="230" y1="230" x2="66" y2="230" stroke="#8A18FF" strokeWidth="1.5" />
        </g>

        {/* centre identity */}
        <circle cx="230" cy="230" r="52" fill="url(#hubGrad)" />
        <circle cx="230" cy="230" r="52" fill="none" stroke="rgba(255,255,255,.25)" strokeWidth="1" />
        <text x="230" y="226" textAnchor="middle" fontFamily="var(--font-outfit)" fontSize="17" fontWeight="700" fill="#fff">Vedam</text>
        <text x="230" y="244" textAnchor="middle" fontFamily="var(--font-jetbrains)" fontSize="8.5" letterSpacing="1.5" fill="rgba(255,255,255,.8)">ONE LOGIN</text>

        {/* Events — live */}
        <circle cx="230" cy="66" r="34" fill="var(--node-bg)" stroke="#F97D03" strokeWidth="1.5" />
        <text x="230" y="63" textAnchor="middle" fontFamily="var(--font-outfit)" fontSize="12" fontWeight="600" fill="rgb(var(--heading))">Events</text>
        <text x="230" y="78" textAnchor="middle" fontFamily="var(--font-jetbrains)" fontSize="7.5" letterSpacing="1" fill="#F97D03">LIVE</text>

        {/* CodeSprint */}
        <circle cx="394" cy="230" r="34" fill="var(--node-muted-bg)" stroke="var(--border-strong)" strokeWidth="1" />
        <text x="394" y="227" textAnchor="middle" fontFamily="var(--font-outfit)" fontSize="11" fontWeight="600" fill="var(--node-muted-text)">Code</text>
        <text x="394" y="240" textAnchor="middle" fontFamily="var(--font-outfit)" fontSize="11" fontWeight="600" fill="var(--node-muted-text)">Sprint</text>

        {/* College Predictor */}
        <circle cx="230" cy="394" r="34" fill="var(--node-muted-bg)" stroke="var(--border-strong)" strokeWidth="1" />
        <text x="230" y="391" textAnchor="middle" fontFamily="var(--font-outfit)" fontSize="11" fontWeight="600" fill="var(--node-muted-text)">College</text>
        <text x="230" y="404" textAnchor="middle" fontFamily="var(--font-outfit)" fontSize="11" fontWeight="600" fill="var(--node-muted-text)">Predictor</text>

        {/* Seek Seniors */}
        <circle cx="66" cy="230" r="34" fill="var(--node-muted-bg)" stroke="var(--border-strong)" strokeWidth="1" />
        <text x="66" y="227" textAnchor="middle" fontFamily="var(--font-outfit)" fontSize="11" fontWeight="600" fill="var(--node-muted-text)">Seek</text>
        <text x="66" y="240" textAnchor="middle" fontFamily="var(--font-outfit)" fontSize="11" fontWeight="600" fill="var(--node-muted-text)">Seniors</text>

        <defs>
          <linearGradient id="hubGrad" x1="178" y1="178" x2="282" y2="282" gradientUnits="userSpaceOnUse">
            <stop stopColor="#F97D03" />
            <stop offset="0.5" stopColor="#E80074" />
            <stop offset="1" stopColor="#8A18FF" />
          </linearGradient>
        </defs>
      </svg>
    </div>
  );
}

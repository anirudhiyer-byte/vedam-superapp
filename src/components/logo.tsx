/* eslint-disable @next/next/no-img-element */

/**
 * Official Vedam logo. Light-background logo in light mode, the dark-mode
 * variant in dark mode (toggled via Tailwind's `dark:` classes). Files live
 * in /public. `withWordmark` just tunes the height (the mark includes the
 * wordmark already).
 */
export function Logo({ withWordmark = true }: { withWordmark?: boolean }) {
  const h = withWordmark ? "h-7" : "h-6";
  return (
    <span className="inline-flex select-none items-center">
      <img
        src="/vedam-logo.png?v=2"
        alt="Vedam School of Technology"
        className={`${h} w-auto dark:hidden`}
      />
      <img
        src="/vedam-logo-dark.png?v=2"
        alt="Vedam School of Technology"
        className={`hidden ${h} w-auto dark:block`}
      />
    </span>
  );
}

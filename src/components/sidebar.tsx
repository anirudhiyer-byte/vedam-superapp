"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/logo";

/**
 * Ecosystem nav. Events is live; the rest are placeholders that light up as we
 * build them. `ready: false` items render disabled with a "Soon" tag.
 */
const NAV = [
  { label: "Home", href: "/", ready: true, live: false },
  { label: "Events", href: "/events", ready: true, live: true },
  { label: "CodeSprint", href: "/codesprint", ready: false, live: false },
  { label: "College Predictor", href: "/college-predictor", ready: false, live: false },
  { label: "Seek Your Seniors", href: "/seek-seniors", ready: false, live: false },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r border-border bg-surface/40 md:flex">
      <div className="flex h-16 items-center px-5">
        <Link href="/" aria-label="Vedam home">
          <Logo />
        </Link>
      </div>

      <nav className="flex flex-1 flex-col gap-1 px-3 py-4">
        {NAV.map((item) => {
          const active =
            item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);

          if (!item.ready) {
            return (
              <span
                key={item.href}
                className="flex cursor-default items-center justify-between rounded-lg px-3 py-2 text-sm font-medium text-muted"
              >
                {item.label}
                <span
                  className="rounded-full px-2 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wide text-accent"
                  style={{ background: "var(--pill-bg)" }}
                >
                  Soon
                </span>
              </span>
            );
          }

          return (
            <Link
              key={item.href}
              href={item.href}
              className={[
                "flex items-center justify-between rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-brand-gradient text-white"
                  : "text-foreground/75 hover:bg-surface hover:text-foreground",
              ].join(" ")}
            >
              {item.label}
              {item.live && !active && (
                <span
                  className="rounded-full px-2 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wide text-white"
                  style={{ background: "linear-gradient(120deg,#F97D03,#E80074)" }}
                >
                  Live
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="px-5 py-4 font-body text-[11px] leading-relaxed text-muted">
        One login for the entire Vedam ecosystem.
      </div>
    </aside>
  );
}

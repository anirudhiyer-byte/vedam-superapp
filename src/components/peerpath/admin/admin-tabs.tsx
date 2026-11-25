"use client";

import Link from "next/link";
import { createContext, useCallback, useContext, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";

/**
 * Instant tabs for the PeerPath admin page. The server renders every tab panel once (one pp_admin_all call);
 * switching only shows/hides panels and updates ?tab= in the address bar, so there is no reload and no extra
 * database call. Links still carry ?tab= so a new tab, a refresh or no JavaScript all land on the same tab.
 */

type Ctx = { tab: string; select: (id: string) => void };
const TabCtx = createContext<Ctx>({ tab: "overview", select: () => {} });

/** Adds ?tab= (or &tab=) for every tab except the default one. (The server page has its own href helper.) */
function withTab(href: string, tab: string) {
  return tab === "overview" ? href : `${href}${href.includes("?") ? "&" : "?"}tab=${encodeURIComponent(tab)}`;
}

export function AdminTabsProvider({ initial, children }: { initial: string; children: ReactNode }) {
  const [tab, setTab] = useState(initial);
  const select = useCallback((id: string) => {
    setTab(id);
    try {
      const url = new URL(window.location.href);
      if (id === "overview") url.searchParams.delete("tab");
      else url.searchParams.set("tab", id);
      window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    } catch {
      /* the tab still switches even if the address bar can't be updated */
    }
  }, []);
  return (
    <TabCtx.Provider value={{ tab, select }}>
      <style>{CSS}</style>
      {children}
    </TabCtx.Provider>
  );
}

export type TabItem = { id: string; label: string; href: string; icon?: ReactNode; badge?: number };

const plainClick = (e: MouseEvent) => e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;

export function AdminTabList({ items, label }: { items: TabItem[]; label: string }) {
  const { tab, select } = useContext(TabCtx);
  const refs = useRef<(HTMLAnchorElement | null)[]>([]);

  function onKey(e: KeyboardEvent, i: number) {
    const last = items.length - 1;
    const next = e.key === "ArrowRight" ? (i === last ? 0 : i + 1) : e.key === "ArrowLeft" ? (i === 0 ? last : i - 1) : e.key === "Home" ? 0 : e.key === "End" ? last : -1;
    if (next < 0) return;
    e.preventDefault();
    select(items[next].id);
    refs.current[next]?.focus();
  }

  return (
    <div>
      <div role="tablist" aria-label={label} className="grid grid-cols-4 gap-1 rounded-2xl border border-pp-line bg-pp-card/80 p-1.5 shadow-pp-card backdrop-blur sm:inline-flex">
        {items.map((t, i) => {
          const on = t.id === tab;
          return (
            <a
              key={t.id}
              ref={(el) => {
                refs.current[i] = el;
              }}
              id={`tab-${t.id}`}
              role="tab"
              href={t.href}
              aria-selected={on}
              aria-controls={`panel-${t.id}`}
              tabIndex={on ? 0 : -1}
              onClick={(e) => {
                if (!plainClick(e)) return;
                e.preventDefault();
                select(t.id);
              }}
              onKeyDown={(e) => onKey(e, i)}
              className={`group relative flex min-w-0 flex-col items-center justify-center gap-1 whitespace-nowrap rounded-xl px-1 py-2 text-[12px] font-semibold outline-none transition-all duration-200 focus-visible:ring-2 focus-visible:ring-pp-violet-600 sm:flex-row sm:gap-2 sm:px-5 sm:py-2.5 sm:text-[14px] ${
                on
                  ? "bg-gradient-to-b from-pp-violet-500 to-[#5b1fd1] text-white shadow-[0_6px_20px_-6px_rgba(118,41,252,0.75)]"
                  : "text-pp-muted hover:bg-pp-soft hover:text-pp-heading"
              }`}
            >
              {t.icon && <span className={on ? "text-white" : "text-pp-violet-700/80 group-hover:text-pp-violet-700"}>{t.icon}</span>}
              {t.label}
              {!!t.badge && (
                <span
                  className={`absolute right-1 top-1 min-w-[18px] rounded-full px-1 py-0.5 text-center text-[10px] font-bold leading-none sm:static sm:min-w-[20px] sm:px-1.5 sm:text-[11px] ${on ? "bg-white/20 text-white" : "bg-[#FF7A6E]/15 text-[#FF7A6E]"}`}
                  aria-label={`${t.badge} need action`}
                >
                  {t.badge}
                </span>
              )}
            </a>
          );
        })}
      </div>
    </div>
  );
}

export function AdminTabPanel({ id, children }: { id: string; children: ReactNode }) {
  const { tab } = useContext(TabCtx);
  const on = tab === id;
  return (
    <div role="tabpanel" id={`panel-${id}`} aria-labelledby={`tab-${id}`} hidden={!on} className={on ? "ppa-in flex flex-col gap-8" : undefined}>
      {children}
    </div>
  );
}

/** A Next link that keeps the tab the admin is on (used by the campus cards). */
export function KeepTabLink({ href, className, children, current }: { href: string; className?: string; children: ReactNode; current?: boolean }) {
  const { tab } = useContext(TabCtx);
  return (
    <Link href={withTab(href, tab)} aria-current={current ? "page" : undefined} className={className}>
      {children}
    </Link>
  );
}

// Small entrance motion for panels and bars; switched off for people who prefer reduced motion.
const CSS = `
@keyframes ppa-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
@keyframes ppa-grow-x { from { transform: scaleX(0); } }
@keyframes ppa-grow-y { from { transform: scaleY(0); } }
.ppa-in { animation: ppa-in .28s ease-out both; }
.ppa-bar-x { transform-origin: left; animation: ppa-grow-x .7s cubic-bezier(.2,.8,.2,1) both; }
.ppa-bar-y { transform-origin: bottom; animation: ppa-grow-y .7s cubic-bezier(.2,.8,.2,1) both; }
@media (prefers-reduced-motion: reduce) { .ppa-in, .ppa-bar-x, .ppa-bar-y { animation: none; } }
`;

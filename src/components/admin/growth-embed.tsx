"use client";

import { useRef, useState } from "react";
import Link from "next/link";

/**
 * Full-bleed embed for a Growth module prototype served from /public/growth/<file>.
 *
 * The prototype is a self-contained single-file app (its own dark "Neural Glass"
 * theme + Three.js background). Its internal left rail is hidden by the merge hooks
 * baked into the HTML, so navigation between its sub-pages happens through the tab
 * row below, which drives the iframe via `#page=<id>` deep-links.
 */

export type GrowthTab = { label: string; page: string };

export function GrowthEmbed({ title, file, tabs }: { title: string; file: string; tabs: GrowthTab[] }) {
  const [active, setActive] = useState(tabs[0]?.page ?? "");
  const frameRef = useRef<HTMLIFrameElement>(null);
  const base = `/growth/${file}`;

  function go(page: string) {
    setActive(page);
    const f = frameRef.current;
    if (!f) return;
    // Same document → just change the hash so the prototype's own hashchange handler fires.
    try {
      if (f.contentWindow && f.src.split("#")[0].endsWith(base)) {
        f.contentWindow.location.hash = `page=${page}`;
        return;
      }
    } catch {
      /* cross-origin guard — fall through to full src set */
    }
    f.src = `${base}#page=${page}`;
  }

  return (
    <div className="flex h-[calc(100vh-72px)] flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-white/10 bg-black/40 px-5 py-3">
        <Link href="/admin/growth" className="font-mono text-xs text-accent hover:underline">← Growth</Link>
        <span className="font-display text-sm font-bold text-white">{title}</span>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide text-emerald-300">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Live
        </span>
        {tabs.length > 1 && (
          <div className="ml-auto flex flex-wrap gap-1.5">
            {tabs.map((t) => (
              <button
                key={t.page}
                onClick={() => go(t.page)}
                className={[
                  "rounded-lg px-3 py-1.5 font-body text-[13px] font-medium transition-colors",
                  active === t.page ? "bg-brand-gradient text-white" : "text-white/70 hover:bg-white/10 hover:text-white",
                ].join(" ")}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}
      </div>
      <iframe
        ref={frameRef}
        title={title}
        src={`${base}#page=${active}`}
        className="w-full flex-1 border-0 bg-[#070a16]"
      />
    </div>
  );
}

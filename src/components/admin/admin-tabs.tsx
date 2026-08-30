"use client";
export function AdminTabs<T extends string>({ tabs, active, onChange }: { tabs: { key: T; label: string }[]; active: T; onChange: (t: T) => void }) {
  return (
    <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 px-6 pt-6 sm:px-10">
      <span className="mr-1 rounded-md bg-brand-gradient px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-wide text-white">Admin</span>
      {tabs.map((t) => (
        <button key={t.key} onClick={() => onChange(t.key)}
          className={["rounded-lg px-3.5 py-1.5 font-mono text-xs font-semibold transition-colors",
            active === t.key ? "bg-surface-warm text-heading" : "text-muted hover:text-foreground"].join(" ")}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** Placeholder shown while we resolve whether the viewer is an admin. */
export function AdminTabsSkeleton() {
  return (
    <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 px-6 pt-6 sm:px-10">
      <div className="h-6 w-12 animate-pulse rounded-md bg-surface-warm" />
      <div className="h-6 w-16 animate-pulse rounded-lg bg-surface-warm" />
      <div className="h-6 w-16 animate-pulse rounded-lg bg-surface-warm" />
      <div className="h-6 w-20 animate-pulse rounded-lg bg-surface-warm" />
    </div>
  );
}

import type { ReactNode } from "react";
import { cx, vx } from "./vx";

/** Page title for every VSAT admin page: title, an optional count chip, a line of help, and actions on the right. */
export function PageHead({ title, count, sub, actions, className }: {
  title: ReactNode; count?: ReactNode; sub?: ReactNode; actions?: ReactNode; className?: string;
}) {
  return (
    <div className={cx("flex flex-wrap items-end justify-between gap-x-6 gap-y-4", className)}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h1 className={vx.h1}>{title}</h1>
          {count != null && (
            <span className="rounded-full border border-vx-line bg-white/[0.05] px-2.5 py-0.5 text-[13px] font-medium tabular-nums text-vx-mut">{count}</span>
          )}
        </div>
        {sub && <p className={vx.sub}>{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

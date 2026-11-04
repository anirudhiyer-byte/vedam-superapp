"use client";

import { Icon, Menu, type MenuItem } from "../../ui/primitives";
import type { CommLogRow } from "../../lib/types";

export type CommActions = {
  detail: (r: CommLogRow) => void;
  download: (r: CommLogRow) => void;
  close: (r: CommLogRow) => void;
  notBuilt: (what: string) => void;
};

/**
 * Row gear. WhatsApp, e-mail and SMS: Delivery Report, Download Report, View Detailed Report.
 * Amplify: Download Report, Close, View Detailed Report, Add Campaign Details.
 */
export function RowMenu({ row, act }: { row: CommLogRow; act: CommActions }) {
  const items: MenuItem[] = row.channel === "amplify"
    ? [
        { label: "Download Report", icon: "download", onClick: () => act.download(row) },
        { label: "Close", icon: "close", disabled: row.status === "Closed", onClick: () => act.close(row) },
        { label: "View Detailed Report", icon: "chart", onClick: () => act.detail(row) },
        { label: "Add Campaign Details", icon: "plus", onClick: () => act.notBuilt("Add Campaign Details") },
      ]
    : [
        { label: "Delivery Report", icon: "send", onClick: () => act.notBuilt("Delivery Report") },
        { label: "Download Report", icon: "download", onClick: () => act.download(row) },
        { label: "View Detailed Report", icon: "chart", onClick: () => act.detail(row) },
      ];
  return (
    <Menu align="right" touch items={items}
      trigger={(open, toggle) => (
        <button type="button" onClick={toggle} aria-label={`Actions for ${row.jobId}`} aria-haspopup="menu" aria-expanded={open} data-row-actions={row.id}
          className={`grid h-11 w-11 place-items-center rounded-lg transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-soft sm:h-8 sm:w-8 ${open ? "bg-surface-warm text-accent" : "text-muted hover:bg-surface-warm hover:text-foreground"}`}>
          <Icon name="gear" className="h-4 w-4" />
        </button>
      )} />
  );
}

"use client";

import { useState } from "react";
import { Icon, type IconName } from "./ui/primitives";
import { ManageList } from "./sections/manage-list";
import { WhatsappFlow } from "./sections/whatsapp-flow";
import { CallLogs } from "./sections/call-logs";
import { CommunicationLogs } from "./sections/communication-logs";
import { ManageAutomation } from "./sections/manage-automation";
import { Suppressions } from "./sections/suppressions";
import { UploadRawData } from "./sections/upload-raw-data";
import { StaticListImport } from "./sections/upload/static-list-import";
import { CommunicationPerformance } from "./sections/communication-performance";
import {
  DocumentTemplates, LandingTemplates,
} from "./sections/template-manager";
import { isLivePage, liveNote } from "./lib/live-config";
import { uploadView } from "./lib/live-import";

/**
 * Communication Manager — shell.
 *
 * Marketing IA modelled on Meritto, minus the modules we don't carry
 * (Niaa, Manage Segment, Echo, Manage Video Meeting). Sections swap by
 * internal state, so there's exactly one route: /admin/communication.
 */

export type CmPage =
  | "upload" | "lists" | "whatsappFlow" | "automation" | "callLogs"
  | "performance" | "suppressions" | "commLogs"
  | "docTemplates" | "landingPages";

type Key = CmPage;

export type CmItem = { key: CmPage; label: string; icon: IconName };
type Item = CmItem;

export type CmGroup = { label: string; items: CmItem[] };
type Group = CmGroup;

const MARKETING: Item[] = [
  { key: "upload",        label: "Upload Raw Data",           icon: "upload" },
  { key: "lists",         label: "Manage List",               icon: "users" },
  { key: "whatsappFlow",  label: "WhatsApp Flow",             icon: "whatsapp" },
  { key: "automation",    label: "Manage Automation",         icon: "flow" },
  { key: "callLogs",      label: "In-App Call Logs",          icon: "send" },
  { key: "commLogs",      label: "Manage Communication Log",  icon: "inbox" },
  { key: "performance",   label: "Communication Performance", icon: "chart" },
  { key: "suppressions",  label: "Suppressions",              icon: "alert" },
];

const TEMPLATES: Item[] = [
  { key: "docTemplates",   label: "Manage Document Templates", icon: "doc" },
  { key: "landingPages",   label: "Manage Landing Pages", icon: "grid" },
];

/** Page keys + labels, grouped. The VSAT admin panel builds its rail from this: one source of names. */
export const CM_GROUPS: Group[] = [
  { label: "Marketing", items: MARKETING },
  { label: "Template Manager", items: TEMPLATES },
];

const GROUPS = CM_GROUPS;
const ALL_ITEMS = GROUPS.flatMap((g) => g.items);

/**
 * Embedded mode (`page` given): only the page itself renders. The host rail does the navigation,
 * so there is no own sidebar, menu search or mobile header. Pages that link to another page
 * (e.g. Manage List → Upload Raw Data) call `onNavigate`. Standalone mode (no `page`) is unchanged.
 */
export function CommunicationManager({ page, onNavigate }: { page?: CmPage; onNavigate?: (k: CmPage) => void }) {
  if (!page) return <CommunicationShell />;
  return (
    // `dark`: the VSAT panel is always dark, so the module's theme tokens must resolve to dark inside it
    <div className="dark min-h-full bg-background text-foreground">
      <div role="note" className="border-b border-border bg-surface px-4 py-2 sm:px-6 lg:px-8">
        <span className="inline-flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-wider text-muted">
          {isLivePage(page) ? (
            <>
              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-[#4ade80]" />Live data
              <span className="font-body text-xs font-normal normal-case tracking-normal">— {liveNote(page)}</span>
            </>
          ) : (
            <>
              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-primary" />Sample data
              <span className="font-body text-xs font-normal normal-case tracking-normal">— this page is not connected to live data yet.</span>
            </>
          )}
        </span>
      </div>
      <main className="mx-auto w-full max-w-[1500px] px-4 py-6 sm:px-6 lg:px-8">
        <Section active={page} go={onNavigate ?? (() => {})} />
      </main>
    </div>
  );
}

function CommunicationShell() {
  const [active, setActive] = useState<Key>("lists");
  const [menuQuery, setMenuQuery] = useState("");
  const [openGroups, setOpenGroups] = useState<string[]>(() => GROUPS.map((g) => g.label));
  const [navOpen, setNavOpen] = useState(false);

  const current = ALL_ITEMS.find((i) => i.key === active)!;
  const q = menuQuery.trim().toLowerCase();
  const groups = GROUPS
    .map((g) => ({ ...g, items: g.items.filter((i) => !q || i.label.toLowerCase().includes(q)) }))
    .filter((g) => g.items.length > 0);

  const go = (k: Key) => { setActive(k); setNavOpen(false); };

  return (
    <div
      className="flex min-h-[calc(100vh-var(--cm-top))] bg-background"
      style={{ ["--cm-top" as string]: "64px" }}
    >
      {/* ── sidebar ─────────────────────────────────── */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-[264px] shrink-0 overflow-y-auto border-r border-border bg-surface transition-transform lg:sticky lg:top-[var(--cm-top)] lg:z-auto lg:h-[calc(100vh-var(--cm-top))] lg:translate-x-0 ${
          navOpen ? "translate-x-0" : "-translate-x-full"}`}
      >
        <div className="flex items-center gap-2.5 border-b border-border px-4 py-4">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-gradient font-display text-sm font-extrabold text-white">V</span>
          <div className="min-w-0">
            <p className="truncate font-display text-sm font-extrabold text-heading">Communication</p>
            <p className="font-mono text-[10px] uppercase tracking-widest text-muted">manager</p>
          </div>
          <button onClick={() => setNavOpen(false)} aria-label="Close menu"
            className="ml-auto grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-surface-warm lg:hidden">
            <Icon name="close" className="h-4 w-4" />
          </button>
        </div>

        <div className="px-3 py-3">
          <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2">
            <Icon name="search" className="h-3.5 w-3.5 shrink-0 text-muted" />
            <input value={menuQuery} onChange={(e) => setMenuQuery(e.target.value)} placeholder="Search for menu"
              className="w-full bg-transparent font-body text-sm text-foreground outline-none placeholder:text-muted" />
          </div>
        </div>

        <nav className="px-3 pb-6">
          {groups.map((g) => {
            // a menu search auto-opens every group that still has matches
            const open = q.length > 0 || openGroups.includes(g.label);
            const hasActive = g.items.some((i) => i.key === active);
            return (
              <div key={g.label} className="mb-1.5">
                <button
                  onClick={() => setOpenGroups((o) => (o.includes(g.label) ? o.filter((x) => x !== g.label) : [...o, g.label]))}
                  aria-expanded={open}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-surface-warm/50">
                  <span className={`flex-1 font-mono text-[10px] font-semibold uppercase tracking-widest ${hasActive ? "text-accent" : "text-muted"}`}>
                    {g.label}
                  </span>
                  <span className="rounded-full bg-surface-warm px-1.5 py-0.5 font-mono text-[9px] font-bold text-muted">{g.items.length}</span>
                  <Icon name="chevronDown" className={`h-3.5 w-3.5 shrink-0 text-muted transition-transform ${open ? "" : "-rotate-90"}`} />
                </button>
                {open && (
                  <div className="mt-0.5 space-y-0.5">
                    {g.items.map((i) => {
                      const on = i.key === active;
                      return (
                        <button key={i.key} onClick={() => go(i.key)}
                          className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left font-body text-sm transition-colors ${
                            on ? "bg-surface-warm font-semibold text-heading" : "text-muted hover:bg-surface-warm/60 hover:text-foreground"}`}>
                          <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-md ${on ? "bg-brand-gradient text-white" : "text-muted"}`}>
                            <Icon name={i.icon} className="h-3.5 w-3.5" />
                          </span>
                          <span className="min-w-0 flex-1 truncate">{i.label}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
          {groups.length === 0 && <p className="px-2.5 py-3 font-body text-sm text-muted">No menu item matches.</p>}
        </nav>
      </aside>

      {navOpen && <button aria-label="Close menu" onClick={() => setNavOpen(false)} className="fixed inset-0 z-30 bg-black/50 lg:hidden" />}

      {/* ── content ─────────────────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-[var(--cm-top)] z-20 flex items-center gap-3 border-b border-border bg-background/85 px-4 py-3 backdrop-blur lg:hidden">
          <button onClick={() => setNavOpen(true)} aria-label="Open menu"
            className="grid h-9 w-9 place-items-center rounded-lg border border-border text-foreground">
            <Icon name="dots" className="h-4 w-4" />
          </button>
          <span className="truncate font-display text-base font-extrabold text-heading">{current.label}</span>
        </header>

        <main className="mx-auto w-full max-w-[1500px] flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <Section active={active} go={go} />
        </main>
      </div>
    </div>
  );
}

function Section({ active, go }: { active: Key; go: (k: Key) => void }) {
  switch (active) {
    case "lists": return <ManageList onNavigate={go} />;
    case "whatsappFlow": return <WhatsappFlow />;
    case "callLogs": return <CallLogs />;
    case "commLogs": return <CommunicationLogs />;
    case "automation": return <ManageAutomation />;
    case "suppressions": return <Suppressions />;
    case "upload": return uploadView() === "static-import" ? <StaticListImport onOpenLists={() => go("lists")} /> : <UploadRawData />;
    case "performance": return <CommunicationPerformance />;
    case "docTemplates": return <DocumentTemplates />;
    case "landingPages": return <LandingTemplates />;
  }
}


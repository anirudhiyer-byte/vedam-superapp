/**
 * Communication Manager · which pages read LIVE data.
 * true  = the page uses the real database through /api/admin/comm/* (admin only).
 * false = the page shows the built-in sample data from mock-api.ts (the fallback).
 * Every page not listed here stays on sample data.
 */
/**
 * Slice 3b · Upload Raw Data creates a STATIC list from a CSV (match-only: user ids of existing VSAT users).
 * Off = the page is the old sample-data upload wizard, exactly as before. Needs migration 0065.
 */
export const STATIC_LIST_IMPORT = true;

/**
 * Slice 4 · Manage Document Templates on live data: create / edit / delete templates (safe HTML subset,
 * cleaned on the server). Off = the page is the old sample-data page, exactly as before. Needs migration 0066.
 */
export const DOC_TEMPLATES_LIVE = true;

/**
 * Slice 8 · Manage Automation on live data, READ-ONLY: the automations of the two existing engines
 * (WhatsApp automations + journeys). Create / edit / pause / delete say "not available on live data yet".
 * Off = the page is the old sample-data page, exactly as before. Needs migration 0067.
 */
export const AUTOMATION_LIVE = true;

/**
 * Slice 6 · WhatsApp Flow on live data: create / duplicate / delete / preview DRAFT flows (page + writes together).
 * Nothing is sent and nothing is published to Meta / WhatsApp; Activate / Deactivate say "not available on live data yet".
 * The two Recommended flows stay in the app's code. Off = the page is the old sample-data page, exactly as before. Needs migration 0069.
 */
export const FLOWS_LIVE = true;

export const LIVE_PAGES = {
  commLogs: true,      // Slice 1 · read-only
  performance: true,   // Slice 1 · read-only
  suppressions: true,  // Slice 1 · read-only
  lists: true,         // Slice 3a · saved filters on VSAT data: counts + masked sample, no sending
  upload: STATIC_LIST_IMPORT, // Slice 3b · CSV → static list (behind the flag above)
  docTemplates: DOC_TEMPLATES_LIVE, // Slice 4 · document templates (behind the flag above)
  automation: AUTOMATION_LIVE, // Slice 8 · read-only list of the existing automations (behind the flag above)
  whatsappFlow: FLOWS_LIVE,    // Slice 6 · flow drafts saved in the database (behind the flag above)
} as const;

/**
 * Live pages that may also WRITE. Off = the page stays read-only and Add / Remove say
 * "This action is not available on live data yet." (exactly as before).
 */
export const LIVE_WRITES = {
  suppressions: true, // Slice 2 · add one contact / remove a manual entry (needs migration 0064)
} as const;

/** the short note next to "Live data" in the banner */
export const LIVE_NOTES: Record<string, string> = {
  lists: "counts and masked samples only, nothing is sent.",
  upload: "CSV → static list: only users already in VSAT are saved (user ids only).",
  docTemplates: "templates are cleaned on the server; the preview uses fake sample data only.",
  automation: "read-only: create, edit, pause and delete are not available yet.",
  whatsappFlow: "saved as drafts only, nothing is sent or published.",
};

/** the note when that page can also write (its LIVE_WRITES flag is on) */
export const LIVE_WRITE_NOTES: Record<string, string> = {
  suppressions: "add and remove enabled (one contact at a time).",
};

export const isLivePage = (page: string): boolean => (LIVE_PAGES as Record<string, boolean>)[page] === true;
/** `writes` is only passed by tests; the app always uses LIVE_WRITES */
export const canWriteLive = (page: string, writes: Record<string, boolean> = LIVE_WRITES): boolean => isLivePage(page) && writes[page] === true;
export const liveNote = (page: string, writes: Record<string, boolean> = LIVE_WRITES): string =>
  (canWriteLive(page, writes) ? LIVE_WRITE_NOTES[page] : undefined) ?? LIVE_NOTES[page] ?? "read-only for now.";

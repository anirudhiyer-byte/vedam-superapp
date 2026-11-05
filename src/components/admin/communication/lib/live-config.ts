/**
 * Communication Manager · which pages read LIVE data.
 * true  = the page uses the real database through /api/admin/comm/* (admin only).
 * false = the page shows the built-in sample data from mock-api.ts (the fallback).
 * Every page not listed here stays on sample data.
 */
export const LIVE_PAGES = {
  commLogs: true,      // Slice 1 · read-only
  performance: true,   // Slice 1 · read-only
  suppressions: true,  // Slice 1 · read-only
  lists: true,         // Slice 3a · saved filters on VSAT data: counts + masked sample, no sending
} as const;

/** the short note next to "Live data" in the banner */
export const LIVE_NOTES: Record<string, string> = {
  lists: "counts and masked samples only, nothing is sent.",
};

export const isLivePage = (page: string): boolean => (LIVE_PAGES as Record<string, boolean>)[page] === true;
export const liveNote = (page: string): string => LIVE_NOTES[page] ?? "read-only for now.";

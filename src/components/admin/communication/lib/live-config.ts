/**
 * Communication Manager · which pages read LIVE data (read-only, Slice 1).
 * true  = the page reads the real database through /api/admin/comm/* (admin only).
 * false = the page shows the built-in sample data from mock-api.ts (the fallback).
 * Every page not listed here stays on sample data.
 */
export const LIVE_PAGES = {
  commLogs: true,
  performance: true,
  suppressions: true,
} as const;

export const isLivePage = (page: string): boolean => (LIVE_PAGES as Record<string, boolean>)[page] === true;

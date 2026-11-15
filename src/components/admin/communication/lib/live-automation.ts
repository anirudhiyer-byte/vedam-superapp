/**
 * Communication Manager · LIVE Manage Automation (Slice 8, READ-ONLY).
 *
 * One GET (/api/admin/comm/automation → comm_automation_list) brings every automation of the two existing
 * engines: WhatsApp automations (whatsapp_automations) and journeys (comms_journeys). Search, filters, sort,
 * paging, the status tiles and the filter options are all worked out here in the browser (both tables are small;
 * the database caps each engine at 500 rows).
 *
 * Same method names and shapes as the sample-data `automationsApi` in mock-api.ts, so the page barely changes.
 * Every write (create, edit, pause, activate, de-activate, delete, copy, performance) throws
 * "This action is not available on live data yet." and sends nothing.
 */
import type { AutomationDetail, AutomationRow, CommLogRow, NewAutomation, Option, Page, Query } from "./types";
import { AUTOMATION_LIVE } from "./live-config";
import { apiGet } from "./live-api";
import { fmtNow, fmtStamp } from "./live-map";

export const AUTOMATION_NOT_LIVE = "This action is not available on live data yet.";

/** which Manage Automation page cm-shell / the page use */
export const automationView = (): "live" | "mock" => (AUTOMATION_LIVE ? "live" : "mock");

// ── what the route returns (field names from comm_automation_list, migration 0067) ──
export type LiveAutomation = {
  engine: "whatsapp" | "journey";
  id: string;
  name: string;
  enabled: boolean;
  channel: "whatsapp" | "email" | "other";
  trigger: "event_before" | "event_after" | "scheduled" | "conditions" | "other";
  product: string | null;
  created_at: string | null;
  last_run_at: string | null;
  runs: number;
  last_sent: number | null;
  last_failed: number | null;
  last_status: "never" | "sent" | "partial" | "failed" | "none" | "fired";
};
export type LiveAutomationList = { total: number; truncated: boolean; rows: LiveAutomation[] };

type Status = AutomationRow["status"];
export type AutomationCounts = Record<Status, number> & { total: number; used: number; quota: number };

const STATUSES: Status[] = ["Active", "Draft", "Pause", "Completed", "Stopped"];
const TRIGGER: Record<string, string> = {
  event_before: "Before an event", event_after: "After an event", scheduled: "Scheduled", conditions: "Audience conditions",
};
/** who the engine sends to (from the cron code: scheduled → all users, event → that event's registrants, journey → all users) */
const AUDIENCE: Record<string, string> = {
  event_before: "Event registrants", event_after: "Event registrants", scheduled: "All users", conditions: "All users",
};
const CHANNEL: Record<string, string> = { whatsapp: "WhatsApp", email: "Email" };

/**
 * The status rule. Enabled and the end date not passed (or no end date) → Active; enabled but the end date has
 * passed → Completed; disabled → Pause. Neither table has an end date today, so live rows are Active or Pause.
 */
export function automationStatus(enabled: boolean, endAt: string | null, now: Date = new Date()): Status {
  if (!enabled) return "Pause";
  const end = endAt ? new Date(endAt).getTime() : NaN;
  return Number.isFinite(end) && end <= now.getTime() ? "Completed" : "Active";
}

/** a whole number ≥ 0, or null for anything else */
const count = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null);

/** "2026-11-01 14:45" → "01/11/2026 02:45 PM" (the format the sample rows use) */
function fmtCreated(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(fmtStamp(iso));
  if (!m) return "-";
  const h = Number(m[4]);
  return `${m[3]}/${m[2]}/${m[1]} ${String(h % 12 === 0 ? 12 : h % 12).padStart(2, "0")}:${m[5]} ${h >= 12 ? "PM" : "AM"}`;
}
/** "01/11/2026 02:45 PM" → "2026-11-01 14:45" (sortable), "" when not a date */
function stampOf(text: string): string {
  const m = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}) (AM|PM)$/.exec(text);
  if (!m) return "";
  const h = (Number(m[4]) % 12) + (m[6] === "PM" ? 12 : 0);
  return `${m[3]}-${m[2]}-${m[1]} ${String(h).padStart(2, "0")}:${m[5]}`;
}

function lastRunText(x: LiveAutomation): string {
  if (x.last_status === "never") return "Never";
  const when = x.last_run_at ? fmtCreated(x.last_run_at) : "-";
  let what = "";
  if (x.engine === "journey") {
    const n = count(x.runs);
    if (n !== null) what = `${n} ${n === 1 ? "message" : "messages"} so far`;
  } else {
    const sent = count(x.last_sent), failed = count(x.last_failed);
    if (sent !== null || failed !== null) {
      const parts = [sent ? `${sent} sent` : "", failed ? `${failed} failed` : ""].filter(Boolean);
      what = parts.length ? parts.join(", ") : "nobody to send to";
    }
  }
  if (when === "-") return what || "Never";
  return what ? `${when} · ${what}` : when;
}

/** live rows → the screen's rows. Only whitelisted fields are copied; ids are short ("W-5011eb15"), full when two would clash. */
export function toAutomationRows(list: LiveAutomation[], now: Date = new Date()): AutomationRow[] {
  const prefix = (x: LiveAutomation) => (x.engine === "journey" ? "J" : "W");
  const short = (x: LiveAutomation) => `${prefix(x)}-${String(x.id).slice(0, 8)}`;
  const seen = new Map<string, number>();
  for (const x of list) seen.set(short(x), (seen.get(short(x)) ?? 0) + 1);
  return list.map((x) => {
    const product = x.engine === "journey" && typeof x.product === "string" && x.product ? x.product : null;
    return {
      id: (seen.get(short(x)) ?? 0) > 1 ? `${prefix(x)}-${String(x.id)}` : short(x),
      name: String(x.name ?? ""),
      module: `${x.engine === "journey" ? "Journey" : "Automation"} · ${CHANNEL[x.channel] ?? "Other"}`,
      list: AUDIENCE[x.trigger] ?? "-",
      trigger: TRIGGER[x.trigger] ?? "Other",
      createdOn: fmtCreated(x.created_at),
      createdBy: "-",
      startDate: "-",
      endDate: "-",
      status: automationStatus(x.enabled === true, null, now),
      tags: product ? [product] : [],
      lastRun: lastRunText(x),
    };
  });
}

// ── client-side query (same rules as the sample data) ──
const day = (text: string) => stampOf(text).slice(0, 10);
const inRange = (d: string, v: string) => {
  if (!d) return false;
  const [from, to] = v.includes("..") ? v.split("..") : [v, v];
  return (!from || d >= from) && (!to || d <= to);
};
const FILTERS: Record<string, (r: AutomationRow, v: string) => boolean> = {
  status: (r, v) => r.status === v,
  module: (r, v) => r.module === v,
  list: (r, v) => r.list === v,
  trigger: (r, v) => r.trigger === v,
  createdBy: (r, v) => r.createdBy === v,
  tags: (r, v) => !!r.tags?.includes(v),
  createdOn: (r, v) => inRange(day(r.createdOn), v),
  startDate: (r, v) => inRange(day(r.startDate), v),
  endDate: (r, v) => inRange(day(r.endDate), v),
};
const SEARCH: (keyof AutomationRow)[] = ["name", "id", "trigger"];
const DATE_KEYS = new Set(["createdOn", "startDate", "endDate"]);

function matching(rows: AutomationRow[], q: Query, skip?: string): AutomationRow[] {
  const s = q.search?.trim().toLowerCase();
  let out = s ? rows.filter((r) => SEARCH.some((k) => String(r[k] ?? "").toLowerCase().includes(s))) : [...rows];
  for (const [k, v] of Object.entries(q.filters ?? {})) {
    if (!v || k === skip) continue;
    const fn = FILTERS[k];
    out = fn ? out.filter((r) => fn(r, v)) : [];   // an unknown filter matches nothing (never ignored silently)
  }
  return out;
}

export function queryAutomations(rows: AutomationRow[], q: Query): Page<AutomationRow> {
  const out = matching(rows, q);
  const key = (q.sortKey ?? "createdOn") as keyof AutomationRow;
  const dir = q.sortKey ? (q.sortDir === "desc" ? -1 : 1) : -1;   // default: newest first
  const val = (r: AutomationRow) => (DATE_KEYS.has(String(key)) ? stampOf(String(r[key] ?? "")) : String(r[key] ?? ""));
  out.sort((a, b) => {
    const x = val(a), y = val(b);
    if (!x && y) return 1;
    if (x && !y) return -1;
    return x.localeCompare(y) * dir;
  });
  const page = q.page ?? 1;
  const size = q.pageSize ?? out.length;
  return { rows: out.slice((page - 1) * size, page * size), total: out.length, refreshedAt: fmtNow() };
}

/** status tiles: follow the search and every filter except Status. Draft / Stopped never occur on live data (always 0). */
export function automationCounts(rows: AutomationRow[], q: Query): AutomationCounts {
  const all = matching(rows, q, "status");
  const c = Object.fromEntries(STATUSES.map((s) => [s, all.filter((r) => r.status === s).length])) as Record<Status, number>;
  // live data has no quota: `used` / `quota` are not shown on the live page
  return { ...c, total: all.length, used: rows.length, quota: 0 };
}

export function automationOptions(rows: AutomationRow[]): Record<string, Option[]> {
  const uniq = (xs: string[]) => [...new Set(xs.filter((x) => x && x !== "-"))].sort((a, b) => a.localeCompare(b)).map((v) => ({ value: v, label: v }));
  return {
    status: STATUSES.map((v) => ({ value: v, label: v })),
    module: uniq(rows.map((r) => r.module)),
    list: uniq(rows.map((r) => r.list)),
    trigger: uniq(rows.map((r) => r.trigger)),
    createdBy: [],
    tags: uniq(rows.flatMap((r) => r.tags ?? [])),
  };
}

// ── the live client: one GET, kept for a minute (Refresh / Try again forget it first) ──
const KEEP_MS = 60_000;
let cache: { at: number; rows: AutomationRow[] } | null = null;
let inflight: Promise<AutomationRow[]> | null = null;

function load(): Promise<AutomationRow[]> {
  if (inflight) return inflight;
  if (cache && Date.now() - cache.at < KEEP_MS) return Promise.resolve(cache.rows);
  inflight = apiGet<LiveAutomationList>("automation")
    .then((d) => {
      const rows = toAutomationRows(Array.isArray(d?.rows) ? d.rows : []);
      cache = { at: Date.now(), rows };
      return rows;
    })
    .finally(() => { inflight = null; });
  return inflight;
}

/** Refresh / Try again: the next call asks the server again */
export function forgetLiveAutomations() { cache = null; }

const notLive = async (..._args: unknown[]): Promise<never> => { void _args; throw new Error(AUTOMATION_NOT_LIVE); };

export const liveAutomationsApi = {
  list: async (q: Query): Promise<Page<AutomationRow>> => {
    const rows = await load();
    return { ...queryAutomations(rows, q), refreshedAt: fmtNow(new Date(cache?.at ?? Date.now())) };
  },
  counts: async (q: Query): Promise<AutomationCounts> => automationCounts(await load(), q),
  options: async (): Promise<Record<string, Option[]>> => automationOptions(await load()),
  get: (id: string): Promise<AutomationDetail> => notLive(id),
  setStatus: (ids: string[], status: "Active" | "Pause" | "Stopped"): Promise<{ ok: boolean; changed: number; skipped: number }> => notLive(ids, status),
  remove: (ids: string[]): Promise<{ ok: boolean; removed: number }> => notLive(ids),
  create: (p: NewAutomation): Promise<AutomationRow> => notLive(p),
  rename: (id: string, name: string): Promise<AutomationRow> => notLive(id, name),
  publish: (id: string): Promise<AutomationRow> => notLive(id),
  duplicate: (id: string): Promise<AutomationRow> => notLive(id),
  logs: (id: string, q: Query): Promise<Page<CommLogRow>> => notLive(id, q),
  /** tests and Refresh: drop the kept answer */
  forget: forgetLiveAutomations,
};

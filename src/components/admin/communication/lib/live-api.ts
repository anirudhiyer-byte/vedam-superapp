/**
 * Communication Manager · LIVE data for Slice 1 (read-only):
 * Communication Logs, Communication Performance, Suppressions.
 *
 * Same method names and return shapes as the sample-data APIs in mock-api.ts, so no screen changes.
 * Talks only to /api/admin/comm/* (admin-only GET routes); never to Supabase directly.
 * Writes (close a job, add/remove a suppression) are not part of this slice and say so clearly.
 */
import type { CommDetailRow, CommLogRow, CommPreview, CommStats, Option, Page, PerformanceSummary, Query, StatusDetailRow, SuppressionRow } from "./types";
import {
  fmtNow, logsParams, performanceParams, recipientParams, suppressionParams, toCommLogRow, toDetailRow, toPerformance, toStats,
  toStatusDetail, toSuppressionRow, type LiveFailure, type LiveJob, type LivePerformance, type LiveRecipient, type LiveSuppression,
} from "./live-map";

const BASE = "/api/admin/comm";
/** Export ("all rows") pages through the server 100 at a time, at most this many rows. */
export const EXPORT_MAX_ROWS = 2000;
const NOT_LIVE_YET = "This action is not available on live data yet.";

const MESSAGES: Record<string, string> = {
  NOT_LOGGED_IN: "Your session has expired. Log in again.",
  FORBIDDEN: "You do not have access to this data.",
  RATE_LIMITED: "Too many requests. Wait a minute and try again.",
  RANGE_TOO_LONG: "Pick a date range of 90 days or less.",
  INVALID: "Some filters are not valid. Clear them and try again.",
  NOT_FOUND: "This communication was not found. It may have been removed.",
};
const GENERIC = "Could not load the data. Try again.";

const indiaToday = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

async function get<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
  const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString();
  let res: Response;
  let body: { ok?: boolean; code?: string; data?: unknown } | null = null;
  try {
    res = await fetch(`${BASE}/${path}${qs ? `?${qs}` : ""}`, { credentials: "same-origin", cache: "no-store", headers: { accept: "application/json" } });
  } catch {
    throw new Error(GENERIC);
  }
  try { body = await res.json(); } catch { body = null; }
  if (!res.ok || !body?.ok) throw new Error((body?.code && MESSAGES[body.code]) || GENERIC);
  return body.data as T;
}

type Rows<T> = { total: number; rows: T[] };

/** One page, or (no page size = export) every page up to EXPORT_MAX_ROWS. */
async function paged<T>(path: string, params: Record<string, string | number>, q: Query): Promise<Rows<T>> {
  if (q.pageSize) return get<Rows<T>>(path, params);
  const all: T[] = [];
  let total = 0;
  for (let page = 1; all.length < EXPORT_MAX_ROWS; page++) {
    const r = await get<Rows<T>>(path, { ...params, page, size: 100 });
    total = r.total;
    all.push(...r.rows);
    if (r.rows.length < 100 || all.length >= total) break;
  }
  return { total, rows: all.slice(0, EXPORT_MAX_ROWS) };
}

// one job is needed by the preview, list name and detailed report; keep it for a minute
const jobCache = new Map<string, { at: number; job: LiveJob; subject: string | null }>();
async function getJob(id: string, fresh = false) {
  const c = jobCache.get(id);
  if (!fresh && c && Date.now() - c.at < 60_000) return c;
  const r = await get<{ job: LiveJob; subject: string | null }>(`logs/${encodeURIComponent(id)}`);
  const v = { at: Date.now(), job: r.job, subject: r.subject };
  jobCache.set(id, v);
  return v;
}

const opt = (v: string): Option => ({ value: v, label: v });

export const liveCommLogsApi = {
  list: async (q: Query): Promise<Page<CommLogRow>> => {
    // the (sample-data) automation pages ask for an automation's jobs; live data has none yet
    if (q.filters?.automationId) return { rows: [], total: 0, refreshedAt: fmtNow() };
    const r = await paged<LiveJob>("logs", logsParams(q, indiaToday()), q);
    return { rows: r.rows.map(toCommLogRow), total: r.total, refreshedAt: fmtNow() };
  },
  options: async (): Promise<Record<string, Option[]>> => {
    const r = await get<{ templates: string[] }>("logs/options");
    return {
      form: [], voiceType: [], commFor: [], sentBy: [], engagement: [], leadsType: [], listName: [], campaignType: [],
      channel: [{ value: "email", label: "Email" }, { value: "whatsapp", label: "Whatsapp" }],
      template: (r.templates ?? []).map(opt),
      nature: ["Single User", "Bulk"].map((v) => ({ value: v, label: `${v} Communication` })),
      status: ["Scheduled", "In Progress", "Completed", "Closed", "Undelivered", "Failed"].map(opt),
    };
  },
  preview: async (id: string): Promise<CommPreview> => {
    const { job, subject } = await getJob(id);
    const kind = job.channel === "email" ? "email" : "whatsapp";
    return {
      kind, title: job.template?.trim() ? job.template : (job.name ?? "Message"), version: 1, subject: subject ?? undefined,
      lines: ["The message text is kept by the sending service, so it is not shown here yet."],
    };
  },
  statusDetail: async (id: string): Promise<StatusDetailRow[]> =>
    toStatusDetail(await get<LiveFailure[]>(`logs/${encodeURIComponent(id)}/failures`)),
  listLabels: async (id: string): Promise<string[]> => {
    const { job } = await getJob(id);
    return [job.audience?.trim() ? job.audience : "-"];
  },
  detail: async (id: string, q: Query): Promise<Page<CommDetailRow>> => {
    const { job } = await getJob(id);
    const r = await paged<LiveRecipient>(`logs/${encodeURIComponent(id)}/recipients`, recipientParams(q, indiaToday()), q);
    return { rows: r.rows.map((x) => toDetailRow(x, job)), total: r.total, refreshedAt: fmtNow() };
  },
  detailStats: async (id: string): Promise<CommStats> => toStats((await getJob(id, true)).job),
  close: async (id: string): Promise<CommLogRow> => { void id; throw new Error(NOT_LIVE_YET); },
};

export const livePerformanceApi = {
  summary: async (q: Query): Promise<PerformanceSummary> =>
    toPerformance(await get<LivePerformance>("performance", performanceParams(q, indiaToday()))),
  options: async (): Promise<Record<string, Option[]>> => {
    const r = await get<{ templates: string[] }>("logs/options");
    return {
      channel: [{ value: "whatsapp", label: "WhatsApp" }, { value: "email", label: "Email" }],
      template: (r.templates ?? []).map(opt),
      sentBy: [], commFor: [],
    };
  },
};

export const liveSuppressionsApi = {
  list: async (q: Query): Promise<Page<SuppressionRow>> => {
    const r = await paged<LiveSuppression>("suppressions", suppressionParams(q, indiaToday()), q);
    return { rows: r.rows.map(toSuppressionRow), total: r.total, refreshedAt: fmtNow() };
  },
  counts: async (channel: string, search?: string, addedDate?: string) => {
    const p = suppressionParams({ search, filters: { channel, ...(addedDate ? { addedDate } : {}) } }, indiaToday());
    return get<Record<SuppressionRow["reason"], number>>("suppressions/counts", p);
  },
  add: async (channel: "Email" | "WhatsApp", contacts: string[], reason: SuppressionRow["reason"]): Promise<{ ok: boolean; added: number; duplicates: number }> => {
    void channel; void contacts; void reason;
    throw new Error(NOT_LIVE_YET);
  },
  remove: async (ids: string[]): Promise<{ ok: boolean; removed: number }> => { void ids; throw new Error(NOT_LIVE_YET); },
};

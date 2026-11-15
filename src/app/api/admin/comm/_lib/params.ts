/**
 * Communication Manager · query-string rules for the read-only /api/admin/comm/* routes.
 * Pure (no I/O), unit-tested. Every schema is strict: an unknown key is an error, not ignored.
 */
import { z } from "zod";

export const MAX_DAYS = 90;
export const MAX_PAGE = 10_000;
export const MAX_PAGE_SIZE = 100;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const isRealDay = (s: string) => {
  if (!DAY_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

const day = z.string().refine(isRealDay, "date must be YYYY-MM-DD");
/** whole positive number written plainly ("10"), never "1e2", "10.5", " 10" or "-1" */
const int = (min: number, max: number) =>
  z.string().regex(/^\d{1,6}$/).transform(Number).pipe(z.number().int().min(min).max(max));
const text = (max: number) => z.string().min(1).max(max).refine((s) => s.trim().length > 0, "blank");

const page = int(1, MAX_PAGE);
const size = int(1, MAX_PAGE_SIZE);
const dir = z.enum(["asc", "desc"]);
const range = { from: day.optional(), to: day.optional() };

export const LOG_STATUSES = ["Scheduled", "In Progress", "Completed", "Closed", "Undelivered", "Failed"] as const;
export const RECIPIENT_STATUSES = ["Sent", "Delivered", "Read", "Clicked", "Failed"] as const;
export const SUP_REASONS = ["Unsubscribe", "Bounce", "Block", "Spam", "Invalid"] as const;

export const logsQuery = z.object({
  ...range,
  channel: z.enum(["email", "whatsapp"]).optional(),
  status: z.enum(LOG_STATUSES).optional(),
  template: text(200).optional(),
  nature: z.enum(["Bulk", "Single User"]).optional(),
  campaign: text(100).optional(),
  search: text(100).optional(),
  sort: z.enum(["startDate", "targeted", "delivered", "template", "status", "jobId", "channel"]).optional(),
  dir: dir.optional(),
  page: page.optional(),
  size: size.optional(),
}).strict();

export const rangeQuery = z.object(range).strict();
export const emptyQuery = z.object({}).strict();

export const recipientsQuery = z.object({
  ...range,
  status: z.enum(RECIPIENT_STATUSES).optional(),
  search: text(100).optional(),
  sort: z.enum(["date", "status", "contact"]).optional(),
  dir: dir.optional(),
  page: page.optional(),
  size: size.optional(),
}).strict();

export const performanceQuery = z.object({
  ...range,
  channel: z.enum(["email", "whatsapp"]).optional(),
  template: text(200).optional(),
}).strict();

export const suppressionsQuery = z.object({
  ...range,
  channel: z.enum(["Email", "WhatsApp"]),
  reason: z.enum(SUP_REASONS).optional(),
  search: text(100).optional(),
  sort: z.enum(["contact", "stamp", "keyword"]).optional(),
  dir: dir.optional(),
  page: page.optional(),
  size: size.optional(),
}).strict();

export const countsQuery = z.object({
  ...range,
  channel: z.enum(["Email", "WhatsApp"]),
  search: text(100).optional(),
}).strict();

export const idParam = z.string().uuid();

export type ParseResult<T> = { ok: true; data: T } | { ok: false };

/** URL query → validated object. A key given twice is refused (no "last one wins" tricks). */
export function parseQuery<S extends z.ZodTypeAny>(url: URL, schema: S): ParseResult<z.infer<S>> {
  const raw: Record<string, string> = {};
  for (const [k, v] of url.searchParams) {
    if (Object.prototype.hasOwnProperty.call(raw, k)) return { ok: false };
    raw[k] = v;
  }
  const r = schema.safeParse(raw);
  return r.success ? { ok: true, data: r.data } : { ok: false };
}

/** Today's date in India (YYYY-MM-DD). */
export function istToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const istStart = (ymd: string) => `${ymd}T00:00:00+05:30`;

export type RangeResult =
  | { ok: true; from: string | null; to: string | null }
  | { ok: false; code: "INVALID" | "RANGE_TOO_LONG" };

/**
 * India days [from, to] (both inclusive) → half-open timestamps [from 00:00 IST, (to + 1 day) 00:00 IST).
 * Both or neither. At most 90 days. With no dates: the last `defaultDays` days, or no range.
 */
export function toRange(from?: string, to?: string, opts: { defaultDays?: number; now?: Date } = {}): RangeResult {
  if (!from && !to) {
    if (!opts.defaultDays) return { ok: true, from: null, to: null };
    const end = istToday(opts.now);
    return { ok: true, from: istStart(addDays(end, -(opts.defaultDays - 1))), to: istStart(addDays(end, 1)) };
  }
  if (!from || !to || !isRealDay(from) || !isRealDay(to) || to < from) return { ok: false, code: "INVALID" };
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1;
  if (days > MAX_DAYS) return { ok: false, code: "RANGE_TOO_LONG" };
  return { ok: true, from: istStart(from), to: istStart(addDays(to, 1)) };
}

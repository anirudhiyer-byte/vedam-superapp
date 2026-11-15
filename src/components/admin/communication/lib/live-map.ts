/**
 * Communication Manager · live data → the exact shapes the screens already use (lib/types.ts).
 * Pure functions only (no fetch, no React), unit-tested in live-map.test.ts.
 * All dates are shown in India time, in the same text formats the sample data used.
 */
import type {
  Channel, CommDetailRow, CommLogRow, CommStats, CommStatus, PerformanceSummary, Query, StatusDetailRow, SuppressionRow,
} from "./types";

// ── what the /api/admin/comm/* routes return (field names from the comm_* database functions) ──
export type LiveJob = {
  id: string; channel: string; name: string | null; kind: string | null; template: string | null; audience: string | null;
  recipient_count: number; created_at: string | null; scheduled_at: string | null; status: string;
  sent: number; delivered: number; read: number; clicked: number; failed: number;
};
export type LiveRecipient = { rid: string; channel: string; contact: string | null; sent_at: string | null; status: string };
export type LiveFailure = { rid: string; reason: string | null; at: string | null };
export type LiveSuppression = { id: string; contact: string | null; channel: "Email" | "WhatsApp"; reason: string; source: string | null; at: string | null };
export type LivePerformance = {
  basis: { matched: number; counted: number; scheduled: number; in_progress: number };
  totals: { sent: number; delivered: number; read: number; clicked: number; failed: number };
  by_channel: { channel: string; sent: number; delivered: number; read: number; clicked: number }[];
  by_day: { day: string; sent: number; delivered: number }[];
};

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LABEL: Record<Channel, string> = { email: "Email", whatsapp: "WhatsApp", amplify: "Amplify", sms: "SMS" };
const PREVIEW: Record<Channel, string> = { email: "Email", whatsapp: "Whatsapp", amplify: "Amplify", sms: "SMS" };
const CHANNELS: Channel[] = ["email", "whatsapp", "amplify", "sms"];
const STATUSES: CommStatus[] = ["Completed", "In Progress", "Failed", "Scheduled", "Closed", "Undelivered"];
const REASONS: SuppressionRow["reason"][] = ["Unsubscribe", "Bounce", "Block", "Spam", "Invalid"];
const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0);
const pad = (v: number) => String(v).padStart(2, "0");

const FMT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});
/** India-time parts of an ISO timestamp, or null when it is missing / not a date. */
function ist(iso: string | null | undefined) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const p = Object.fromEntries(FMT.formatToParts(d).map((x) => [x.type, x.value]));
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), h: Number(p.hour), mi: Number(p.minute) };
}
const h12 = (h: number) => (h % 12 === 0 ? 12 : h % 12);

/** "28 Sep, 26 2:39 PM" (Communication Logs start date) */
export function fmtStart(iso: string | null | undefined): string {
  const t = ist(iso);
  return t ? `${t.d} ${MON[t.m - 1]}, ${String(t.y).slice(2)} ${h12(t.h)}:${pad(t.mi)} ${t.h >= 12 ? "PM" : "AM"}` : "-";
}
/** "28 Sep 2026 02:39 pm" (Detailed Report, Status Detail) */
export function fmtLong(iso: string | null | undefined): string {
  const t = ist(iso);
  return t ? `${pad(t.d)} ${MON[t.m - 1]} ${t.y} ${pad(h12(t.h))}:${pad(t.mi)} ${t.h >= 12 ? "pm" : "am"}` : "-";
}
/** "30/09/2026, 02:44 pm" (Suppressions added on) */
export function fmtAdded(iso: string | null | undefined): string {
  const t = ist(iso);
  return t ? `${pad(t.d)}/${pad(t.m)}/${t.y}, ${pad(h12(t.h))}:${pad(t.mi)} ${t.h >= 12 ? "pm" : "am"}` : "-";
}
/** "2026-09-30 14:44" (sortable form) */
export function fmtStamp(iso: string | null | undefined): string {
  const t = ist(iso);
  return t ? `${t.y}-${pad(t.m)}-${pad(t.d)} ${pad(t.h)}:${pad(t.mi)}` : "";
}
/** "dd/mm/yyyy hh:mm am" — the "refreshed at" text */
export function fmtNow(now: Date = new Date()): string {
  const t = ist(now.toISOString())!;
  return `${pad(t.d)}/${pad(t.m)}/${t.y} ${pad(h12(t.h))}:${pad(t.mi)} ${t.h >= 12 ? "pm" : "am"}`;
}
/** "+91 90000 00001"; anything that is not a 10–15 digit number is shown as stored. */
export function fmtPhone(raw: string | null | undefined): string {
  if (!raw) return "-";
  const d = raw.replace(/\D/g, "");
  if (d.length === 10) return `+91 ${d.slice(0, 5)} ${d.slice(5)}`;
  if (d.length > 10 && d.length <= 15) { const last = d.slice(-10); return `+${d.slice(0, d.length - 10)} ${last.slice(0, 5)} ${last.slice(5)}`; }
  return raw;
}
/** short, stable job code from the campaign id: "Job#5011EB15" */
export const jobCode = (id: string) => `Job#${id.replace(/-/g, "").slice(0, 8).toUpperCase()}`;

const channelOf = (c: string): Channel => (CHANNELS.includes(c as Channel) ? (c as Channel) : "whatsapp");

export function toCommLogRow(j: LiveJob): CommLogRow {
  const channel = channelOf(j.channel);
  const status = STATUSES.includes(j.status as CommStatus) ? (j.status as CommStatus) : "Completed";
  const open = status === "Scheduled" || status === "In Progress";
  const targeted = n(j.recipient_count) || n(j.sent);
  return {
    id: j.id, channel, jobId: jobCode(j.id), preview: PREVIEW[channel], previewNote: j.name ?? undefined,
    template: j.template?.trim() ? j.template : "-", status, statusInfo: n(j.failed) > 0 ? true : undefined,
    startDate: fmtStart(j.created_at), listName: j.audience?.trim() ? j.audience : "-", segmentName: "-",
    targeted, delivered: open ? null : n(j.delivered), automationId: "NA",
    campaignName: j.name ?? undefined, campaignType: j.kind ?? undefined, nature: targeted > 1 ? "Bulk" : "Single User",
    ...(open ? {} : { read: n(j.read), clicked: n(j.clicked) }),
  };
}

export function toDetailRow(r: LiveRecipient, j: LiveJob): CommDetailRow {
  const channel = channelOf(r.channel);
  const to = channel === "whatsapp" ? fmtPhone(r.contact) : (r.contact ?? "-");
  return {
    id: r.rid, automationId: "NA", jobId: jobCode(j.id).replace("Job#", ""), type: LABEL[channel], name: "-", moduleType: "Lead",
    listName: j.audience?.trim() ? j.audience : "NA", template: j.template?.trim() ? j.template : "NA", to, date: fmtLong(r.sent_at),
    conversationType: "-", region: channel === "whatsapp" && to.startsWith("+91 ") ? "(Domestic)+91-India" : "-", status: r.status,
  };
}

export const toStats = (j: LiveJob): CommStats => ({
  sent: n(j.sent), delivered: n(j.delivered), read: n(j.read), failed: n(j.failed), clicked: n(j.clicked), replied: 0, unsubscribed: 0, flowResponse: 0,
});

export const toStatusDetail = (rows: LiveFailure[]): StatusDetailRow[] =>
  rows.map((f) => ({ id: f.rid, status: f.reason?.trim() ? f.reason : "Failed", date: fmtLong(f.at) }));

export function toSuppressionRow(r: LiveSuppression): SuppressionRow {
  return {
    id: r.id, contact: r.channel === "WhatsApp" ? fmtPhone(r.contact) : (r.contact ?? "-"), channel: r.channel,
    reason: REASONS.includes(r.reason as SuppressionRow["reason"]) ? (r.reason as SuppressionRow["reason"]) : "Unsubscribe",
    source: r.source ?? "-", addedOn: fmtAdded(r.at), stamp: fmtStamp(r.at),
  };
}

/** Same bucketing as the sample screen: by month; by week (Monday start) when fewer than 3 months. */
export function toPerformance(p: LivePerformance, now: Date = new Date()): PerformanceSummary {
  const days = [...p.by_day].filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x.day)).sort((a, b) => a.day.localeCompare(b.day));
  const weekly = new Set(days.map((x) => x.day.slice(0, 7))).size < 3;
  const key = (d: string) => {
    if (!weekly) return d.slice(0, 7);
    const dt = new Date(`${d}T00:00:00Z`); dt.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7));
    return dt.toISOString().slice(0, 10);
  };
  const label = (k: string) => { const [y, m, d] = k.split("-"); return weekly ? `Wk ${Number(d)} ${MON[Number(m) - 1]}` : `${MON[Number(m) - 1]} ${y}`; };
  const buckets = new Map<string, { sent: number; delivered: number }>();
  for (const x of days) {
    const b = buckets.get(key(x.day)) ?? { sent: 0, delivered: 0 };
    b.sent += n(x.sent); b.delivered += n(x.delivered); buckets.set(key(x.day), b);
  }
  return {
    totals: { sent: n(p.totals?.sent), delivered: n(p.totals?.delivered), read: n(p.totals?.read), clicked: n(p.totals?.clicked), failed: n(p.totals?.failed) },
    byChannel: (p.by_channel ?? []).map((c) => ({ channel: LABEL[channelOf(c.channel)], sent: n(c.sent), delivered: n(c.delivered), read: n(c.read), clicked: n(c.clicked) })),
    trend: [...buckets.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([k, v]) => ({ label: label(k), ...v })),
    basis: { matched: n(p.basis?.matched), counted: n(p.basis?.counted), scheduled: n(p.basis?.scheduled), inProgress: n(p.basis?.in_progress), voice: 0 },
    refreshedAt: fmtNow(now),
  };
}

// ── Query → route params ──────────────────────────────────────────────────────
type Params = Record<string, string | number>;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const shift = (ymd: string, days: number) => { const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };

/** The screens' date filter ("a..b", "a", "a..", "..b") → from/to days. One open end is filled (today / 90 days back). */
export function dateRange(v: string | undefined, today: string): { from?: string; to?: string } {
  if (!v) return {};
  const [a, b] = v.includes("..") ? v.split("..") : [v, v];
  const from = DAY.test(a ?? "") ? a : undefined, to = DAY.test(b ?? "") ? b : undefined;
  if (from && to) return { from, to };
  if (from) return { from, to: today };
  if (to) return { from: shift(to, -89), to };
  return {};
}

function common(q: Query, sorts: Record<string, string>): Params {
  const out: Params = {};
  const s = q.search?.trim();
  if (s) out.search = s.slice(0, 100);
  if (q.page) out.page = q.page;
  if (q.pageSize) out.size = Math.min(q.pageSize, 100);
  const sort = q.sortKey ? sorts[q.sortKey] : undefined;
  if (sort) { out.sort = sort; out.dir = q.sortDir === "asc" ? "asc" : "desc"; }
  return out;
}
const pick = (v: string | undefined, allowed: readonly string[]) => (v && allowed.includes(v) ? v : undefined);
const put = (o: Params, k: string, v: string | undefined) => { if (v) o[k] = v; };

export function logsParams(q: Query, today: string): Params {
  const f = q.filters ?? {};
  const o = common(q, { jobId: "jobId", template: "template", status: "status", startDate: "startDate", targeted: "targeted", delivered: "delivered" });
  put(o, "channel", pick(f.channel, ["email", "whatsapp"]));
  put(o, "status", pick(f.status, STATUSES));
  put(o, "template", f.template?.trim() || undefined);
  put(o, "nature", pick(f.nature, ["Bulk", "Single User"]));
  put(o, "campaign", f.campaignName?.trim() || undefined);
  Object.assign(o, dateRange(f.startDate, today));
  return o;
}

export function performanceParams(q: Query, today: string): Params {
  const f = q.filters ?? {};
  const o: Params = {};
  put(o, "channel", pick(f.channel, ["email", "whatsapp"]));
  put(o, "template", f.template?.trim() || undefined);
  Object.assign(o, dateRange(f.startDate, today));
  return o;
}

export function recipientParams(q: Query, today: string): Params {
  const f = q.filters ?? {};
  const o = common(q, { date: "date", status: "status", to: "contact" });
  put(o, "status", pick(f.status, ["Sent", "Delivered", "Read", "Clicked", "Failed"]));
  Object.assign(o, dateRange(f.date, today));
  return o;
}

export function suppressionParams(q: Query, today: string): Params {
  const f = q.filters ?? {};
  const o: Params = { channel: f.channel === "WhatsApp" ? "WhatsApp" : "Email" };
  Object.assign(o, common(q, { contact: "contact", stamp: "stamp", keyword: "keyword" }));
  put(o, "reason", pick(f.reason, REASONS));
  Object.assign(o, dateRange(f.addedDate, today));
  return o;
}

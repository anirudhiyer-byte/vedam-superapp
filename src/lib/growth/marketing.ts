/**
 * Growth → Ads + Influencers (migration 0105) · pure helpers for the listing and performance screens.
 *
 * The database decides every number (growth_rows_list / growth_perf / growth_weekly) and checks every
 * value on save. These helpers only filter, add up and format what the database returned:
 *   • rows that share a UTM link share their leads, so totals count each UTM once
 *     (all-time: per UTM; in-window / campaign cohort: per UTM + campaign)
 *   • "best L2P / V2L" cards need at least MIN_LEADS leads, so 1 lead + 1 payment is not "100 %"
 */
import { tokenizeCsv } from "@/components/admin/communication/lib/csv-identifiers";

export type Channel = "ads" | "influencers";
export type ColType = "text" | "number" | "date" | "url" | "select";

export type Campaign = {
  id: string; name: string; campaign_start: string | null; campaign_end: string | null; exam_date: string | null;
  budget: number | null; application_target: number | null; used: number;
};
/** A row of the Campaigns page (growth_campaigns_list). */
export type CampaignFull = Campaign & {
  last_date_to_apply: string | null; planned_l2p: number | null; planned_cpp: number | null; metadata: Record<string, unknown> | null;
};
export type CustomColumn = { channel: Channel; key: string; label: string; type: ColType; required: boolean; options: string[] | null };
export type Influencer = { id: string; name: string; channel_link: string | null };
export type Meta = {
  campaigns: Campaign[]; columns: CustomColumn[]; influencers: Influencer[]; ad_platforms: string[]; infl_platforms: string[];
};

type Attr = {
  utm_key: string | null;
  leads: number | null; payments: number | null; enrollments: number | null;            // in-window (null = no campaign window / no UTM)
  leads_all: number; payments_all: number; enrollments_all: number;                     // all-time for the UTM
};
export type AdRow = Attr & {
  id: string; serial_no: number | null; ad_name: string; platform: string; campaign_id: string | null; campaign: string | null;
  campaign_status: "Enabled" | "Paused"; live_date: string | null; spend: number; utm_link: string | null; notes: string | null;
  extra: Record<string, string>; updated_at: string;
};
export type PostRow = Attr & {
  id: string; serial_no: number | null; influencer_id: string; influencer: string; platform: string; live_date: string | null;
  live_link: string | null; utm_link: string | null; expected_views: number | null; actual_views: number | null;
  views_synced_at: string | null; cost: number; live_status: "Planned" | "Live"; campaign_id: string | null; campaign: string | null;
  notes: string | null; extra: Record<string, string>; updated_at: string;
};
export type PerfRow = {
  id: string; utm_key: string | null; campaign_id: string | null; campaign: string | null; cost: number; platform: string;
  live_date: string | null; label: string; influencer_id: string | null; influencer: string | null; views: number | null;
  status: string; live_link: string | null; utm_link: string | null; leads: number; payments: number; enrollments: number;
};
export type Week = { week: string; leads: number; payments: number; enrollments: number };

/** Best-L2P / best-V2L cards only consider rows with at least this many leads. */
export const MIN_LEADS = 20;

export const AD_PLATFORMS = ["Meta", "Google"] as const;
export const INFL_PLATFORMS = [
  "YouTube - Dedicated", "YouTube - Integrated", "YouTube - Semi-Dedicated", "YouTube Shorts", "YouTube - Generic",
  "Instagram Reel", "Instagram Story",
] as const;
export const isYouTube = (p: string) => p.startsWith("YouTube");

// ───────────────────────────── search ─────────────────────────────

/** "a, b ,, c" → ["a","b","c"] (lower case). Empty → []. */
export function splitTerms(q: string): string[] {
  return q.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
}

/** Any term found in any field (OR). No terms → true. */
export function matchesTerms(fields: (string | number | null | undefined)[], terms: string[]): boolean {
  if (terms.length === 0) return true;
  const hay = fields.map((f) => (f == null ? "" : String(f).toLowerCase()));
  return terms.some((t) => hay.some((h) => h.includes(t)));
}

/** A YYYY-MM-DD value inside [from, to] (both optional, inclusive). Missing value → false when a bound is set. */
/** A money amount typed by a person: "1,00,000", "₹50,000", " 2500 " → number; empty or not a number → null. */
export function parseAmount(s: string): number | null {
  const t = s.replace(/[₹,\s]/g, "");
  if (!t) return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}

export function inRange(d: string | null, from: string, to: string): boolean {
  if (!from && !to) return true;
  if (!d) return false;
  const v = d.slice(0, 10);
  return (!from || v >= from) && (!to || v <= to);
}

// ───────────────────────────── numbers ─────────────────────────────

const n0 = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0);
export const ratio = (a: number, b: number): number | null => (b > 0 ? a / b : null);

export type Metrics = { spend: number; leads: number; payments: number; enrollments: number; views: number;
  cpl: number | null; cpp: number | null; l2p: number | null; v2l: number | null; p2e: number | null };

export function metrics(spend: number, leads: number, payments: number, enrollments: number, views = 0): Metrics {
  return {
    spend, leads, payments, enrollments, views,
    cpl: ratio(spend, leads), cpp: ratio(spend, payments),
    l2p: leads > 0 ? (payments / leads) * 100 : null,
    v2l: views > 0 ? (leads / views) * 100 : null,
    p2e: payments > 0 ? (enrollments / payments) * 100 : null,
  };
}

/**
 * Totals for a set of performance rows: a plain sum. growth_perf gives every lead to one row only, even
 * when rows share a UTM (migration 0113), so adding rows up never counts a lead twice.
 */
export function totals(rows: PerfRow[]): Metrics {
  let spend = 0, views = 0, l = 0, p = 0, e = 0;
  for (const r of rows) {
    spend += n0(r.cost); views += n0(r.views);
    l += n0(r.leads); p += n0(r.payments); e += n0(r.enrollments);
  }
  return metrics(spend, l, p, e, views);
}

/** Width (0–100) of a funnel bar: v as a share of base; anything above zero shows at least 2 so it stays visible. */
export function shareBar(v: number, base: number): number {
  if (!(base > 0) || !(v > 0)) return 0;
  return Math.max(2, Math.min(100, (v / base) * 100));
}

/** Group rows by a key and total each group. Sorted by spend, high first. */
export function groupTotals(rows: PerfRow[], keyOf: (r: PerfRow) => string): { key: string; rows: PerfRow[]; m: Metrics }[] {
  const g = new Map<string, PerfRow[]>();
  for (const r of rows) {
    const k = keyOf(r);
    g.set(k, [...(g.get(k) ?? []), r]);
  }
  return [...g.entries()].map(([key, rs]) => ({ key, rows: rs, m: totals(rs) })).sort((a, b) => b.m.spend - a.m.spend);
}

export type Best = { row: PerfRow; m: Metrics } | null;

/** Lowest cost per payment (needs ≥ 1 payment and spend > 0). */
export function lowestCpp(rows: PerfRow[]): Best {
  let best: Best = null;
  for (const r of rows) {
    const m = metrics(n0(r.cost), n0(r.leads), n0(r.payments), n0(r.enrollments), n0(r.views));
    if (m.cpp === null || m.spend <= 0) continue;
    if (!best || m.cpp < (best.m.cpp as number)) best = { row: r, m };
  }
  return best;
}

/** Highest leads → payments %, only rows with ≥ minLeads leads (ties: more payments wins). */
export function highestL2p(rows: PerfRow[], minLeads = MIN_LEADS): Best {
  let best: Best = null;
  for (const r of rows) {
    const m = metrics(n0(r.cost), n0(r.leads), n0(r.payments), n0(r.enrollments), n0(r.views));
    if (m.leads < minLeads || m.l2p === null || m.payments === 0) continue;
    if (!best || m.l2p > (best.m.l2p as number) || (m.l2p === best.m.l2p && m.payments > best.m.payments)) best = { row: r, m };
  }
  return best;
}

/** Highest views → leads %, only rows with ≥ minLeads leads and views. */
export function bestV2l(rows: PerfRow[], minLeads = MIN_LEADS): Best {
  let best: Best = null;
  for (const r of rows) {
    const m = metrics(n0(r.cost), n0(r.leads), n0(r.payments), n0(r.enrollments), n0(r.views));
    if (m.leads < minLeads || m.v2l === null) continue;
    if (!best || m.v2l > (best.m.v2l as number)) best = { row: r, m };
  }
  return best;
}

// ───────────────────────────── listing cards ─────────────────────────────

export type AdCards = {
  uniqueAds: number; running: number; paused: number; spend: number;
  iw: { l: number; p: number; e: number }; all: { l: number; p: number; e: number }; anyWindow: boolean;
};

/** Ads listing cards. Unique / running / paused count UTMs (a row without a UTM counts as its own ad). */
export function adCards(rows: AdRow[]): AdCards {
  const key = (r: AdRow) => r.utm_key ?? `row:${r.id}`;
  const all = new Set<string>(), run = new Set<string>(), pau = new Set<string>();
  const iw = new Map<string, { l: number; p: number; e: number }>(), at = new Map<string, { l: number; p: number; e: number }>();
  let spend = 0, anyWindow = false;
  for (const r of rows) {
    const k = key(r);
    all.add(k);
    (r.campaign_status === "Paused" ? pau : run).add(k);
    spend += n0(r.spend);
    if (r.leads !== null) {
      anyWindow = true;
      const ik = `${k}|${r.campaign_id ?? ""}`;
      if (!iw.has(ik)) iw.set(ik, { l: n0(r.leads), p: n0(r.payments), e: n0(r.enrollments) });
    }
    if (r.utm_key && !at.has(r.utm_key)) at.set(r.utm_key, { l: n0(r.leads_all), p: n0(r.payments_all), e: n0(r.enrollments_all) });
  }
  const sum = (m: Map<string, { l: number; p: number; e: number }>) =>
    [...m.values()].reduce((a, v) => ({ l: a.l + v.l, p: a.p + v.p, e: a.e + v.e }), { l: 0, p: 0, e: 0 });
  return { uniqueAds: all.size, running: run.size, paused: pau.size, spend, iw: sum(iw), all: sum(at), anyWindow };
}

export type InflCards = { postsLive: number; channels: number; spend: number; views: number };

export function inflCards(rows: PostRow[]): InflCards {
  return {
    postsLive: rows.filter((r) => r.live_status === "Live").length,
    channels: new Set(rows.map((r) => r.influencer_id)).size,
    spend: rows.reduce((a, r) => a + n0(r.cost), 0),
    views: rows.reduce((a, r) => a + n0(r.actual_views), 0),
  };
}

// ───────────────────────────── weekly chart ─────────────────────────────

const iso = (d: Date) => d.toISOString().slice(0, 10);
/** Monday of the week (UTC date arithmetic on YYYY-MM-DD). */
export function mondayOf(day: string): string {
  const d = new Date(`${day.slice(0, 10)}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dow);
  return iso(d);
}

/** Continuous weeks between the first and last week given (or the from/to bounds), missing weeks as 0. Max 160 weeks. */
export function fillWeeks(weeks: Week[], from?: string | null, to?: string | null): Week[] {
  const by = new Map(weeks.map((w) => [w.week.slice(0, 10), w]));
  const keys = [...by.keys()].sort();
  if (!keys.length && !(from && to)) return [];
  const start = mondayOf(from || keys[0]);
  const endKey = to ? mondayOf(to) : keys[keys.length - 1];
  if (start > endKey) return weeks;
  const out: Week[] = [];
  const d = new Date(`${start}T00:00:00Z`);
  while (iso(d) <= endKey && out.length < 160) {
    const k = iso(d);
    out.push(by.get(k) ?? { week: k, leads: 0, payments: 0, enrollments: 0 });
    d.setUTCDate(d.getUTCDate() + 7);
  }
  return out;
}

/**
 * Y-axis ticks for a count chart: whole numbers only, no repeats (a max of 1 gives 0 and 1, never 0 / 1 / 1).
 * The top is rounded up to a 1-2-5 step so the labels stay clean.
 */
export function countTicks(max: number): { top: number; ticks: number[] } {
  const m = Math.max(1, Math.ceil(Number.isFinite(max) ? max : 1));
  const raw = m / 2;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = Math.max(1, [1, 2, 5, 10].map((k) => k * pow).find((v) => v >= raw) ?? 10 * pow);
  const top = step * Math.ceil(m / step);
  const ticks: number[] = [];
  for (let v = 0; v <= top; v += step) ticks.push(v);
  return { top, ticks };
}

/**
 * Which x labels to draw so they never overlap: positions are pixel x of each point, `gap` the minimum
 * distance between two labels. The first and the last point always get a label.
 */
export function labelIndexes(xs: number[], gap: number): number[] {
  if (xs.length <= 1) return xs.map((_, i) => i);
  const last = xs.length - 1;
  const out = [0];
  for (let i = 1; i < last; i++) {
    if (xs[i] - xs[out[out.length - 1]] >= gap && xs[last] - xs[i] >= gap) out.push(i);
  }
  if (xs[last] - xs[out[out.length - 1]] >= gap || out.length === 1) out.push(last);
  else out[out.length - 1] = last;
  return [...new Set(out)];
}

/** Running total of a series (cumulative view). */
export function cumulative(xs: number[]): number[] {
  let t = 0;
  return xs.map((v) => (t += v));
}

/** First and last index with any activity in A or B (padded by `pad` on each side, kept in range); null when all are 0. */
export function activeSpan(a: number[], b: number[], pad = 1): [number, number] | null {
  const n = Math.max(a.length, b.length);
  let lo = -1, hi = -1;
  for (let i = 0; i < n; i++) if ((a[i] || 0) + (b[i] || 0) > 0) { if (lo < 0) lo = i; hi = i; }
  if (lo < 0) return null;
  return [Math.max(0, lo - pad), Math.min(n - 1, hi + pad)];
}

/** Index of the value in a sorted list closest to v (ties go to the earlier one). */
export function nearestIndex(xs: number[], v: number): number {
  let best = 0;
  for (let i = 1; i < xs.length; i++) if (Math.abs(xs[i] - v) < Math.abs(xs[best] - v)) best = i;
  return best;
}

/** A "nice" number at or above v on the 1-2-5 scale (1, 2, 5, 10, 20, 50 …). */
export function niceCeil(v: number): number {
  if (!(v > 0)) return 1;
  const pow = 10 ** Math.floor(Math.log10(v));
  return ([1, 2, 5, 10].map((k) => k * pow).find((x) => x >= v - 1e-9) ?? 10 * pow);
}

/**
 * Three cost-per-lead guide lines for a cost vs leads chart: the median CPL of the posts rounded to a
 * 1-2-5 step, half of it and double it. Posts without cost or leads are left out. Empty when none qualify.
 */
export function cplGuides(points: { cost: number; leads: number }[]): number[] {
  const cpl = points.filter((p) => p.cost > 0 && p.leads > 0).map((p) => p.cost / p.leads).sort((x, y) => x - y);
  if (!cpl.length) return [];
  const mid = cpl.length % 2 ? cpl[(cpl.length - 1) / 2] : (cpl[cpl.length / 2 - 1] + cpl[cpl.length / 2]) / 2;
  const base = niceCeil(mid);
  return [...new Set([niceCeil(base / 2), base, niceCeil(base * 2)])];
}

/** Short post type for chart labels: "Instagram Reel" → "Reel", "YouTube - Dedicated" → "YT Dedicated". */
export function shortPlatform(p: string): string {
  if (p.startsWith("Instagram ")) return p.slice(10);
  if (p === "YouTube Shorts") return "Shorts";
  return p.replace(/^YouTube - /, "YT ");
}

// ───────────────────────────── CSV import ─────────────────────────────

const STD_HEADERS: Record<Channel, Record<string, string>> = {
  ads: {
    "s no": "serial_no", "sno": "serial_no", "serial no": "serial_no", "serial": "serial_no",
    "ad name": "ad_name", "ad": "ad_name", "name": "ad_name",
    "platform": "platform",
    "used in": "campaign", "campaign": "campaign", "vsat": "campaign",
    "campaign status": "campaign_status", "status": "campaign_status",
    "live date": "live_date", "date": "live_date",
    "spend": "spend", "cost": "spend", "amount spent": "spend",
    "utm link": "utm_link", "utm": "utm_link", "link": "utm_link",
    "notes": "notes", "note": "notes",
  },
  influencers: {
    "s no": "serial_no", "sno": "serial_no", "serial no": "serial_no", "serial": "serial_no",
    "influencer": "influencer", "influencer name": "influencer", "creator": "influencer", "channel": "influencer",
    "platform": "platform", "post type": "platform",
    "live date": "live_date", "date": "live_date",
    "live link": "live_link", "video link": "live_link", "post link": "live_link",
    "utm link": "utm_link", "utm": "utm_link",
    "expected views": "expected_views",
    "actual views": "actual_views", "views": "actual_views",
    "cost": "cost", "spend": "cost",
    "live status": "live_status", "status": "live_status",
    "campaign": "campaign", "used in": "campaign", "vsat": "campaign",
    "notes": "notes", "note": "notes",
  },
};
/** Columns the database computes: ignored in a file, never sent. */
const COMPUTED = new Set(["leads", "payments", "enrollments", "enrolments", "paid", "enrol", "leads in window", "leads all time",
  "payments in window", "payments all time", "enrollments in window", "enrollments all time", "cpl", "cpp", "l2p", "v2l", "last synced"]);

const normHead = (h: string) => h.trim().toLowerCase().replace(/[_\-.()*#]+/g, " ").replace(/\s+/g, " ").trim();

export type CsvImport = { rows: Record<string, unknown>[]; mapped: { header: string; key: string }[]; ignored: string[]; unknown: string[] };
export const CSV_IMPORT_MAX_ROWS = 2000;

/**
 * File text → rows for growth_rows_import. Headings are matched to the standard columns (several common
 * names) and to custom columns by their label. Computed columns (leads, payments…) are ignored; any other
 * unknown heading is reported and not sent. Empty cells are left out.
 */
export function csvToRows(text: string, channel: Channel, custom: CustomColumn[]): { ok: true; data: CsvImport } | { ok: false; error: string } {
  const tok = tokenizeCsv(text);
  if (!Array.isArray(tok)) return { ok: false, error: tok.error };
  const recs = tok.filter((r) => r.some((c) => c.trim() !== ""));
  if (recs.length < 2) return { ok: false, error: "The file needs a header row and at least one row under it." };
  if (recs.length - 1 > CSV_IMPORT_MAX_ROWS) return { ok: false, error: `The file has ${recs.length - 1} rows. Upload at most ${CSV_IMPORT_MAX_ROWS} at a time.` };
  const std = STD_HEADERS[channel];
  const byLabel = new Map(custom.filter((c) => c.channel === channel).map((c) => [normHead(c.label), c.key]));
  const cols: { i: number; key: string; custom: boolean }[] = [];
  const mapped: { header: string; key: string }[] = [], ignored: string[] = [], unknown: string[] = [];
  const used = new Set<string>();
  recs[0].forEach((h, i) => {
    const n = normHead(h);
    if (!n) return;
    const key = std[n] ?? byLabel.get(n);
    if (key && !used.has(key)) { used.add(key); cols.push({ i, key, custom: !std[n] }); mapped.push({ header: h.trim(), key }); }
    else if (COMPUTED.has(n)) ignored.push(h.trim());
    else unknown.push(h.trim());
  });
  if (cols.length === 0) return { ok: false, error: "No heading in the file matches a column of this table." };
  const rows = recs.slice(1).map((r) => {
    const out: Record<string, unknown> = {};
    const extra: Record<string, string> = {};
    for (const c of cols) {
      const v = (r[c.i] ?? "").trim();
      if (!v) continue;
      if (c.custom) extra[c.key] = v; else out[c.key] = v;
    }
    if (Object.keys(extra).length) out.extra = extra;
    return out;
  });
  return { ok: true, data: { rows, mapped, ignored, unknown } };
}

/** Import error detail from the database ("[{row, error}]") → readable lines (row numbers counted from the first data row, +1 for the header). */
export function importErrors(detail: string | null | undefined, labelOf: (key: string) => string): string[] {
  try {
    const list = JSON.parse(detail ?? "") as { row: number; error: string }[];
    if (!Array.isArray(list)) return [];
    return list.slice(0, 50).map((e) => `Row ${e.row + 1}: ${errorText(e.error, labelOf)}`);
  } catch {
    return [];
  }
}

// ───────────────────────────── errors ─────────────────────────────

const FIELD: Record<string, string> = {
  ad_name: "Ad name", platform: "Platform", campaign: "Used in (campaign)", campaign_status: "Status", live_date: "Live date",
  spend: "Spend", utm_link: "UTM link", notes: "Notes", serial_no: "Serial no.", influencer: "Influencer", live_link: "Live link",
  expected_views: "Expected views", actual_views: "Actual views", cost: "Cost", live_status: "Live status",
  name: "Name", campaign_start: "Campaign start", campaign_end: "Campaign end", exam_date: "Exam date", budget: "Budget",
  application_target: "Application target", last_date_to_apply: "Last date to apply", planned_l2p: "Planned L2P (0–100)",
  planned_cpp: "Planned CPP", metadata: "Custom fields", label: "Column name", type: "Column type", options: "Options", channel_link: "Channel link",
  from: "From date", to: "To date", campaign_ids: "Campaign", ids: "Selection", rows: "File",
};

/** Database error code → one plain sentence. Unknown text is never shown as-is (it could be anything). */
export function errorText(raw: string | null | undefined, labelOf: (key: string) => string = (k) => k): string {
  const m = (raw ?? "").trim();
  const name = (k: string) => FIELD[k] ?? (k.startsWith("x_") ? labelOf(k) : k.replace(/_/g, " "));
  let x = /^REQUIRED: ([a-z0-9_]+)$/.exec(m);
  if (x) return `${name(x[1])} is required.`;
  x = /^BAD_VALUE: ([a-z0-9_]+)$/.exec(m);
  if (x) {
    if (x[1] === "campaign" || x[1] === "campaign_id") return "That campaign does not exist. Add it under Campaigns first.";
    if (x[1] === "influencer") return "That influencer is not in the list. Add the influencer first.";
    if (x[1] === "campaign_end") return "Campaign end must be on or after the start.";
    if (x[1] === "to") return "The To date must be on or after the From date.";
    return `${name(x[1])} has a value that is not allowed.`;
  }
  x = /^UNKNOWN_KEY: ([a-z0-9_]+)$/.exec(m);
  if (x) return x[1].startsWith("x_") ? "One of the columns was removed. Reload the page and try again." : "This request has a field the database does not accept.";
  switch (m) {
    case "FORBIDDEN": return "Only admins can use the Ads and Influencer screens.";
    case "NOT_SIGNED_IN": return "Your session ended. Sign in again.";
    case "DUPLICATE": return "That name is already used.";
    case "IN_USE": return "This campaign is used by ads or posts, so it cannot be deleted.";
    case "NOT_FOUND": return "It no longer exists. Reload the page.";
    case "TOO_MANY_ROWS": return `Upload at most ${CSV_IMPORT_MAX_ROWS} rows at a time.`;
    case "TOO_MANY_COLUMNS": return "A table can have at most 30 added columns.";
    case "IMPORT_FAILED": return "Nothing was imported because some rows have errors.";
    case "BAD_REQUEST": return "The request was not valid.";
    default: return "Something went wrong. Please try again.";
  }
}

// ───────────────────────────── format ─────────────────────────────

export const fmtInt = (v: number | null | undefined) => (v == null || !Number.isFinite(Number(v)) ? "—" : Math.round(Number(v)).toLocaleString("en-IN"));
export const fmtInr = (v: number | null | undefined) => (v == null || !Number.isFinite(Number(v)) ? "—" : `₹${Math.round(Number(v)).toLocaleString("en-IN")}`);
export const fmtPct = (v: number | null | undefined, dp = 1) => (v == null || !Number.isFinite(v) ? "—" : `${v.toFixed(dp).replace(/\.0+$/, "")}%`);
/** 4,30,44,767 → "4.30Cr"; 15,02,000 → "15.02L"; small numbers in full. */
export function fmtCompact(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  const n = Number(v);
  if (Math.abs(n) >= 1e7) return `${(n / 1e7).toFixed(2)}Cr`;
  if (Math.abs(n) >= 1e5) return `${(n / 1e5).toFixed(2)}L`;
  return Math.round(n).toLocaleString("en-IN");
}
export function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  const t = new Date(d.length <= 10 ? `${d}T00:00:00+05:30` : d);
  return Number.isNaN(t.getTime()) ? "—" : t.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
}
export function fmtDateTime(d: string | null | undefined): string {
  if (!d) return "—";
  const t = new Date(d);
  return Number.isNaN(t.getTime()) ? "—" : t.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });
}

/** YouTube video id from a watch / youtu.be / shorts / embed / live link; null when it is not one. */
export function youTubeId(link: string | null | undefined): string | null {
  if (!link) return null;
  let u: URL;
  try { u = new URL(link); } catch { return null; }
  const host = u.hostname.replace(/^www\.|^m\./, "");
  let id: string | null = null;
  if (host === "youtu.be") id = u.pathname.slice(1).split("/")[0];
  else if (host === "youtube.com" || host === "music.youtube.com") {
    id = u.searchParams.get("v");
    if (!id) {
      const m = /^\/(shorts|embed|live|v)\/([^/?#]+)/.exec(u.pathname);
      if (m) id = m[2];
    }
  }
  return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
}

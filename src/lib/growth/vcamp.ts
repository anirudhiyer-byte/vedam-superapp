import { errorText } from "./marketing";

/**
 * Growth → Overview → VSAT Campaign Report: the pure parts (request, numbers on the cards, row list, texts).
 * The counts and the windows come from public.growth_vcamp_report (migration 0116); "today" is decided there (IST).
 * Card maths follow the CRM's /morning-report page.
 */

export type Split = { total: number; ggn: number; pune: number; other: number };
export const ZERO_SPLIT: Split = { total: 0, ggn: 0, pune: 0, other: 0 };

export type RowKey = "achievement" | "today_pay" | "yday_pay" | "last3_pay" | "today_leads" | "yday_leads" | "total_leads";

export type ReportCampaign = { id: string; name: string; campaign_start: string | null; campaign_end: string | null; application_target: number };
export type Report = {
  campaign: ReportCampaign | null;
  today: string;
  over?: boolean;
  last3_valid?: boolean;
  rows?: Partial<Record<RowKey, unknown>>;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** No (or a bad) id → {} and the database opens its default campaign, so the page never gets stuck on a bad id. */
export function buildReportPayload(campaignId: string): Record<string, unknown> {
  const id = (campaignId ?? "").trim().toLowerCase();
  return UUID_RE.test(id) ? { campaign_id: id } : {};
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
function dayNumber(iso: string): number | null {
  if (!ISO_RE.test(iso)) return null;
  const [y, m, d] = iso.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d);
  const back = new Date(t);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== m - 1 || back.getUTCDate() !== d) return null;
  return Math.round(t / 86_400_000);
}

/** Calendar days from `a` to `b` (ISO dates). Invalid input → 0. */
export function daysBetween(a: string, b: string): number {
  const x = dayNumber(a);
  const y = dayNumber(b);
  return x === null || y === null ? 0 : y - x;
}

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
};

export type Metrics = { remaining: number; pct: number; daysToGo: number; over: boolean };

/** CRM: remaining = max(0, target − achieved); % = round(achieved / target × 100), 0 when target is 0; days to go = max(0, end − today). */
export function metrics(a: { target: number | null; achieved: number; end: string | null; today: string }): Metrics {
  const target = num(a.target);
  const achieved = num(a.achieved);
  const left = daysBetween(a.today, a.end ?? "");
  return {
    remaining: Math.max(0, target - achieved),
    pct: target > 0 ? Math.round((achieved / target) * 100) : 0,
    daysToGo: Math.max(0, left),
    over: left < 0,
  };
}

/** A split from the database; anything missing or wrong becomes 0 so the screen never shows NaN. */
export function toSplit(v: unknown): Split {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  return { total: num(o.total), ggn: num(o.ggn), pune: num(o.pune), other: num(o.other) };
}

export type RowDef = { key: RowKey; label: string; bold: boolean; accent: boolean; gap: boolean };

/** The 7 rows of the CRM matrix, in the CRM's order and styles. */
export function reportRows(last3Valid: boolean): RowDef[] {
  return [
    { key: "achievement", label: "Achievement (paid)", bold: true, accent: true, gap: false },
    { key: "today_pay", label: "Today's payments", bold: false, accent: false, gap: false },
    { key: "yday_pay", label: "Yesterday's payments", bold: false, accent: false, gap: false },
    { key: "last3_pay", label: `Last 3 days payments${last3Valid ? "" : " — outside campaign"}`, bold: false, accent: false, gap: false },
    { key: "today_leads", label: "Today's leads", bold: false, accent: false, gap: true },
    { key: "yday_leads", label: "Yesterday's leads", bold: false, accent: false, gap: true },
    { key: "total_leads", label: "Total leads (campaign window)", bold: true, accent: false, gap: true },
  ];
}

export const fmtIN = (n: number): string => (Number.isFinite(n) ? n : 0).toLocaleString("en-IN");

/** Under Total on lead rows, so Total vs GGN + Pune reconciles (CRM). */
export function gapNote(s: Split, show: boolean): string | null {
  return show && s.other > 0 ? `${fmtIN(s.other)} without campus preference` : null;
}

/** Dropdown text, as in the CRM's CampaignSelector. */
export const campaignOption = (c: { name: string; campaign_start: string | null; campaign_end: string | null }): string =>
  `${c.name} (${c.campaign_start ?? "—"} → ${c.campaign_end ?? "—"})`;

/** Database code → one plain sentence. Unknown text is never shown (it could name tables or functions). */
export function vcampError(raw: string | null | undefined): string {
  const m = (raw ?? "").trim();
  if (m === "FORBIDDEN") return "Only admins can open the VSAT Campaign Report.";
  if (m === "NOT_FOUND") return "That campaign was not found. Pick another one.";
  if (/^(BAD_VALUE|UNKNOWN_KEY): [a-z0-9_]+$/.test(m) || m === "NOT_SIGNED_IN" || m === "BAD_REQUEST") return errorText(m);
  return "Something went wrong. Please try again.";
}

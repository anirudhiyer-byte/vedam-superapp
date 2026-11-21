/**
 * Telegram Performance (Growth → Telegram Channel), migration 0134. Pure helpers: formats as the CRM's Telegram Dashboard,
 * the numbers worked out on screen (CPL, CPA, CPP, L2P, total spend), the funnel and the drill's stage counts.
 */

/** growth_tg_perf → kpi */
export type TgPerfKpi = {
  influencers: number; utms: number; leads: number; payments: number; enrollments: number; cpl_spend: number; cpa_spend: number;
};
export type TgPerfMeta = {
  campaigns: { id: string; name: string; campaign_start: string | null; campaign_end: string | null }[];
  influencers: { key: string; name: string }[];
};
export type TgStudent = {
  lead_id: string; name: string | null; email: string | null; mobile: string | null; registration_date: string | null;
  campus_preference: string | null; stage: string | null; payment_status: string | null;
};
export type TgStudents = { students: TgStudent[]; total: number; truncated: boolean };
export type TgFilter = { from: string; to: string; campaign: string; influencer: string };

/** The CRM's season start (its page constant). */
export const SEASON_START = "2025-11-20";

/** Today in India (YYYY-MM-DD). */
export function todayIst(now = Date.now()): string {
  return new Date(now + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}

/** RPC body: empty values are left out (empty campaign = all VSATs, empty influencer = all influencers). */
export function perfParams(f: Partial<TgFilter>): Record<string, string> {
  const p: Record<string, string> = {};
  if (f.from) p.start = f.from;
  if (f.to) p.end = f.to;
  if (f.campaign) p.campaign = f.campaign;
  if (f.influencer) p.influencer = f.influencer;
  return p;
}

/** From after To → a message (the database refuses it too). */
export const rangeError = (from: string, to: string) => (from && to && from > to ? "From must be on or before To." : null);

export type Derived = TgPerfKpi & { total_spend: number; overall_cpl: number; overall_cpa: number; overall_cpp: number; l2p: number };
const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** Worked-out numbers: total = CPL + CPA spend; CPL = CPL spend / leads; CPA = CPA spend / payments; CPP = total / payments. */
export function derive(k: Partial<TgPerfKpi> | null | undefined): Derived {
  const b = {
    influencers: n(k?.influencers), utms: n(k?.utms), leads: n(k?.leads), payments: n(k?.payments), enrollments: n(k?.enrollments),
    cpl_spend: n(k?.cpl_spend), cpa_spend: n(k?.cpa_spend),
  };
  const total = b.cpl_spend + b.cpa_spend;
  return {
    ...b, total_spend: total,
    overall_cpl: b.leads > 0 ? b.cpl_spend / b.leads : 0,
    overall_cpa: b.payments > 0 ? b.cpa_spend / b.payments : 0,
    overall_cpp: b.payments > 0 ? total / b.payments : 0,
    l2p: b.leads > 0 ? (b.payments / b.leads) * 100 : 0,
  };
}

export const fmtNum = (v: number) => n(v).toLocaleString("en-IN");
export const fmtINR = (v: number) => "₹" + n(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Short rupees as the CRM: ₹1.25Cr, ₹3.40L, ₹12K, ₹950. */
export function fmtINRk(v: number): string {
  const x = n(v);
  if (x >= 1e7) return `₹${(x / 1e7).toFixed(2)}Cr`;
  if (x >= 1e5) return `₹${(x / 1e5).toFixed(2)}L`;
  if (x >= 1000) return `₹${Math.round(x / 1000)}K`;
  return "₹" + x.toLocaleString("en-IN");
}
export const fmtPct = (v: number) => `${n(v).toFixed(2)}%`;

/** Funnel bars: width as % of leads (at least 2%), rates as the CRM ("x% of leads", "y% of payments"). */
export function funnel(leads: number, payments: number, enrollments: number) {
  const max = Math.max(leads, 1);
  const w = (v: number) => Math.max((v / max) * 100, 2);
  return {
    leads: w(leads), payments: w(payments), enrollments: w(enrollments),
    paidRate: leads > 0 ? ((payments / leads) * 100).toFixed(2) : "0.00",
    enrolRate: payments > 0 ? ((enrollments / payments) * 100).toFixed(2) : "0.00",
  };
}

/** Stage breakdown of the drill: count per stage, biggest first (ties A–Z). */
export function stageCounts(rows: TgStudent[]): [string, number][] {
  const m = new Map<string, number>();
  for (const s of rows) { const k = s.stage || "no_application"; m.set(k, (m.get(k) ?? 0) + 1); }
  return Array.from(m.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

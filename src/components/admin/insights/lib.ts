/* Pure helpers for the Insights page (no React, no Supabase) — unit-tested in lib.test.ts. */

/* ---------- periods (IST, UTC+5:30) ---------- */
export type PeriodKey = "today" | "week" | "month" | "year" | "all";
export const PERIODS: { key: PeriodKey; label: string; short: string }[] = [
  { key: "today", label: "Today", short: "Today" },
  { key: "week", label: "This week", short: "WTD" },
  { key: "month", label: "This month", short: "MTD" },
  { key: "year", label: "This year", short: "YTD" },
  { key: "all", label: "All time", short: "All" },
];

const IST_MS = 5.5 * 60 * 60 * 1000;

/** RPC arguments for a period: half-open [p_from, p_to) in UTC ISO; all time = both null. */
export function periodRange(key: PeriodKey, now: Date = new Date()): { p_from: string | null; p_to: string | null } {
  if (key === "all") return { p_from: null, p_to: null };
  // work on the IST wall clock, expressed as a UTC date
  const ist = new Date(now.getTime() + IST_MS);
  const start = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()));
  if (key === "week") start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7)); // Monday
  if (key === "month") start.setUTCDate(1);
  if (key === "year") { start.setUTCMonth(0); start.setUTCDate(1); }
  const fromUtc = new Date(start.getTime() - IST_MS);
  // end = one minute from now, so a sign-up a few seconds ago is never cut off by clock skew
  const toUtc = new Date(now.getTime() + 60_000);
  return { p_from: fromUtc.toISOString(), p_to: toUtc.toISOString() };
}

/* ---------- numbers ---------- */
export const fmt = (n: number | null | undefined) => (n == null || Number.isNaN(n) ? "—" : Math.round(n).toLocaleString("en-IN"));

/** "12.5%" with one decimal; "—" when the denominator is 0. */
export function pct(num: number, den: number): string {
  if (!den) return "—";
  const v = (num / den) * 100;
  return `${v >= 10 || v === 0 ? v.toFixed(0) : v.toFixed(1)}%`;
}
export const ratio = (num: number, den: number) => (den ? num / den : 0);

export function inr(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

/** Cost per unit, only when there is spend and at least one unit. */
export function costPer(spend: number | null | undefined, units: number): string {
  if (!spend || !units) return "—";
  return inr(spend / units);
}

/* ---------- labels ---------- */
export type ProductKey = "codesprint" | "bootcamp" | "pyq" | "cp" | "vsat";
export const PRODUCT_LABEL: Record<string, string> = {
  codesprint: "CodeSprint",
  bootcamp: "Bootcamp",
  pyq: "PYQ",
  cp: "College Predictor",
  vsat: "VSAT early registration",
  site: "Vedam One (all pages)",
  peerpath: "Talk to a Senior",
};
export const productLabel = (k: string) => PRODUCT_LABEL[k] ?? titleCase(k);

/** What "users" means for each product in a period. */
export const PRODUCT_USER_RULE: Record<ProductKey, string> = {
  codesprint: "enrolled (or signed up through a CodeSprint link) in the period",
  bootcamp: "registered for a bootcamp in the period",
  pyq: "started a PYQ paper in the period",
  cp: "ran a prediction in the period",
  vsat: "early-registered for VSAT in the period",
};

/** Names of the three depth steps returned by ins_products (step1..step3) per product. */
export const PRODUCT_STEPS: Record<ProductKey, [string, string, string | null]> = {
  codesprint: ["Enrolled", "Completed a lesson", "Earned a certificate"],
  bootcamp: ["Attended live", "Stayed 75%+ of the session", "Shared a project"],
  pyq: ["Submitted a paper", "Submitted 2+ papers", null],
  cp: ["Ran 2+ predictions", "Ran 5+ predictions", null],
  vsat: ["Used a Vedam product", "Used 2+ Vedam products", null],
};

const SOURCE_LABEL: Record<string, string> = {
  whatsapp: "WhatsApp",
  meta: "Meta",
  telegram: "Telegram",
  community: "Community",
  paid: "Paid",
  vedam_website: "Vedam website",
  email: "Email",
  calling: "Calling",
  google: "Google",
  instagram: "Instagram",
  youtube: "YouTube",
  facebook: "Facebook",
  linkedin: "LinkedIn",
  unknown: "No source tag",
  untagged: "Spend not tagged to a source",
};
/** Display name for a source key from the database (already lower-case and trimmed there). */
export function sourceLabel(key: string | null | undefined): string {
  const k = (key ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!k) return SOURCE_LABEL.unknown;
  return SOURCE_LABEL[k] ?? titleCase(k);
}

export function titleCase(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export const LEVEL_LABEL: Record<string, { name: string; rule: string }> = {
  high: { name: "Highly engaged", rule: "real use in 2+ products" },
  medium: { name: "Engaged", rule: "real use in 1 product" },
  low: { name: "Signed up only", rule: "no real use yet" },
};
/** "Real use" per product, as counted by the database (ins__facts.n_deep). */
export const REAL_USE_RULE =
  "Real use = completed a CodeSprint lesson, attended a bootcamp live, submitted a PYQ paper, or ran 2+ College Predictor predictions.";

/** Short status line per product for one person (from ins_people). */
export type Person = {
  user_id: string; public_id: string | null; name: string | null; email: string | null; phone: string | null;
  signup_at: string; source: string; state: string; full: boolean; mqr: boolean; n_products: number;
  level: "low" | "medium" | "high";
  codesprint: { since: string; enrolled: boolean; lessons: number; certs: number } | null;
  bootcamp: { since: string; registered: number; attended: number; stayed: number; projects: number } | null;
  pyq: { since: string; started: number; submitted: number } | null;
  cp: { since: string; predictions: number } | null;
  vsat_at: string | null; last_activity_at: string | null;
};
export function personStatus(p: Person): { product: ProductKey; text: string }[] {
  const out: { product: ProductKey; text: string }[] = [];
  if (p.codesprint) {
    const c = p.codesprint;
    out.push({ product: "codesprint", text: [c.enrolled ? "Enrolled" : "Signed up via link", `${c.lessons} lesson${c.lessons === 1 ? "" : "s"}`, c.certs ? `${c.certs} cert` : null].filter(Boolean).join(" · ") });
  }
  if (p.bootcamp) {
    const b = p.bootcamp;
    out.push({ product: "bootcamp", text: [`${b.registered} registered`, `${b.attended} attended`, b.projects ? `${b.projects} project` : null].filter(Boolean).join(" · ") });
  }
  if (p.pyq) out.push({ product: "pyq", text: `${p.pyq.started} started · ${p.pyq.submitted} submitted` });
  if (p.cp) out.push({ product: "cp", text: `${p.cp.predictions} prediction${p.cp.predictions === 1 ? "" : "s"}` });
  return out;
}

export const shortDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "2-digit" }) : "—";

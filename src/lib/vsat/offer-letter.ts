/**
 * VSAT offer (Acceptance) letter · content and fee numbers. Pure, no I/O: the PDF is drawn by
 * offer-letter-pdf.ts (server-only) from what this file returns.
 *
 * The wording, campus details, fee rows and due dates are copied from the two approved sample letters
 * (Pune / ADYPU and Gurugram / Sushant University), moved one year on for the class of 2027 (23 Nov 2026). They change once a season: update
 * SEASON and CAMPUS_LETTER below and the unit tests.
 *
 * Fee table (decided 23 Nov 2026):
 *   - Rows and amounts as in the sample letters (Gurugram keeps its own semester amounts on purpose).
 *   - Total = the campus programme fee (VSAT settings, vsat_campus_settings.programme_fee; else the season's).
 *   - Scholarship = scholarship % × programme fee, spread equally over the 8 semesters (whole rupees,
 *     the odd rupees on the first semesters), never more than a semester's fee. Year 1 = semesters 1 + 2.
 *   - Seat blocking amount and the security deposit get no scholarship.
 *   - The offer is valid for the campus "Days to pay"; the seat blocking amount is due in the same days.
 */

export type CampusKey = "pune" | "gurugram";

export const SEASON = {
  classOf: 2027,
  feeYears: "2027 - 2031",
  joining: "First Week of August’ 2027 (Tentative and subject to change). You will keep getting regular updates about the induction program and reporting date from us via email.",
  depositAmount: 30000,
  depositDue: "Jul 26, 2027",
  semesterDue: ["Jul 26, 2027", "Nov 15, 2027", "Apr 15, 2028", "Nov 15, 2028", "Apr 15, 2029", "Nov 15, 2029", "Apr 15, 2030", "Nov 15, 2030"],
} as const;

export type CampusLetter = {
  key: CampusKey;
  /** "you are eligible to get a <degree> from <university>." (both bold) */
  degree: string;
  university: string;
  location: string;
  semesters: number[];
  /** the season's programme fee (the table total) when the VSAT settings have none */
  programmeFee: number;
  /** the "Other fees" paragraph under the fee table: bold lead-in + text */
  otherFees: { lead: string; text: string };
  /** T&C line: "The B.Tech in Computer Science [AI] degree is being offered by <x>." */
  tcUniversity: string;
};

export const CAMPUS_LETTER: Record<CampusKey, CampusLetter> = {
  pune: {
    key: "pune",
    degree: "B.Tech CSE [AI] degree",
    university: "Ajeenkya DY Patil University, Pune.",
    location: "Ajeenkya DY Patil University, DY Patil Knowledge City Road Via Lohgaon, Airport Rd, Charholi Budruk, Pune, Maharashtra - 412105",
    semesters: [221250, 221250, 221250, 221250, 221250, 221250, 221250, 221250],
    programmeFee: 1850000,
    otherFees: {
      lead: "Other Fees:",
      text: " The following are additional fees payable directly to the University, over and above the course fee. These include One-time component of Application Fee (₹1,500), Registration Fee (₹5,000), Uniform Fee (₹5,000) and Sports Activity Fee (₹5,000); the Examination Fee is ₹3,000 per semester.",
    },
    tcUniversity: "ADYPU, Pune",
  },
  gurugram: {
    key: "gurugram",
    degree: "B.Tech in Computer Science with specialisation in Artificial Intelligence",
    university: "Sushant University, Gurugram.",
    location: "Golf Course Rd, Huda, Sushant Lok 2, Sector 55, Gurugram, Haryana 122011.",
    semesters: [264813, 219313, 219313, 219313, 219313, 219313, 219313, 219313],
    programmeFee: 1800000,
    otherFees: {
      lead: "Other Fees:",
      text: " Additional fees payable directly to the University, over and above the course fee: one-time Application Fee (₹1,500) and Admission Fee (₹45,000); The Examination Fee (₹4,000 per semester).",
    },
    tcUniversity: "Sushant University, Gurugram",
  },
};

export function campusKey(v: unknown): CampusKey | null {
  const s = String(v ?? "").toLowerCase();
  if (s.includes("pune")) return "pune";
  if (s.includes("gurugram") || s.includes("gurgaon")) return "gurugram";
  return null;
}

const toNum = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

/** 1850000 → "18,50,000" (Indian grouping, whole rupees). */
export function inr(n: number): string {
  return Math.round(n).toLocaleString("en-IN");
}

export type FeeLine = { label: string; fee: number; scholarship: number | null; payable: number; due: string };

export type LetterNumbers = {
  pct: number;
  programmeFee: number;
  totalScholarship: number;
  year1Scholarship: number;
  payableTotal: number;
  rows: FeeLine[];
};

/** The fee table and scholarship amounts for one student. */
export function letterNumbers(c: CampusLetter, opts: { pct: unknown; programmeFee: unknown; seatBlock: unknown; days: number }): LetterNumbers {
  const pct = Math.min(100, Math.max(0, toNum(opts.pct) ?? 0));
  const programmeFee = toNum(opts.programmeFee) ?? c.programmeFee;
  const seatBlock = toNum(opts.seatBlock) ?? 50000;
  const target = Math.round((pct * programmeFee) / 100);
  const n = c.semesters.length;
  const base = Math.floor(target / n);
  const extra = target - base * n;
  const perSem = c.semesters.map((fee, i) => Math.min(fee, base + (i < extra ? 1 : 0)));
  const totalScholarship = perSem.reduce((a, b) => a + b, 0);
  const days = Math.max(0, Math.round(opts.days));
  const rows: FeeLine[] = [
    { label: "Seat Blocking Amount", fee: seatBlock, scholarship: null, payable: seatBlock, due: `${days} day${days === 1 ? "" : "s"} from the date of issue of Acceptance Letter` },
    { label: "Refundable Security Deposit", fee: SEASON.depositAmount, scholarship: null, payable: SEASON.depositAmount, due: SEASON.depositDue },
    ...c.semesters.map((fee, i) => ({ label: `Semester ${i + 1}`, fee, scholarship: perSem[i], payable: fee - perSem[i], due: SEASON.semesterDue[i] ?? "" })),
  ];
  return {
    pct,
    programmeFee,
    totalScholarship,
    year1Scholarship: (perSem[0] ?? 0) + (perSem[1] ?? 0),
    payableTotal: programmeFee - totalScholarship,
    rows,
  };
}

/** Whole IST days between release and the deadline (the offer is valid until 11:59 pm IST of the last day). */
export function offerDays(releasedAt: string | null | undefined, expiresAt: string | null | undefined, fallback: number): number {
  if (!releasedAt || !expiresAt) return fallback;
  const d = (iso: string) => new Date(new Date(iso).toLocaleString("en-US", { timeZone: "Asia/Kolkata" })).setHours(0, 0, 0, 0);
  const a = d(releasedAt), b = d(expiresAt);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return fallback;
  return Math.round((b - a) / 86_400_000);
}

/** "LABANA PRINCEKUMAR" → "Acceptance_Letter_LABANA_PRINCEKUMAR.pdf" (letters, digits and _ only). */
export function letterFileName(name: string | null | undefined): string {
  const slug = String(name ?? "").trim().replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60);
  return `Acceptance_Letter${slug ? "_" + slug : ""}.pdf`;
}

export type LetterInput = {
  name: string;
  campus: CampusKey;
  pct: unknown;
  programmeFee: unknown;
  seatBlock: unknown;
  days: number;
  dashboardLink: string;
};

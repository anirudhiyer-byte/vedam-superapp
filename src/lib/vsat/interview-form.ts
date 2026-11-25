/**
 * The interview form (0173) — sir's Google Form, question by question (the "Interview Responses" sheet, columns C–AC).
 * The interviewer gives no verdict (owner's review, 24 Nov): the verdict comes from Interview Evaluation.
 *
 * Every question is required, as in the Google Form (every row of the sheet has every answer). Number questions take a
 * number from 0 to 100 or "N/A" ("JEE Mains Percentile (or N/A)"); N/A is saved as empty. The database checks the types
 * and ranges again (vsat_submit_interview); this file only builds the request and the messages.
 */

export type Part = "communication" | "logic" | "passion" | "achievements" | "why_program";
export type YesNo = "yes" | "no" | "";

/** One marked part: the question, its scale help (as in the form) and the remark question that goes with it. */
export type PartQuestion = { key: Part; title: string; help: string[]; remarkTitle: string };

/** The five marked parts, in the form's order, with sir's wording. */
export const PART_QUESTIONS: PartQuestion[] = [
  {
    key: "communication", title: "Communication & Behavioral Skills",
    help: [
      "1 Point: Unable to express in English / Dressed improperly / Not maintaining basic etiquettes",
      "3 Points: Able to express with limited vocabulary [speaks more in Hinglish]",
      "5 Points: Speaks very fluently and confidently in English",
    ],
    remarkTitle: "Behavioural & Communication — Remarks",
  },
  { key: "logic", title: "Guesstimate & Logical Reasoning", help: [], remarkTitle: "Logical & Reasoning — Remarks" },
  {
    key: "passion", title: "Passion & Motivation for Computer Science",
    help: [
      "Evaluate based on their exposure to CS beyond the classroom. Select the most accurate option.",
      "5 Points – Built advanced projects available on GitHub or hosted online, participated in national-level tech events or CS Olympiads.",
      "4 Points – Built intermediate projects or won in school-level events with proof.",
      "3 Points – Knows at least one programming language and has built basic apps or programs.",
      "2 Points – Has some basic exposure (e.g., used Scratch, wrote simple code) but no concrete output.",
      "1 Point – Interested in CS but has not taken any initiative yet.",
    ],
    remarkTitle: "Passion & Motivation for CS — Remarks",
  },
  {
    key: "achievements", title: "Achievements & Extracurricular Activities",
    help: [
      "Consider both academic and non-academic achievements. Select the most relevant option.",
      "5 Points – Won or participated in national-level events or competitions.",
      "4 Points – Won or represented at state-level competitions.",
      "3 Points – School/district-level achievements or leadership roles like school captain.",
      "2 Points – Actively pursues a hobby with proof (e.g., art portfolio, sports certificate, YouTube channel).",
      "1 Point – Interest in activities but without proof or accolades.",
    ],
    remarkTitle: "Achievement & Extracurricular — Remarks",
  },
  {
    key: "why_program", title: "Why This Program?",
    help: [
      "Assess how well the student aligns with Vedam's vision and offerings. Choose the most fitting option.",
      "5 Points: Has researched Vedam deeply, mentions specific features (AI-first curriculum, startup support, hands-on projects, faculty, etc.), and links them to personal goals in CS.",
      "3 Points: Generic interest in CS/AI, mentions career opportunities, but not specific to Vedam.",
      "1 Point: No clear reason, seems disinterested or applying randomly.",
    ],
    remarkTitle: "Why This Program — Remarks",
  },
];

export const CHEATING_TITLE = "Did you find the student cheating while solving questions?";
/** The form's two answers; "Yes" rejects the student straight away (the verdict is Rejected, 0173). */
export const CHEATING_OPTIONS = [
  { value: "no", label: "No" },
  { value: "yes", label: "Yes, and hence Reject Straight Away" },
] as const;

/** The yes / no questions, each placed after the part it belongs to. */
export const YES_NO = {
  coding_talent: { after: "passion" as Part, title: "Is this student a possible coding talent? If yes, have you asked them to share their projects / work by email?" },
  cert_asked: { after: "achievements" as Part, title: "If the student is a national-level certificate holder, have you asked them to share the certificate by email?" },
} as const;

/** Number questions: a number from 0 to 100, or N/A. */
export const NUMBER_QUESTIONS = [
  { key: "jee_pct", title: "JEE Mains Percentile (or N/A)", help: "" },
  { key: "jee_maths_pct", title: "JEE Mains Maths Percentile (or N/A)", help: "" },
  { key: "expected_jee_pct", title: "JEE Mains Percentile (Expected)",
    help: "For the ones who are yet to appear or yet to get results — ask them how much they are expecting to score." },
  { key: "class12_pct", title: "Class 12th Percentage", help: "" },
  { key: "class11_pct", title: "Class 11th Percentage", help: "" },
  { key: "class10_pct", title: "Class 10th Percentage", help: "" },
] as const;
export type NumberKey = (typeof NUMBER_QUESTIONS)[number]["key"];

export const FINANCIAL_TITLE = "Financial Capability";
export const FINANCIAL_HELP =
  "Choose the option that best describes the student's ability to afford Vedam's ₹18L tuition over 4 years. Consider income, profession, financial conversations during the interview, and interest in loans/scholarships.";
export const FINANCIAL_OPTIONS = [
  { value: "high", label: "High", help: "Family income is ₹15L+ per year, parents have strong financial background (e.g., corporate, business, NRI), can afford Vedam without loans or aid." },
  { value: "medium", label: "Medium", help: "Family income is ₹6–15L per year, middle-class background (e.g., salaried, small business), may need loan or scholarship but can likely afford." },
  { value: "low", label: "Low", help: "Family income is < ₹6L, financially constrained background (e.g., single parent, farming, daily wage), clearly dependent on aid or loan." },
] as const;

/** Free-text questions (with the database's length limits). */
export const TEXT_QUESTIONS = {
  previous_jee: { title: "If a drop year was taken, what was the previous year's JEE Mains percentile? (or N/A)", max: 200 },
  other_exams: { title: "Any Other Exam Score (if any) (or N/A)", max: 300 },
  financial_reason: { title: "Why? (Financial explanation)", max: 500 },
  why_accept: { title: "Why should Vedam accept your application and what could the batch learn from you?", max: 1500 },
} as const;
export type TextKey = keyof typeof TEXT_QUESTIONS;
export const REMARK_MAX = 1000;
export const DROP_YEAR_TITLE = "Was a drop year taken?";

/** What the form holds while it is being filled in. */
export type InterviewFormState = {
  parts: Record<Part, number | null>;
  remarks: Record<Part, string>;
  cheating: YesNo;
  coding_talent: YesNo;
  cert_asked: YesNo;
  drop_year: YesNo;
  numbers: Record<NumberKey, { value: string; na: boolean }>;
  text: Record<TextKey, string>;
  financial: "" | "high" | "medium" | "low";
};

export function emptyInterviewForm(): InterviewFormState {
  const parts = { communication: null, logic: null, passion: null, achievements: null, why_program: null };
  const remarks = { communication: "", logic: "", passion: "", achievements: "", why_program: "" };
  const numbers = Object.fromEntries(NUMBER_QUESTIONS.map((q) => [q.key, { value: "", na: false }])) as InterviewFormState["numbers"];
  const text = { previous_jee: "", other_exams: "", financial_reason: "", why_accept: "" };
  return { parts, remarks, cheating: "", coding_talent: "", cert_asked: "", drop_year: "", numbers, text, financial: "" };
}

const partTitle = (k: Part) => PART_QUESTIONS.find((q) => q.key === k)?.title ?? k;
const yesNo = (v: YesNo) => v === "yes";

/** The questions after the five parts, in the form's order (sheet columns N–Z). */
export const LATER_ORDER = [
  "drop_year", "previous_jee", "jee_pct", "jee_maths_pct", "expected_jee_pct", "other_exams",
  "class12_pct", "class11_pct", "class10_pct", "financial", "financial_reason", "why_accept",
] as const;

const noNa = (t: string) => t.replace(/ \(or N\/A\)$/, "");

/**
 * The request for vsat_submit_interview, or the list of what is still missing / wrong (in the form's order).
 * Every question is required; a number is 0–100 (up to 2 decimals) or N/A.
 */
export function buildInterviewRequest(applicationId: string, f: InterviewFormState):
  { ok: true; p: Record<string, unknown> } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const p: Record<string, unknown> = { application_id: applicationId };
  const remarks: Record<string, string> = {};

  // the five parts: mark, the question that goes with it (cheating / coding talent / certificate), then the remark
  for (const q of PART_QUESTIONS) {
    const v = f.parts[q.key];
    if (v === null || !Number.isInteger(v) || v < 1 || v > 5) errors.push(`${q.title}: pick 1 to 5`);
    else p[q.key] = v;
    if (q.key === "logic") {
      if (f.cheating === "") errors.push("Cheating while solving questions: pick an answer");
      else p.cheating_seen = yesNo(f.cheating);
    }
    for (const [k, y] of Object.entries(YES_NO) as [keyof typeof YES_NO, (typeof YES_NO)[keyof typeof YES_NO]][]) {
      if (y.after !== q.key) continue;
      if (f[k] === "") errors.push(`${k === "coding_talent" ? "Possible coding talent" : "National-level certificate"}: pick yes or no`);
      else p[k] = yesNo(f[k]);
    }
    const r = f.remarks[q.key].trim();
    if (!r) errors.push(`${q.remarkTitle}: please write a remark`);
    else if (r.length > REMARK_MAX) errors.push(`${q.remarkTitle}: ${REMARK_MAX} characters at most`);
    else remarks[q.key] = r;
  }
  p.remarks = remarks;

  for (const k of LATER_ORDER) {
    if (k === "drop_year") {
      if (f.drop_year === "") errors.push("Drop year: pick yes or no");
      else p.drop_year = yesNo(f.drop_year);
    } else if (k === "financial") {
      if (!f.financial) errors.push(`${FINANCIAL_TITLE}: pick High, Medium or Low`);
      else p.financial_capability = f.financial;
    } else if (k in TEXT_QUESTIONS) {
      const q = TEXT_QUESTIONS[k as TextKey];
      const v = f.text[k as TextKey].trim();
      const na = q.title.endsWith("(or N/A)");
      if (!v) errors.push(`${noNa(q.title)}: please answer${na ? " (write N/A if it does not apply)" : ""}`);
      else if (v.length > q.max) errors.push(`${noNa(q.title)}: ${q.max} characters at most`);
      else p[k] = v;
    } else {
      const q = NUMBER_QUESTIONS.find((x) => x.key === k)!;
      const n = f.numbers[q.key];
      if (n.na) continue;  // N/A → saved as empty
      const t = n.value.trim();
      const v = Number(t);
      if (!t) errors.push(`${noNa(q.title)}: enter a number or tick N/A`);
      else if (!/^\d{1,3}(\.\d{1,2})?$/.test(t) || !Number.isFinite(v) || v < 0 || v > 100) errors.push(`${noNa(q.title)}: a number from 0 to 100`);
      else p[q.key] = v;
    }
  }

  return errors.length ? { ok: false, errors } : { ok: true, p };
}

/** Part titles for messages elsewhere (e.g. the drawer). */
export const partLabel = partTitle;

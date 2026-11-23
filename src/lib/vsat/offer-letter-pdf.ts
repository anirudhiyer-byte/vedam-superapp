import { readFileSync } from "node:fs";
import path from "node:path";
import PDFDocument from "pdfkit";
import { CAMPUS_LETTER, SEASON, inr, letterNumbers, type LetterInput, type LetterNumbers } from "./offer-letter";

/**
 * VSAT offer (Acceptance) letter as a PDF, drawn with pdfkit (pure JS, no browser), A4, 4 pages, laid out
 * like the approved sample letters: violet letterhead with the logo and the orange→violet bar, Nunito Sans,
 * the faint brand shapes on the right, the gradient bar at the foot of every page.
 *
 * Fonts (Nunito Sans, SIL OFL; small static cuts with the ₹ sign) and the logo live in
 * offer-letter-assets/ and are shipped with the functions that build the letter (next.config.mjs,
 * outputFileTracingIncludes). Server-only.
 */

if (typeof window !== "undefined") throw new Error("vsat/offer-letter-pdf is server-only");

const ASSETS = path.join(process.cwd(), "src/lib/vsat/offer-letter-assets");
let cache: { regular: Buffer; medium: Buffer; bold: Buffer; italic: Buffer; logo: Buffer } | null = null;
function assets() {
  if (!cache) {
    const f = (n: string) => readFileSync(path.join(ASSETS, n));
    cache = { regular: f("NunitoSans-Regular.ttf"), medium: f("NunitoSans-Medium.ttf"), bold: f("NunitoSans-Bold.ttf"), italic: f("NunitoSans-Italic.ttf"), logo: f("vedam-logo-white.png") };
  }
  return cache;
}

const VIOLET_DARK = "#2B135C";
const ORANGE = "#F97D03";
const VIOLET = "#8A18FF";
const INK = "#1E1E1E";
const LINK = "#1a8cd8";
const GRID = "#cfcfcf";
const HEAD_BG = "#eeeeee";
const UGC_URL = "https://www.ugc.gov.in/pdfnews/1857727_Fee-Refund-Policy-2025-26.pdf";

const PW = 595.28;
const PH = 841.89;
const X = 37;            // text left edge
const TW = 520;          // text width

type Seg = { t: string; b?: boolean; i?: boolean; link?: string };
type Doc = PDFKit.PDFDocument;

const days = (n: number) => `${n} day${n === 1 ? "" : "s"}`;

export function buildOfferLetterPdf(input: LetterInput): Promise<Buffer> {
  const a = assets();
  const c = CAMPUS_LETTER[input.campus];
  const num = letterNumbers(c, input);
  const hasSch = num.totalScholarship > 0;
  const N = Math.max(0, Math.round(input.days));

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 0, autoFirstPage: false, font: a.regular as unknown as string,
      info: { Title: `Acceptance Letter – ${input.name}`, Author: "Vedam School of Technology", Subject: "Acceptance Letter" } });
    doc.registerFont("R", a.regular);
    doc.registerFont("M", a.medium);
    doc.registerFont("B", a.bold);
    doc.registerFont("I", a.italic);
    const chunks: Buffer[] = [];
    doc.on("data", (ch: Buffer) => chunks.push(ch));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // ── page 1: letter ──────────────────────────────────────────────────────────
    page(doc, true);
    doc.image(a.logo, (PW - 139) / 2, 17.7, { width: 139 });
    doc.font("B").fontSize(22).fillColor("#000000").text("ACCEPTANCE  LETTER", 0, 106, { width: PW, align: "center", characterSpacing: 0.3 });

    let y = 158;
    y = para(doc, [{ t: `Dear ${input.name.trim()},`, b: true }], y, { size: 11 }) + 13;
    y = para(doc, [
      { t: "It is with great excitement and pride that we extend our heartfelt congratulations on your acceptance into the Vedam School of Technology’s " },
      { t: "four-year undergraduate program", b: true }, { t: " for the " }, { t: `class of ${SEASON.classOf}`, b: true },
      { t: ". After a rigorous selection process, your talent, dedication, and passion for technology have set you apart, earning you a place among the brightest minds in the field." },
    ], y) + 14;
    y = para(doc, [{ t: "As a part of this Program, you are eligible to get a " }, { t: c.degree, b: true }, { t: " from " }, { t: c.university, b: true }], y) + 8;
    y = para(doc, [{ t: "Your admission into Vedam marks the beginning of an extraordinary journey where you will collaborate with faculty who code themselves, work on groundbreaking projects, and be surrounded by like-minded peers who share your enthusiasm for pushing the boundaries of technology." }], y) + 13;
    if (hasSch) {
      y = para(doc, [
        { t: "In recognition of your talent, we are pleased to announce that you are also eligible for a scholarship up to " },
        { t: `INR ${inr(num.totalScholarship)}`, b: true }, { t: " out of which " }, { t: `INR ${inr(num.year1Scholarship)}`, b: true },
        { t: " is applicable in Year 1. Students can be eligible for remaining scholarship basis year end evaluation as per criteria mentioned in T&C below." },
      ], y) + 13;
    }
    y += 12;
    y = para(doc, [{ t: "Follow the below steps to Accept Acceptance Letter and make payment of Seat Blocking Fee:", b: true }], y, { x: X + 2 }) + 8;
    y = bullets(doc, [
      [{ t: "Log on to your student dashboard: " }, { t: input.dashboardLink, link: input.dashboardLink }],
      [{ t: "You will see a button to pay the fee on the main page- ‘Enroll · pay’." }],
      [{ t: "You can make the payment through UPI, Credit / Debit card or online bank transfer." }],
      [{ t: "Send across a signed copy of this Acceptance Letter by replying to the Acceptance letter email and sharing details of payment made." }],
    ], y, { size: 11, indent: 22 }) + 22;
    y = para(doc, [{ t: "Date of Joining:", b: true }, { t: " " + SEASON.joining }], y, { x: X + 2 }) + 10;
    y = para(doc, [{ t: "Campus Location:", b: true }, { t: " " + c.location }], y, { x: X + 1 }) + 16;
    y = para(doc, [{ t: "Acceptance and Scholarship Validity", b: true }, { t: `: This Acceptance Letter, along with the accompanying scholarship benefits (if any), remains valid for ${days(N)} from the date the letter is received.` }], y, { x: X + 1 }) + 16;
    para(doc, [{ t: `We have limited intake capacity and the Acceptance letters are being released in order of priority. In case you choose not to accept the offer within the stipulated period of ${days(N)}, we shall extend the offer to candidates in the waiting list and your Acceptance letter would stand automatically cancelled.` }], y, { x: X + 1 });

    // ── page 2: fee structure ───────────────────────────────────────────────────
    page(doc);
    doc.font("B").fontSize(15).fillColor("#000000").text(`Course fee structure of ${SEASON.feeYears}`, 0, 56, { width: PW, align: "center" });
    y = feeTable(doc, num, hasSch, 88);
    if (hasSch) {
      y = para(doc, [{ t: "* Scholarship for Year 2 to Year 4 is subject to annual renewal as per the criteria in the Terms & Conditions.", i: true }], y + 8, { size: 9.5 }) ;
    }
    y += 16;
    y = para(doc, [{ t: "NOTE :" }], y) + 12;
    y = para(doc, [{ t: "The course fee mentioned above includes both the tuition fee and the upskilling fee. It does not include the hostel and mess fee. Scholarship, if any, is applicable only on the Course Fee." }], y) + 14;
    y = para(doc, [{ t: c.otherFees.lead, b: true }, { t: c.otherFees.text }], y, { gap: 1.5 }) + 14;
    y = para(doc, [{ t: "Hostel Accommodation:", b: true }], y) + 4;
    para(doc, [{ t: "For detailed information regarding student accommodation, including facilities, charges, and availability, please visit the Hostel Fee section ( Campus Page ) on our website. Accommodation is subject to availability and is allotted on a first-come, first-served basis. We recommend reviewing the available options and completing your accommodation arrangements at the earliest to secure your preferred choice." }], y);

    // ── page 3: scholarship continuity + refund policy ─────────────────────────
    page(doc);
    y = para(doc, [{ t: "Scholarships at Vedam are performance-linked and can increase up to 50% based on a student's annual academic performance and overall standing. Detailed scholarship continuity, retention, and enhancement criteria will be shared with all students at the beginning of the academic session." }], 46) + 14;
    y = para(doc, [{ t: "NOTE", b: true }, { t: ": Please refer to Refund Policy on Page 3 and Terms & Conditions on Page 4. Students and parents are encouraged to review these terms carefully before making any decisions.", i: true }], y, { size: 9 }) + 16;
    y = para(doc, [{ t: "Refund Policy for VSAT :", b: true }], y) + 10;
    y = para(doc, [{ t: "This policy applies solely to seat blocking fees and does not cover other fees or charges unless explicitly mentioned." }], y, { size: 10 }) + 9;
    y = bullets(doc, [
      [{ t: "Students must submit an official refund request via email to connect@vedam.org from their registered email ID. The request must include payment details and the reason for the refund." }],
      [{ t: "Refunds will be credited to a designated bank account, and students must provide accurate bank details with proof. The institution is not responsible for refunds processed with incorrect details provided by the student or parent." }],
      [{ t: "Special consideration refund requests will be processed only after verification and must be submitted within the deadline. Such requests must be made within 14 days of the official Class 12th result announcement date." }],
      [{ t: "VSAT Exam Fee is non-refundable. Semester fees, if paid, are refundable as per the " }, { t: "UGC Refund Policy 2025-26", link: UGC_URL }, { t: " or any updates made to the same afterwards. Refunds, if approved, will be processed in 45 days from the approval date." }],
    ], y, { size: 10, indent: 17, gap: 0 }) + 34;
    y = para(doc, [{ t: "Basic Refund Requests: For any student who has made seat blocking fee payment", b: true }], y) + 12;
    y = simpleTable(doc, ["Request Made", "Policy Guideline\n[% Refund of Seat Block Fee applicable]"], [
      ["Within 7 days of Payment", "90% Refund"],
      ["Between 8th and 30th Day", "75% Refund"],
      ["Between 31st Day and the Orientation Start Day", "50% Refund"],
      ["From Orientation Day 1 Onwards", "0% Refund"],
    ], y, [222, 297]) + 26;
    y = para(doc, [{ t: `Unique Consideration Refund Requests: For Students pursuing 12th Class in ${SEASON.classOf} and If the student’s final Class 12th score is below 50%`, b: true }], y, { size: 10 }) + 12;
    simpleTable(doc, ["Criteria", "Policy Guideline\n[% Refund of Seat Block Fee applicable]"], [
      ["Requests made within 14 days of the official Class 12th result announcement date.", "90% Refund"],
    ], y, [210, 309]);

    // ── page 4: terms & conditions + signature ─────────────────────────────────
    page(doc);
    y = para(doc, [{ t: "Standard Terms & Conditions:", b: true }], 45) + 6;
    y = bullets(doc, [
      [{ t: "Candidates should be eligible as per university guidelines. If the candidate is still pursuing class 12th, however, provisional admission will be granted till submission of final result and documents." }],
      [{ t: "Apart from the Vedam School of Technology Scholarship Program, no other scholarship (monetary / voucher /accessories) is offered by Vedam School of Technology. In case you are offered any other kind of scholarship, it will be considered fraudulent activity." }],
      [{ t: "Any announcement regarding the commencement of the classes, orientation, community engagement programs, etc. will be made only through our official email." }],
      [{ t: `The B.Tech in Computer Science [AI] degree is being offered by ${c.tcUniversity}. Vedam School of Technology is not a franchisee or an affiliated college. We work with universities to provide industry-ready education.` }],
      [{ t: "Your seat will only be booked when you pay the Seat blocking fee mentioned in this letter." }],
      [{ t: "Students must compulsorily upload their documents online (as required by the college) on the Vedam School of Technology website to be eligible for registration formalities." }],
      [{ t: "It is mandatory to make the complete first sem fee payment before the classes commence. No such student with dues pending will be allowed in the class. In case there is a delay in fee payment as per the schedule mentioned, you will be required to make late payment charges." }],
      [{ t: "Scholarship Support, if any, shall be released in four equal parts at the start of each academic year. Scholarship is renewed each academic year on the condition of :" }],
    ], y, { size: 10, indent: 17, gap: 7.5 });
    y = numbered(doc, ["Students maintaining a minimum requirement of 80% attendance,", "Above 75% (or equivalent CGPA) academic scores", "Timely clearance of all dues"], y + 1);
    y = bullets(doc, [
      [{ t: "The scholarship, if any, is independent of mess and hostel fees, and does not provide coverage for them." }],
      [{ t: `The Acceptance letter and scholarship is valid only for ${days(N)} from the date the letter is received.` }],
      [{ t: "Non acceptance within stipulated period results in automatic cancellation." }],
      [{ t: "In Case a candidate seeks refund against his/her college admission, the refund policy as mentioned on page 3 shall be applicable." }],
    ], y + 7, { size: 10, indent: 17, gap: 7.5 }) + 24;
    y = para(doc, [{ t: "Once again, congratulations on this incredible achievement! We are thrilled to welcome you into the Vedam School community and cannot wait to see the impact you will make." }], y, { size: 10 }) + 7;
    y = para(doc, [{ t: "In case you have any query/issue, you can reach out to us at connect@vedam.org" }], y, { size: 10 }) + 7;
    y = para(doc, [{ t: "You can confirm your acceptance of this Acceptance Letter by signing below and replying to your Acceptance letter mail by sending a digital image of the signed letter." }], y, { size: 10 }) + 7;
    para(doc, [{ t: "By signing this document, you confirm that all the information provided on the Vedam portal is accurate and up to date. Any discrepancies or inaccuracies may result in the cancellation of your scholarship and automatic termination of your admission." }], y, { size: 10 });
    for (const [i, l] of ["Name: ___________________________", "Date of Signature: _________________", "Signature: ________________________"].entries()) {
      doc.font("R").fontSize(11).fillColor(INK).text(l, X, 720 + i * 27, { lineBreak: false });
    }

    doc.end();
  });
}

/** Base64 for an email attachment. */
export async function buildOfferLetterPdfBase64(input: LetterInput): Promise<string> {
  return (await buildOfferLetterPdf(input)).toString("base64");
}

// ── drawing helpers ─────────────────────────────────────────────────────────────

function gradientBar(doc: Doc, y: number, h: number) {
  const g = doc.linearGradient(0, 0, PW, 0);
  g.stop(0, ORANGE).stop(0.5, "#C24B82").stop(1, VIOLET);
  doc.rect(0, y, PW, h).fill(g);
}

/** New page: faint brand shapes on the right, the foot bar, and on the first page the letterhead. */
function page(doc: Doc, letterhead = false) {
  doc.addPage({ size: "A4", margin: 0 });
  doc.save();
  doc.polygon([464, 248.7], [PW + 40, 248.7], [PW + 95, 393.9], [519.2, 393.9]).fill("#FEF5ED");
  doc.circle(596, 511, 94).fill("#F6EEFF");
  doc.restore();
  gradientBar(doc, PH - 3.4, 3.4);
  if (letterhead) {
    doc.rect(0, 0, PW, 80.5).fill(VIOLET_DARK);
    gradientBar(doc, 80.5, 5.2);
  }
  doc.fillColor(INK);
}

/** Rich paragraph (bold / italic / link runs). Returns the y below it. */
function para(doc: Doc, segs: Seg[], y: number, o: { x?: number; w?: number; size?: number; gap?: number; align?: "left" | "center" } = {}): number {
  const x = o.x ?? X;
  const w = o.w ?? TW - (x - X);
  const size = o.size ?? 11;
  doc.fontSize(size);
  segs.forEach((s, i) => {
    const last = i === segs.length - 1;
    doc.font(s.b ? "B" : s.i ? "I" : "R").fillColor(s.link ? LINK : INK);
    const opts: PDFKit.Mixins.TextOptions = { width: w, lineGap: o.gap ?? -0.6, continued: !last, align: o.align ?? "left", link: s.link ?? null, underline: false };
    if (i === 0) doc.text(s.t, x, y, opts);
    else doc.text(s.t, opts);
  });
  doc.fillColor(INK);
  return doc.y;
}

/** Bulleted list (• at the left). Returns the y below it. */
function bullets(doc: Doc, items: Seg[][], y: number, o: { size?: number; indent?: number; gap?: number } = {}): number {
  const size = o.size ?? 11;
  const ind = o.indent ?? 20;
  for (const segs of items) {
    doc.circle(X + ind - 9, y + size * 0.62, size >= 11 ? 2 : 1.8).fill("#000000");
    y = para(doc, segs, y, { x: X + ind, size }) + (o.gap ?? 0);
  }
  return y;
}

function numbered(doc: Doc, items: string[], y: number): number {
  items.forEach((t, i) => {
    doc.font("R").fontSize(10).fillColor(INK).text(`${i + 1}.  ${t}`, X + 30, y, { width: TW - 30, lineGap: -0.6 });
    y = doc.y;
  });
  return y;
}

function cell(doc: Doc, text: string, x: number, y: number, w: number, h: number, o: { font?: string; size?: number; color?: string; bg?: string; border?: boolean } = {}) {
  if (o.bg) doc.rect(x, y, w, h).fill(o.bg);
  if (o.border !== false) doc.rect(x, y, w, h).lineWidth(0.6).strokeColor(GRID).stroke();
  const size = o.size ?? 10.5;
  doc.font(o.font ?? "R").fontSize(size).fillColor(o.color ?? INK);
  const th = doc.heightOfString(text, { width: w - 10, align: "center", lineGap: -0.6 });
  doc.text(text, x + 5, y + (h - th) / 2, { width: w - 10, align: "center", lineGap: -0.6 });
}

/** The fee table. With a scholarship: Course fee | Scholarship | Amount payable | Due date. */
function feeTable(doc: Doc, n: LetterNumbers, hasSch: boolean, y: number): number {
  const cols = hasSch ? [124, 92, 92, 98, 113] : [180, 170, 169];
  const head = hasSch ? ["", "Course Fee Amount", "Scholarship", "Amount Payable", "Due Date (Tentative)"] : ["", "Course Fee Amount", "Due Date (Tentative)"];
  const xs = cols.map((_, i) => X + 1 + cols.slice(0, i).reduce((a, b) => a + b, 0));
  const rupee = (v: number) => `₹ ${inr(v)}`;
  const headH = 36;
  head.forEach((t, i) => cell(doc, t, xs[i], y, cols[i], headH, { font: "B", bg: HEAD_BG }));
  y += headH;
  for (const r of n.rows) {
    const h = r.label === "Seat Blocking Amount" ? 38 : 30.5;
    const vals = hasSch
      ? [r.label, rupee(r.fee), r.scholarship ? `− ${rupee(r.scholarship)}` : "—", rupee(r.payable), r.due]
      : [r.label, rupee(r.fee), r.due];
    vals.forEach((t, i) => cell(doc, t, xs[i], y, cols[i], h, { size: hasSch && i === cols.length - 1 ? 9.5 : 10.5, bg: "#ffffff" }));
    y += h;
  }
  const tot = hasSch
    ? ["Total", rupee(n.programmeFee), `− ${rupee(n.totalScholarship)}`, rupee(n.payableTotal), ""]
    : ["Total", rupee(n.programmeFee), ""];
  tot.forEach((t, i) => cell(doc, t, xs[i], y, cols[i], 30.5, { font: "B", bg: VIOLET, color: "#ffffff" }));
  return y + 30.5;
}

/** Two-column policy table (grey header). */
function simpleTable(doc: Doc, head: [string, string], rows: [string, string][], y: number, cols: [number, number]): number {
  const xs = [X + 1, X + 1 + cols[0]];
  const headH = 44;
  head.forEach((t, i) => cell(doc, t, xs[i], y, cols[i], headH, { font: "B", bg: HEAD_BG, size: 10.5 }));
  y += headH;
  for (const r of rows) {
    const h = Math.max(38, doc.font("R").fontSize(10.5).heightOfString(r[0], { width: cols[0] - 10 }) + 14);
    r.forEach((t, i) => cell(doc, t, xs[i], y, cols[i], h, { size: 10.5, bg: "#ffffff" }));
    y += h;
  }
  return y;
}

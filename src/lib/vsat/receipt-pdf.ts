import PDFDocument from "pdfkit";
import type { VsatReceiptData } from "@/lib/payments/vsat-receipt";

/**
 * Branded VSAT receipt as a PDF (pdfkit — pure JS, serverless-cheap, no chromium).
 * Used for the payment_confirmed email attachment. Amounts are printed as "Rs." so we
 * stay on the standard Helvetica font (the ₹ glyph isn't in the AFM core fonts); the
 * on-screen HTML receipt keeps ₹.
 */

const INK = "#1c1733";
const MUTE = "#7a7790";
const PURPLE = "#2B135C";
const GREEN = "#1a7f4b";
const LINE = "#ece9f3";

const money = (n: number, cur?: string) => `${cur && cur !== "INR" ? cur + " " : "Rs. "}${Number(n).toFixed(2)}`;

export function buildReceiptPdf(d: VsatReceiptData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 0 });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const W = doc.page.width;      // ~595
    const M = 54;                  // content margin
    const cw = W - M * 2;

    // ── header band ──
    doc.rect(0, 0, W, 132).fill(PURPLE);
    doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(17).text("Vedam School of Technology", M, 34);
    doc.font("Helvetica").fontSize(9.5).fillColor("#d9ccf2")
      .text("SET Education Technology Pvt. Ltd.  ·  Pune  ·  Gurugram", M, 58);
    // success pill
    doc.roundedRect(M, 82, 168, 24, 12).fill("#eafaf0");
    doc.fillColor(GREEN).font("Helvetica-Bold").fontSize(10).text("PAYMENT SUCCESSFUL", M + 14, 89);

    // ── amount block ──
    let y = 160;
    doc.fillColor(MUTE).font("Helvetica").fontSize(9).text("AMOUNT PAID", M, y);
    doc.fillColor(PURPLE).font("Helvetica-Bold").fontSize(26).text(money(d.amount, d.currency), M, y + 13);
    doc.fillColor(INK).font("Helvetica-Bold").fontSize(12).text(d.itemLabel, M, y + 2, { width: cw, align: "right" });
    doc.fillColor(MUTE).font("Helvetica").fontSize(10).text(d.feeNote, M, y + 20, { width: cw, align: "right" });

    y += 60;
    doc.moveTo(M, y).lineTo(W - M, y).strokeColor(LINE).lineWidth(1).stroke();
    y += 14;

    // ── detail rows ──
    const row = (k: string, v: string, ok = false) => {
      doc.fillColor(MUTE).font("Helvetica").fontSize(10.5).text(k, M, y);
      doc.fillColor(ok ? GREEN : INK).font("Helvetica-Bold").fontSize(10.5).text(v, M, y, { width: cw, align: "right" });
      y += 15;
      doc.moveTo(M, y).lineTo(W - M, y).strokeColor(LINE).dash(1, { space: 2 }).lineWidth(0.7).stroke().undash();
      y += 9;
    };
    if (d.payerName) row("Paid by", d.payerName);
    if (d.payerEmail) row("Email", d.payerEmail);
    row("Date & time", new Date(d.paidAtIso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) + " IST");
    row("Item", d.itemLabel);
    if (Number(d.discount) > 0) {
      row("Fee", money(d.baseAmount, d.currency));
      row(`Discount${d.coupon ? " (" + d.coupon + ")" : ""}`, "- " + money(d.discount, d.currency), true);
    }
    row("Amount paid", money(d.amount, d.currency));
    row("Receipt no.", d.receiptNo);
    row("Order ID", d.orderId);
    if (d.paymentId) row("Cashfree payment ID", d.paymentId);
    if (d.method) row("Payment method", d.method);
    row("Status", "Paid", true);

    // ── footer ──
    y += 10;
    doc.fillColor(MUTE).font("Helvetica").fontSize(9).text(
      "This is a computer-generated receipt for your VSAT payment, processed securely via Cashfree. No signature required. For any query, write to connect@vedam.org.",
      M, y, { width: cw, lineGap: 2 },
    );

    doc.end();
  });
}

/** Convenience: receipt PDF as a base64 string (for email attachment). */
export async function buildReceiptPdfBase64(d: VsatReceiptData): Promise<string> {
  const buf = await buildReceiptPdf(d);
  return buf.toString("base64");
}

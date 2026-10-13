/** Branded payment receipt (server + email safe). Used by the receipt email and the
 *  downloadable receipt route. Mirrors the approved mockup. */

const LOGO = (process.env.NEXT_PUBLIC_SITE_URL || "https://one.vedam.org") + "/vedam-logo-dark.png?v=2";

const esc = (s: string) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export type ReceiptData = {
  receiptNo: string;
  orderId: string;
  paymentId?: string | null;
  method?: string | null;
  amount: number;
  currency?: string;
  payerName?: string | null;
  payerEmail?: string | null;
  eventName: string;
  eventCode?: string | null;
  paidAtIso: string;        // ISO timestamp of payment
};

export function receiptHtml(d: ReceiptData): string {
  const cur = d.currency === "INR" || !d.currency ? "₹" : esc(d.currency) + " ";
  const amt = `${cur}${Number(d.amount).toFixed(2)}`;
  const when = new Date(d.paidAtIso).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  }) + " IST";
  const row = (k: string, v: string, mono = false, ok = false) =>
    `<tr><td style="padding:12px 0;border-bottom:1px dashed #ece9f3;font:400 13.5px Arial,sans-serif;color:#7a7790">${esc(k)}</td>
     <td style="padding:12px 0;border-bottom:1px dashed #ece9f3;text-align:right;font:600 13.5px ${mono ? "'IBM Plex Mono',monospace" : "Arial,sans-serif"};color:${ok ? "#1a7f4b" : "#1c1733"};word-break:break-all">${esc(v)}</td></tr>`;

  return `<!doctype html><html><body style="margin:0;background:#f4f2f8;font-family:Arial,sans-serif;padding:24px 12px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #ece9f3;box-shadow:0 20px 50px -26px rgba(43,19,92,.4)">
    <tr><td style="background:linear-gradient(125deg,#2B135C 0%,#5b1ec9 55%,#8A18FF 100%);padding:24px 28px;color:#fff">
      <img src="${LOGO}" alt="Vedam School of Technology" height="28" style="height:28px;display:block;border:0;margin-bottom:10px" />
      <div style="font:800 18px Arial,sans-serif">Vedam School of Technology</div>
      <div style="font:400 12px Arial,sans-serif;opacity:.82;margin-top:3px">SET Education Technology Pvt. Ltd. &middot; Pune &middot; Gurugram</div>
      <div style="display:inline-block;margin-top:13px;background:#eafaf0;color:#1a7f4b;border:1px solid #b7e4c7;border-radius:999px;padding:5px 13px;font:800 12px Arial,sans-serif">&#10003; PAYMENT SUCCESSFUL</div>
    </td></tr>
    <tr><td style="padding:22px 28px;border-bottom:1px solid #ece9f3">
      <table role="presentation" width="100%"><tr>
        <td><div style="font:400 11px Arial,sans-serif;color:#7a7790;text-transform:uppercase;letter-spacing:1px">Amount paid</div>
          <div style="font:800 32px Arial,sans-serif;color:#2B135C;line-height:1;margin-top:4px">${amt}</div></td>
        <td style="text-align:right"><div style="font:700 15px Arial,sans-serif;color:#1c1733">${esc(d.eventName)}</div>
          <div style="font:400 13px Arial,sans-serif;color:#7a7790;margin-top:2px">Registration fee</div></td>
      </tr></table>
    </td></tr>
    <tr><td style="padding:6px 28px 2px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      ${d.payerName ? row("Paid by", d.payerName) : ""}
      ${d.payerEmail ? row("Email", d.payerEmail) : ""}
      ${row("Date & time", when)}
      ${row("Event", `${d.eventName}${d.eventCode ? " · " + d.eventCode : ""}`)}
      ${row("Receipt no.", d.receiptNo, true)}
      ${row("Order ID", d.orderId, true)}
      ${d.paymentId ? row("Cashfree payment ID", d.paymentId, true) : ""}
      ${d.method ? row("Payment method", d.method) : ""}
      ${row("Status", "Paid", false, true)}
    </table></td></tr>
    <tr><td style="padding:18px 28px 24px;background:#faf9fd;border-top:1px solid #ece9f3;font:400 11.5px Arial,sans-serif;color:#7a7790;line-height:1.6">
      This is a computer-generated receipt for your event registration payment, processed securely via Cashfree. No signature required.
      For any query, write to <a href="mailto:connect@vedam.org" style="color:#8A18FF;text-decoration:none;font-weight:700">connect@vedam.org</a>.
      <div style="margin-top:6px"><a href="https://vedam.org" style="color:#8A18FF;text-decoration:none;font-weight:700">vedam.org</a></div>
    </td></tr>
  </table></td></tr></table></body></html>`;
}

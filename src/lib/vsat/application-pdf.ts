/**
 * Print-ready HTML for a student's full VSAT application → the browser's
 * "Save as PDF". Mirrors the receipt pattern (server-rendered HTML, no heavy PDF
 * dependency). Renders the applicant summary, every form category with its
 * answers, and embeds any uploaded document images (file-type answers that are
 * image links). Owner-gated by the route that calls this.
 */

const BRAND = "linear-gradient(125deg,#2B135C 0%,#5b1ec9 55%,#8A18FF 100%)";
const LOGO = (process.env.NEXT_PUBLIC_SITE_URL || "https://one.vedam.org") + "/vedam-logo-dark.png?v=2";

const esc = (s: unknown) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const isUrl = (v: string) => /^https?:\/\/\S+$/i.test(v.trim());
const isImg = (v: string) => /\.(png|jpe?g|webp|gif|bmp|heic)(\?|$)/i.test(v.trim()) || /\/storage\/v1\/object\/public\//.test(v);

export type Question = { key: string; label: string; type: string };
export type Category = { key: string; label: string; questions: Question[] };

export type ApplicationPdfData = {
  applicationNo: string;
  name: string;
  email: string | null;
  phone: string | null;
  campus: string | null;
  stream: string | null;
  statusLabel: string | null;
  createdAtIso: string | null;
  formName: string;
  categories: Category[];
  answers: Record<string, Record<string, string>>;
};

function renderAnswer(type: string, raw: string): string {
  const v = (raw ?? "").toString().trim();
  if (!v) return `<span style="color:#b4afc4">—</span>`;
  if ((type === "file" || isImg(v)) && isUrl(v) && isImg(v)) {
    return `<div><img src="${esc(v)}" alt="document" style="max-width:220px;max-height:260px;border:1px solid #ece9f3;border-radius:8px;display:block;margin:4px 0" />
      <a href="${esc(v)}" style="font:400 11px Arial;color:#7312e0;word-break:break-all">${esc(v)}</a></div>`;
  }
  if (isUrl(v)) return `<a href="${esc(v)}" style="color:#7312e0;word-break:break-all">${esc(v)}</a>`;
  return esc(v);
}

export function applicationHtml(d: ApplicationPdfData): string {
  const when = d.createdAtIso
    ? new Date(d.createdAtIso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" })
    : "—";

  const sumRow = (k: string, v: string) =>
    `<tr><td style="padding:9px 0;border-bottom:1px dashed #ece9f3;font:400 13px Arial;color:#7a7790;width:38%">${esc(k)}</td>
     <td style="padding:9px 0;border-bottom:1px dashed #ece9f3;font:600 13px Arial;color:#1c1733">${esc(v)}</td></tr>`;

  const categories = d.categories
    .filter((c) => c.key !== "_meta")
    .map((c) => {
      const rows = (c.questions || []).map((q) => {
        const val = d.answers?.[c.key]?.[q.key] ?? "";
        return `<tr>
          <td style="padding:10px 14px 10px 0;border-bottom:1px solid #f1eef8;font:400 13px Arial;color:#6a6580;vertical-align:top;width:42%">${esc(q.label)}</td>
          <td style="padding:10px 0;border-bottom:1px solid #f1eef8;font:600 13px Arial;color:#1c1733;vertical-align:top">${renderAnswer(q.type, val)}</td>
        </tr>`;
      }).join("");
      return `<section style="margin-top:22px;break-inside:avoid">
        <h3 style="font:800 14px Arial;color:#2B135C;margin:0 0 6px;text-transform:uppercase;letter-spacing:.04em">${esc(c.label)}</h3>
        <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">${rows}</table>
      </section>`;
    }).join("");

  return `<!doctype html><html><head><meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>VSAT Application · ${esc(d.applicationNo)}</title>
  <style>@media print{.noprint{display:none!important}@page{margin:14mm}} body{margin:0}</style></head>
  <body style="background:#f4f2f8;font-family:Arial,sans-serif;padding:22px 12px;color:#1c1733">
  <div class="noprint" style="max-width:680px;margin:0 auto 14px;display:flex;justify-content:flex-end">
    <button onclick="window.print()" style="background:#8A18FF;color:#fff;border:0;border-radius:10px;padding:10px 18px;font:700 13px Arial;cursor:pointer">⬇ Download / Print as PDF</button>
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
  <table role="presentation" width="680" cellpadding="0" cellspacing="0" style="max-width:680px;width:100%;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #ece9f3">
    <tr><td style="background:${BRAND};padding:24px 28px;color:#fff">
      <img src="${LOGO}" alt="Vedam School of Technology" height="26" style="height:26px;display:block;border:0;margin-bottom:10px" />
      <div style="font:800 18px Arial">VSAT Application</div>
      <div style="font:400 12px Arial;opacity:.82;margin-top:3px">Vedam School of Technology · SET Education Technology Pvt. Ltd.</div>
    </td></tr>
    <tr><td style="padding:24px 28px">
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
        ${sumRow("Application No.", d.applicationNo)}
        ${sumRow("Name", d.name || "—")}
        ${sumRow("Email", d.email || "—")}
        ${sumRow("Phone", d.phone || "—")}
        ${d.campus ? sumRow("Campus", d.campus) : ""}
        ${d.stream ? sumRow("Stream", d.stream) : ""}
        ${d.statusLabel ? sumRow("Status", d.statusLabel) : ""}
        ${sumRow("Submitted on", when)}
      </table>
      ${categories}
      <p style="margin:26px 0 0;font:400 11px Arial;color:#a7a2b8">Generated from one.vedam.org · This is a copy of the applicant's submitted VSAT application.</p>
    </td></tr>
  </table></td></tr></table>
  </body></html>`;
}

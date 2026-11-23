/**
 * Print-ready HTML for a student's full VSAT application → the browser's "Save as PDF".
 * Renders the applicant summary and EVERY answer the student actually stored — built from the
 * saved form_data (enriched by the active form's labels/types where they still match), so answers
 * are never dropped just because the live form changed since they applied. File answers (objects /
 * arrays of {name,url,path}) render as the file name + a link/image instead of "[object Object]".
 */

const BRAND = "linear-gradient(125deg,#2B135C 0%,#5b1ec9 55%,#8A18FF 100%)";
const LOGO = (process.env.NEXT_PUBLIC_SITE_URL || "https://one.vedam.org") + "/vedam-logo-dark.png?v=2";
const DASH = `<span style="color:#b4afc4">—</span>`;

const esc = (s: unknown) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const isUrl = (v: string) => /^https?:\/\/\S+$/i.test(v.trim());
const isImg = (v: string) => /\.(png|jpe?g|webp|gif|bmp|heic)(\?|$)/i.test(v.trim()) || /\/storage\/v1\/object\/public\//.test(v);

/** Turn a stored key into a readable label when the live form no longer has one. */
function humanize(key: string): string {
  if (/^q_[a-z0-9]{4,}$/i.test(key)) return "Additional answer";
  return key.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase()).replace(/\bS\b/g, "'s");
}

/** A file answer may be {name,url,path,publicUrl,signedUrl} — pull out the best display url. */
function fileUrl(o: Record<string, unknown>): string | null {
  for (const k of ["url", "publicUrl", "signedUrl", "public_url", "href"]) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

export type Row = { label: string; type: string; value: unknown };
export type Section = { label: string; rows: Row[] };

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
  sections: Section[];
};

function fileChip(url: string | null, name?: string): string {
  const label = esc(name || (url ? url.split("/").pop() : "") || "Uploaded file");
  if (url && isImg(url)) {
    return `<div style="margin:3px 0"><img src="${esc(url)}" alt="document" style="max-width:200px;max-height:240px;border:1px solid #ece9f3;border-radius:8px;display:block;margin-bottom:3px" />
      <a href="${esc(url)}" style="font:400 11px Arial;color:#7312e0;word-break:break-all">${label}</a></div>`;
  }
  if (url) return `<a href="${esc(url)}" style="color:#7312e0;word-break:break-all">${label}</a>`;
  return `<span>${label}</span>`;
}

/** Render a single scalar/object value. */
function renderOne(type: string, v: unknown): string {
  if (v == null) return "";
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    const url = fileUrl(o);
    const name = typeof o.name === "string" ? o.name : undefined;
    if (url || name || type === "file") return fileChip(url, name);
    return esc(JSON.stringify(v));
  }
  const s = String(v).trim();
  if (!s) return "";
  if (isUrl(s) && isImg(s)) return fileChip(s);
  if (isUrl(s)) return `<a href="${esc(s)}" style="color:#7312e0;word-break:break-all">${esc(s)}</a>`;
  return esc(s);
}

/** Normalise a stored answer (which may be a JSON-encoded string, object, or array) and render it. */
function renderAnswer(type: string, raw: unknown): string {
  let v: unknown = raw;
  if (typeof v === "string") {
    const s = v.trim();
    // values are often JSON-encoded ("\"Female\"", "[{...}]") — unwrap once
    if ((s.startsWith('"') && s.endsWith('"')) || s.startsWith("[") || s.startsWith("{")) {
      try { v = JSON.parse(s); } catch { /* keep as-is */ }
    }
  }
  if (v == null || v === "") return DASH;
  if (Array.isArray(v)) {
    const parts = v.map((x) => renderOne(type, x)).filter(Boolean);
    return parts.length ? parts.join("<br>") : DASH;
  }
  const out = renderOne(type, v);
  return out || DASH;
}

export function applicationHtml(d: ApplicationPdfData): string {
  const when = d.createdAtIso
    ? new Date(d.createdAtIso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" })
    : "—";

  const sumRow = (k: string, v: string) =>
    `<tr><td style="padding:9px 0;border-bottom:1px dashed #ece9f3;font:400 13px Arial;color:#7a7790;width:38%">${esc(k)}</td>
     <td style="padding:9px 0;border-bottom:1px dashed #ece9f3;font:600 13px Arial;color:#1c1733">${esc(v)}</td></tr>`;

  const sections = d.sections
    .filter((s) => s.rows.length > 0)
    .map((s) => {
      const rows = s.rows.map((q) => `<tr>
          <td style="padding:10px 14px 10px 0;border-bottom:1px solid #f1eef8;font:400 13px Arial;color:#6a6580;vertical-align:top;width:42%">${esc(q.label)}</td>
          <td style="padding:10px 0;border-bottom:1px solid #f1eef8;font:600 13px Arial;color:#1c1733;vertical-align:top">${renderAnswer(q.type, q.value)}</td>
        </tr>`).join("");
      return `<section style="margin-top:22px;break-inside:avoid">
        <h3 style="font:800 14px Arial;color:#2B135C;margin:0 0 6px;text-transform:uppercase;letter-spacing:.04em">${esc(s.label)}</h3>
        <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">${rows}</table>
      </section>`;
    }).join("");

  return `<!doctype html><html><head><meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>VSAT Application · ${esc(d.applicationNo)}</title>
  <style>@media print{.noprint{display:none!important}@page{margin:14mm}} body{margin:0}</style></head>
  <body style="background:#f4f2f8;font-family:Arial,sans-serif;padding:22px 12px;color:#1c1733">
  <div class="noprint" style="max-width:680px;margin:0 auto 14px;display:flex;justify-content:flex-end">
    <button onclick="window.print()" style="background:#8A18FF;color:#fff;border:0;border-radius:10px;padding:10px 18px;font:700 13px Arial;cursor:pointer">Download / Print as PDF</button>
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
      ${sections}
      <p style="margin:26px 0 0;font:400 11px Arial;color:#a7a2b8">Generated from one.vedam.org · This is a copy of the applicant's submitted VSAT application.</p>
    </td></tr>
  </table></td></tr></table>
  </body></html>`;
}

/** Build the render sections from the stored answers, enriched by the (optional) active schema. */
export function buildSections(
  formData: Record<string, unknown>,
  schemaCats: { key: string; label?: string | null; questions?: { key: string; label?: string | null; type?: string | null }[] }[],
): Section[] {
  const out: Section[] = [];
  const seenCat = new Set<string>();

  const catFromSchema = (ck: string) => schemaCats.find((c) => c.key === ck);
  const qLabel = (ck: string, qk: string) => {
    const q = catFromSchema(ck)?.questions?.find((x) => x.key === qk);
    return { label: (q?.label && q.label.trim()) || humanize(qk), type: q?.type || "auto" };
  };

  const buildCat = (ck: string) => {
    if (ck === "_meta" || seenCat.has(ck)) return;
    seenCat.add(ck);
    const stored = formData[ck];
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) return;
    const storedObj = stored as Record<string, unknown>;
    const rows: Row[] = [];
    const seenQ = new Set<string>();
    // schema question order first (those that were answered), then any extra stored answers
    for (const q of catFromSchema(ck)?.questions ?? []) {
      if (!(q.key in storedObj)) continue;
      seenQ.add(q.key);
      rows.push({ label: (q.label && q.label.trim()) || humanize(q.key), type: q.type || "auto", value: storedObj[q.key] });
    }
    for (const qk of Object.keys(storedObj)) {
      if (seenQ.has(qk)) continue;
      const info = qLabel(ck, qk);
      rows.push({ label: info.label, type: info.type, value: storedObj[qk] });
    }
    const label = (catFromSchema(ck)?.label && catFromSchema(ck)!.label!.trim()) || humanize(ck);
    out.push({ label, rows });
  };

  for (const c of schemaCats) buildCat(c.key);          // schema order first
  for (const k of Object.keys(formData)) buildCat(k);   // then any extra stored categories
  return out;
}

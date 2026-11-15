/**
 * Communication Manager · Slice 4 · the document-template preview.
 * Builds the srcdoc for a sandboxed iframe (sandbox="" — no scripts, no same-origin, no forms, no popups).
 * Input is HTML the SERVER already cleaned (check route). Merge fields are filled with FAKE sample values,
 * HTML-escaped. Inside: CSP default-src 'none' (nothing can load: no scripts, images, fonts, frames or
 * connections); style-src 'unsafe-inline' only so the allowed inline styles (text-align, margin, …) render.
 * Real VSAT user data is never used here.
 */
import { MERGE_FIELDS, SAMPLE_VALUES, type MergeField } from "@/lib/comm/doc-template-rules";

/** the iframe sandbox: empty = every restriction on (no allow-scripts, no allow-same-origin) */
export const PREVIEW_SANDBOX = "";
export const PREVIEW_CSP = "default-src 'none'; style-src 'unsafe-inline'";

export const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const indiaToday = (now: Date) =>
  new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" }).format(now);

/** fake values for every merge field ({{today}} = today's date) */
export function sampleValues(now: Date = new Date()): Record<MergeField, string> {
  return { ...SAMPLE_VALUES, today: indiaToday(now) };
}

/** replace the known merge fields with escaped fake values; anything else is left as it is */
export function fillSample(cleanHtml: string, now: Date = new Date()): string {
  const v = sampleValues(now);
  return cleanHtml.replace(/\{\{([a-z_]+)\}\}/g, (m, name: string) =>
    (MERGE_FIELDS as readonly string[]).includes(name) ? escapeHtml(v[name as MergeField]) : m);
}

/** the full document for <iframe sandbox="" srcDoc={…}> */
export function buildPreviewDoc(cleanHtml: string, now: Date = new Date()): string {
  return "<!doctype html><html><head><meta charset=\"utf-8\">"
    + `<meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}">`
    + "<meta name=\"referrer\" content=\"no-referrer\">"
    + "<style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#111;background:#fff;margin:16px;line-height:1.5;overflow-wrap:anywhere}"
    + "table{border-collapse:collapse;max-width:100%}td,th{border:1px solid #ccc;padding:4px 6px}</style>"
    + `</head><body>${fillSample(cleanHtml, now)}</body></html>`;
}

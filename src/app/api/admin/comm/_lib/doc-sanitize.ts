/**
 * Communication Manager · Slice 4 · server-side cleaning of document-template HTML ("safe HTML subset").
 * Runs in the API route only; whatever the browser sends is never trusted. The database checks the
 * result again (0066, second line of defence) and the preview runs in a sandboxed iframe (third line).
 *
 * Rules (v1):
 *   - tags kept: p, h1–h4, br, hr, b, strong, i, em, u, ul, ol, li, table, thead, tbody, tr, th, td, span, div, blockquote.
 *     Any other tag is dropped (its text is kept); script / style / iframe / object / embed / svg / math / textarea /
 *     template / noscript / title / select / option / xmp / noembed / noframes are dropped WITH their content.
 *   - no links, no images, no URLs of any kind (no schemes are allowed at all).
 *   - attributes: none, except colspan / rowspan (whole numbers 1–20) on th / td, and `style` with only these
 *     properties and strict value patterns (no url(), expression(), @import, backslash escapes possible):
 *     text-align, font-weight, font-style, text-decoration, margin, padding, width, border.
 *   - comments (incl. conditional comments) and every on* handler are removed; all text is re-escaped.
 *   - control characters (except tab / newline / carriage return) are removed before parsing.
 *   - at most 40 levels of nesting; input and output at most 100 KB.
 *   - merge fields: only {{first_name}} {{full_name}} {{vsat_id}} {{campus}} {{today}}; anything else is refused.
 *   - the words "javascript:" / "vbscript:" are refused even as plain text (the database refuses them too).
 */
import sanitizeHtml from "sanitize-html";
import { DOC_MAX_BYTES, byteLength, scanMergeFields, type MergeField } from "@/lib/comm/doc-template-rules";

export const ALLOWED_TAGS = [
  "p", "h1", "h2", "h3", "h4", "br", "hr", "b", "strong", "i", "em", "u", "ul", "ol", "li",
  "table", "thead", "tbody", "tr", "th", "td", "span", "div", "blockquote",
] as const;

/** dropped together with everything inside them */
export const DROP_WITH_CONTENT = [
  "script", "style", "iframe", "object", "embed", "svg", "math", "textarea", "template", "noscript",
  "title", "select", "option", "xmp", "noembed", "noframes", "head", "frameset", "frame", "applet",
] as const;

const SPANS = Array.from({ length: 20 }, (_, i) => String(i + 1));
const LEN = "(?:0|\\d{1,4}(?:\\.\\d{1,2})?(?:px|em|rem|%|pt))";
const repeat4 = (unit: string) => new RegExp(`^${unit}(?:\\s+${unit}){0,3}$`, "i");

/** property → allowed value patterns. A value that does not match exactly is dropped. */
export const ALLOWED_STYLES: Record<string, RegExp[]> = {
  "text-align": [/^(?:left|right|center|justify)$/i],
  "font-weight": [/^(?:normal|bold|bolder|lighter|[1-9]00)$/i],
  "font-style": [/^(?:normal|italic|oblique)$/i],
  "text-decoration": [/^(?:none|underline|line-through|overline)$/i],
  margin: [repeat4(`(?:auto|-?${LEN})`)],
  padding: [repeat4(LEN)],
  width: [new RegExp(`^(?:auto|${LEN})$`, "i")],
  border: [/^(?:none|0|(?:\d{1,2}(?:px|pt)\s+)?(?:solid|dashed|dotted|double)(?:\s+(?:#[0-9a-f]{3}|#[0-9a-f]{6}|black|gray|grey|silver|white))?)$/i],
};

export type Removed = { tags: number; attributes: number; handlers: number; styles: number; comments: number; byTag: Record<string, number> };
export type SanitizeResult =
  | { ok: true; html: string; mergeFields: MergeField[]; removed: Removed; bytes: number }
  | { ok: false; reason: "too_big" | "empty" | "unknown_merge_field" | "unsafe_text"; unknown?: string[] };

const isAllowedTag = (t: string) => (ALLOWED_TAGS as readonly string[]).includes(t);

/** colspan / rowspan with a value outside 1–20 are removed completely (not left as an empty attribute) */
const cellSpans = (tagName: string, attribs: Record<string, string>) => {
  const next: Record<string, string> = {};
  for (const [k, v] of Object.entries(attribs)) {
    if ((k === "colspan" || k === "rowspan") && !SPANS.includes(v)) continue;
    next[k] = v;
  }
  return { tagName, attribs: next };
};
const CTRL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

function styleRemovals(value: string): number {
  let n = 0;
  for (const decl of value.split(";")) {
    const i = decl.indexOf(":");
    if (!decl.trim()) continue;
    if (i < 0) { n++; continue; }
    const prop = decl.slice(0, i).trim().toLowerCase();
    const val = decl.slice(i + 1).trim().replace(/\s*!important$/i, "");
    const rules = Object.prototype.hasOwnProperty.call(ALLOWED_STYLES, prop) ? ALLOWED_STYLES[prop] : null;
    if (!rules || !rules.some((r) => r.test(val))) n++;
  }
  return n;
}

export function sanitizeDocHtml(input: string): SanitizeResult {
  if (typeof input !== "string" || byteLength(input) > DOC_MAX_BYTES) return { ok: false, reason: "too_big" };
  const raw = input.replace(CTRL, "");
  const removed: Removed = { tags: 0, attributes: 0, handlers: 0, styles: 0, comments: 0, byTag: {} };
  removed.comments = (raw.match(/<!--/g) ?? []).length;

  const html = sanitizeHtml(raw, {
    allowedTags: [...ALLOWED_TAGS],
    allowedAttributes: {
      "*": ["style"],
      th: [{ name: "colspan", multiple: false, values: SPANS }, { name: "rowspan", multiple: false, values: SPANS }],
      td: [{ name: "colspan", multiple: false, values: SPANS }, { name: "rowspan", multiple: false, values: SPANS }],
    },
    allowedStyles: { "*": ALLOWED_STYLES },
    transformTags: { td: cellSpans, th: cellSpans },
    allowedSchemes: [],
    allowedSchemesByTag: {},
    allowProtocolRelative: false,
    allowedClasses: {},
    allowVulnerableTags: false,
    disallowedTagsMode: "discard",
    nonTextTags: [...DROP_WITH_CONTENT],
    nestingLimit: 40,
    enforceHtmlBoundary: false,
    parser: { lowerCaseTags: true, lowerCaseAttributeNames: true, decodeEntities: true },
    onOpenTag: (name: string, attribs: Record<string, string>) => {
      const tag = name.toLowerCase();
      if (!isAllowedTag(tag)) {
        removed.tags++;
        removed.byTag[tag] = (removed.byTag[tag] ?? 0) + 1;
      }
      for (const [k, v] of Object.entries(attribs)) {
        const a = k.toLowerCase();
        if (/^on/.test(a)) { removed.handlers++; continue; }
        if (!isAllowedTag(tag)) continue;
        if (a === "style") { removed.styles += styleRemovals(v); continue; }
        if ((a === "colspan" || a === "rowspan") && (tag === "td" || tag === "th") && SPANS.includes(v)) continue;
        removed.attributes++;
      }
    },
  });

  const bytes = byteLength(html);
  if (bytes > DOC_MAX_BYTES) return { ok: false, reason: "too_big" };
  if (!html.trim()) return { ok: false, reason: "empty" };
  // same rule as the database (0066): these words are refused anywhere, even as plain text
  if (/java\s*script\s*:|vb\s*script\s*:/i.test(html)) return { ok: false, reason: "unsafe_text" };
  const m = scanMergeFields(html);
  if (m.unknown.length) return { ok: false, reason: "unknown_merge_field", unknown: m.unknown };
  return { ok: true, html, mergeFields: m.fields, removed, bytes };
}

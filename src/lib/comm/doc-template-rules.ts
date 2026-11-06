/**
 * Communication Manager · Slice 4 · Document templates — rules shared by the server (sanitiser, routes)
 * and the browser (editor, preview). Pure TypeScript, no HTML parsing here (that is server-only, in
 * src/app/api/admin/comm/_lib/doc-sanitize.ts). The database checks the same limits again (0066).
 */

/** the only merge fields a template may use, exactly as written here (no spaces inside the braces) */
export const MERGE_FIELDS = ["first_name", "full_name", "vsat_id", "campus", "today"] as const;
export type MergeField = (typeof MERGE_FIELDS)[number];

/** 100 KB of template HTML (UTF-8 bytes), before and after cleaning */
export const DOC_MAX_BYTES = 100 * 1024;
export const DOC_NAME_MAX = 80;

const CTRL = /[\u0000-\u001f\u007f]/;

export const byteLength = (s: string): number => new TextEncoder().encode(s).length;

/** name: 1–80 characters after trimming, no control characters (same rule as the database) */
export function nameOk(name: unknown): name is string {
  if (typeof name !== "string" || CTRL.test(name)) return false;
  const n = name.trim().length;
  return n >= 1 && n <= DOC_NAME_MAX;
}

const isMergeField = (s: string): s is MergeField => (MERGE_FIELDS as readonly string[]).includes(s);

/**
 * Every {{...}} in the text must be one of MERGE_FIELDS, written exactly. Anything else — an unknown name,
 * spaces inside the braces, {{constructor}}, a stray "{{" or "}}" — is reported as unknown.
 * `fields` = the known fields used (distinct, sorted). Uses Array.includes, never an object lookup,
 * so names like "constructor" or "__proto__" can never match.
 */
export function scanMergeFields(text: string): { fields: MergeField[]; unknown: string[] } {
  const found = new Set<MergeField>();
  const unknown: string[] = [];
  // {{{x}}} means "raw, unescaped" in some template engines: never allowed
  if (/\{\{\{|\}\}\}/.test(text)) unknown.push("triple braces {{{ }}}");
  const rest = text.replace(/\{\{([^{}]{0,64})\}\}/g, (_m, name: string) => {
    if (isMergeField(name)) found.add(name);
    else unknown.push(name.length > 30 ? `${name.slice(0, 30)}…` : name);
    return "";
  });
  if (rest.includes("{{") || rest.includes("}}")) unknown.push("unmatched {{ or }}");
  return { fields: [...found].sort(), unknown: [...new Set(unknown)] };
}

/** fake values for the preview only — never a real student's data */
export const SAMPLE_VALUES: Readonly<Record<MergeField, string>> = Object.freeze({
  first_name: "Test",
  full_name: "Test Student",
  vsat_id: "VSAT-TEST-0001",
  campus: "Test Campus",
  today: "",   // filled with the current date when the preview is built
});

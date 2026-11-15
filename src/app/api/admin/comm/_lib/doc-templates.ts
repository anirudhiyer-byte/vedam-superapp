/**
 * Communication Manager · Slice 4 · Manage Document Templates — request schemas, limits and the plans
 * that clean the HTML on the server before anything reaches the database. The browser's own cleaning
 * (if any) is never trusted: every create / update / check runs sanitizeDocHtml here first, and the
 * database checks the cleaned HTML again (0066).
 */
import { z } from "zod";
import { DOC_MAX_BYTES, DOC_NAME_MAX, nameOk } from "@/lib/comm/doc-template-rules";
import { sanitizeDocHtml } from "./doc-sanitize";
import type { WritePlan } from "./write";

/** tight on purpose: a few checks + a save per edit */
export const DOC_LIMITS = { action: "comm_doctpl", perUser: 20, perIp: 60 } as const;
/** 100 KB of HTML can grow when JSON-escaped (quotes, backslashes); anything bigger is refused before parsing */
export const DOC_BODY_MAX_BYTES = 256 * 1024;

const name = z.string().max(DOC_NAME_MAX).refine(nameOk, "name");
/** characters here; the byte limit (100 KB) is checked by the sanitiser */
const html = z.string().min(1).max(DOC_MAX_BYTES);

export const createBody = z.object({ name, html }).strict();
export const checkBody = z.object({ name: name.optional(), html }).strict();
export const updateBody = z
  .object({ name: name.optional(), html: html.optional() })
  .strict()
  .refine((b) => b.name !== undefined || b.html !== undefined, "nothing to change");

/** "Check and preview": clean on the server, then the database runs every check as a dry run (admin only, nothing saved) */
export function planCheck(b: z.infer<typeof checkBody>): WritePlan {
  const r = sanitizeDocHtml(b.html);
  if (!r.ok) return { ok: false, code: "INVALID", reason: r.reason };
  return {
    ok: true, fn: "comm_doc_template_create",
    args: { p_name: b.name?.trim() || "Preview", p_html: r.html, p_dry_run: true },
    extra: { html: r.html, removed: r.removed },
  };
}

export function planCreate(b: z.infer<typeof createBody>): WritePlan {
  const r = sanitizeDocHtml(b.html);
  if (!r.ok) return { ok: false, code: "INVALID", reason: r.reason };
  return {
    ok: true, fn: "comm_doc_template_create",
    args: { p_name: b.name.trim(), p_html: r.html, p_dry_run: false },
    extra: { removed: r.removed },
  };
}

export function planUpdate(id: string, b: z.infer<typeof updateBody>): WritePlan {
  let cleaned: string | null = null;
  let removed: unknown = null;
  if (b.html !== undefined) {
    const r = sanitizeDocHtml(b.html);
    if (!r.ok) return { ok: false, code: "INVALID", reason: r.reason };
    cleaned = r.html;
    removed = r.removed;
  }
  return {
    ok: true, fn: "comm_doc_template_update",
    args: { p_id: id, p_name: b.name?.trim() ?? null, p_html: cleaned },
    extra: removed ? { removed } : undefined,
  };
}

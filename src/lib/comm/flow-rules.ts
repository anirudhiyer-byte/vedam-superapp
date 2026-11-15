/**
 * Communication Manager · Slice 6 · WhatsApp Flow drafts — rules shared by the API routes (zod) and the browser.
 * The database checks the same numbers again (0069: comm__flow_screens_check + table CHECKs), and the database
 * is the one that decides. Screens are plain text only: no "<", ">" or control characters anywhere.
 */
import { z } from "zod";

export const FLOW_NAME_MAX = 80;
export const FLOW_DESC_MAX = 300;
export const FLOW_CATEGORY_MAX = 40;
export const FLOW_SCREENS_MAX = 10;
export const FLOW_FIELDS_MAX = 12;
export const FLOW_TITLE_MAX = 60;
export const FLOW_LABEL_MAX = 80;
export const FLOW_PLACEHOLDER_MAX = 60;
export const FLOW_CTA_MAX = 30;
export const FLOW_SCREENS_MAX_BYTES = 20 * 1024;
export const FLOW_MAX_LIVE = 200;

export const FLOW_KINDS = ["text", "select", "date", "checkbox"] as const;
export const FLOW_MODULES = ["Leads", "Raw Data"] as const;
export const SCREEN_ID = /^[a-z][a-z0-9_]{0,39}$/;

/** "<", ">" and control characters (same class as the database: \x01-\x1f, \x7f-\x9f, plus NUL) */
const BAD = /[<>\u0000-\u001f\u007f-\u009f]/;
/** the description may also hold line breaks (\n) */
const BAD_DESC = /[<>\u0000-\u0009\u000b-\u001f\u007f-\u009f]/;

/** characters as the database counts them (code points, not UTF-16 units) */
export const chars = (s: string): number => [...s].length;

/** one line of plain text: no bad characters, at most `max` characters, at least `min` after trimming spaces */
export function lineOk(v: unknown, max: number, min = 1): v is string {
  return typeof v === "string" && !BAD.test(v) && chars(v) <= max && chars(v.trim()) >= min;
}
export const nameOk = (v: unknown): v is string => typeof v === "string" && !BAD.test(v) && lineOk(v.trim(), FLOW_NAME_MAX);
export const categoryOk = (v: unknown): v is string => typeof v === "string" && !BAD.test(v) && lineOk(v.trim(), FLOW_CATEGORY_MAX);
export const descriptionOk = (v: unknown): v is string => typeof v === "string" && !BAD_DESC.test(v) && chars(v) <= FLOW_DESC_MAX;

/** size of a value as Postgres prints jsonb (", " between items, ": " after keys) — the database's 20 KB rule */
export function jsonbTextBytes(v: unknown): number {
  const enc = (s: string) => new TextEncoder().encode(s).length;
  if (Array.isArray(v)) return v.length ? 2 + v.reduce((n: number, x) => n + jsonbTextBytes(x), 0) + (v.length - 1) * 2 : 2;
  if (v && typeof v === "object") {
    const e = Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined);
    return e.length ? 2 + e.reduce((n, [k, x]) => n + enc(JSON.stringify(k)) + 2 + jsonbTextBytes(x), 0) + (e.length - 1) * 2 : 2;
  }
  return enc(JSON.stringify(v ?? null));
}

const line = (max: number, min = 1) => z.string().refine((s) => lineOk(s, max, min), "text");

export const flowFieldSchema = z.object({
  label: line(FLOW_LABEL_MAX),
  kind: z.enum(FLOW_KINDS),
  placeholder: line(FLOW_PLACEHOLDER_MAX, 0).optional(),
}).strict();

export const flowScreenSchema = z.object({
  id: z.string().regex(SCREEN_ID),
  title: line(FLOW_TITLE_MAX),
  fields: z.array(flowFieldSchema).max(FLOW_FIELDS_MAX),
  cta: line(FLOW_CTA_MAX),
}).strict();

export const flowScreensSchema = z.array(flowScreenSchema).min(1).max(FLOW_SCREENS_MAX)
  .refine((s) => new Set(s.map((x) => x.id)).size === s.length, "screen ids must be unique")
  .refine((s) => jsonbTextBytes(s) <= FLOW_SCREENS_MAX_BYTES, "screens too big");

/** POST /api/admin/comm/flows — "fromId" is never sent: the browser resolves it to screens first */
export const flowCreateBody = z.object({
  name: z.string().max(FLOW_NAME_MAX * 4).refine(nameOk, "name"),
  description: z.string().max(FLOW_DESC_MAX * 4).refine(descriptionOk, "description"),
  module: z.enum(FLOW_MODULES),
  category: z.string().max(FLOW_CATEGORY_MAX * 4).refine(categoryOk, "category"),
  screens: flowScreensSchema,
}).strict();
export type FlowCreateBody = z.infer<typeof flowCreateBody>;

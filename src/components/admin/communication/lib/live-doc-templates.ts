/**
 * Communication Manager · Slice 4 · LIVE Manage Document Templates — browser client.
 * Talks only to /api/admin/comm/doc-templates/* (admin only). The browser never cleans HTML itself for
 * saving: it sends what the admin typed, the server cleans it, and "Check and preview" shows the result.
 * When DOC_TEMPLATES_LIVE is off every call refuses without sending a request (the page is the old sample page).
 */
import type { Page, Query } from "./types";
import { apiGet, apiSend } from "./live-api";
import { fmtNow } from "./live-map";
import { DOC_TEMPLATES_LIVE } from "./live-config";

export type LiveDocTemplate = {
  id: string; name: string; merge_fields: string[]; size: number; owner_is_me: boolean; created_at: string; updated_at: string;
};
export type LiveDocTemplateFull = LiveDocTemplate & { html: string };
export type DocTemplateLiveRow = {
  id: string; name: string; mergeFields: string[]; size: number; owner: string; createdOn: string; updatedOn: string;
};
export type Removed = { tags: number; attributes: number; handlers: number; styles: number; comments: number; byTag: Record<string, number> };
export type CheckResult = { html: string; mergeFields: string[]; size: number; removed: Removed };

const NOT_AVAILABLE = "Document templates are not available on live data yet.";
const assertLive = () => { if (!DOC_TEMPLATES_LIVE) throw new Error(NOT_AVAILABLE); };

/** which Manage Document Templates page the shell shows */
export const docTemplatesView = (): "live" | "mock" => (DOC_TEMPLATES_LIVE ? "live" : "mock");

/** reason codes from the server (fixed words) and status codes → what the admin reads */
export const DOC_MESSAGES: Record<string, string> = {
  "reason:unknown_merge_field": "Only these merge fields can be used: {{first_name}}, {{full_name}}, {{vsat_id}}, {{campus}}, {{today}}.",
  "reason:too_big": "The template is too big. Keep it under 100 KB.",
  "reason:empty": "Nothing is left after cleaning. Add some text or allowed tags.",
  "reason:unsafe_text": "Remove the words \"javascript:\" or \"vbscript:\"; they are not allowed in a template.",
  INVALID: "The template could not be saved. Check the name and the HTML, then try again.",
  NOT_FOUND: "This template was not found. It may have been deleted.",
  FORBIDDEN: "You do not have access to document templates.",
};

const fmt = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "-" : fmtNow(d);
};
export const toDocRow = (t: LiveDocTemplate): DocTemplateLiveRow => ({
  id: t.id, name: t.name, mergeFields: [...(t.merge_fields ?? [])], size: t.size ?? 0,
  owner: t.owner_is_me ? "You" : "Another admin", createdOn: fmt(t.created_at), updatedOn: fmt(t.updated_at),
});

/** "12.4 KB" / "830 B" */
export const fmtSize = (bytes: number) => (bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`);

type CheckAnswer = { html: string; merge_fields: string[]; size: number; removed: Removed };
const toCheck = (a: CheckAnswer): CheckResult => ({ html: a.html, mergeFields: a.merge_fields ?? [], size: a.size ?? 0, removed: a.removed });
const path = (id: string) => `doc-templates/${encodeURIComponent(id)}`;

export const docTemplatesApi = {
  list: async (q: Query): Promise<Page<DocTemplateLiveRow>> => {
    assertLive();
    const params: Record<string, string | number> = { page: q.page ?? 1, size: q.pageSize ?? 10 };
    if (q.search?.trim()) params.search = q.search.trim();
    const r = await apiGet<{ total: number; rows: LiveDocTemplate[] }>("doc-templates", params);
    return { rows: r.rows.map(toDocRow), total: r.total, refreshedAt: fmtNow() };
  },
  get: async (id: string): Promise<LiveDocTemplateFull> => { assertLive(); return apiGet<LiveDocTemplateFull>(path(id)); },
  /** clean on the server + database dry run; nothing is saved */
  check: async (html: string, name?: string): Promise<CheckResult> => {
    assertLive();
    const body = name?.trim() ? { name: name.trim(), html } : { html };
    return toCheck(await apiSend<CheckAnswer>("POST", "doc-templates/check", body, DOC_MESSAGES));
  },
  create: async (name: string, html: string) => { assertLive(); return apiSend<LiveDocTemplate>("POST", "doc-templates", { name: name.trim(), html }, DOC_MESSAGES); },
  update: async (id: string, patch: { name?: string; html?: string }) => {
    assertLive();
    return apiSend<LiveDocTemplate>("PATCH", path(id), { ...(patch.name !== undefined ? { name: patch.name.trim() } : {}), ...(patch.html !== undefined ? { html: patch.html } : {}) }, DOC_MESSAGES);
  },
  remove: async (id: string) => { assertLive(); return apiSend<{ id: string; deleted: boolean }>("DELETE", path(id), undefined, DOC_MESSAGES); },
};

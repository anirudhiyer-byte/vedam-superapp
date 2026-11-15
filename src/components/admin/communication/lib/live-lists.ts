/**
 * Communication Manager · LIVE Manage List (Slice 3a): dynamic lists = saved filters on VSAT data.
 * Counts + masked sample only. No sending, no upload, no contact data stored.
 *
 * `liveListsApi` has the same methods and shapes as the sample `listsApi` in mock-api.ts.
 * `listBuilderApi` is only used by the "New list / Edit filters / View count" drawer (live mode only).
 */
import type { ListRow, Option, Page, Query } from "./types";
import { apiGet, apiPaged, apiSend } from "./live-api";
import { fmtNow } from "./live-map";

export type ListConditions = {
  lead_stage?: string[]; application_stage?: string[]; lead_source?: string[]; utm_source?: string[]; utm_campaign?: string[];
  campus?: string[]; state?: string[]; city?: string[]; grad_year?: number[]; signup?: { from: string; to: string };
  vsat_registered?: boolean; exam_assigned?: boolean; exam_given?: boolean; consent_given?: boolean;
  payment?: "paid" | "not_paid" | "started_not_paid";
};
export type LiveList = { id: string; name: string; kind: string; conditions: Record<string, unknown>; owner_is_me: boolean; created_at: string; updated_at: string };
export type AudiencePreview = { total: number; withPhone: number; withEmail: number; consented: number; sample: { phone: string | null; email: string | null; consent: boolean }[] };

export const MULTI_KEYS = ["lead_stage", "application_stage", "lead_source", "utm_source", "utm_campaign", "campus", "state", "city", "grad_year"] as const;
export const YESNO_KEYS = ["vsat_registered", "exam_assigned", "exam_given", "consent_given"] as const;
type MultiKey = (typeof MULTI_KEYS)[number];
type YesNoKey = (typeof YESNO_KEYS)[number];
export type ListFilterOptions = Record<MultiKey, Option[]>;

/** what the drawer edits: every multi filter as string[], yes/no as "" | "yes" | "no", signup as "from..to" */
export type ListForm = Record<MultiKey, string[]> & Record<YesNoKey, "" | "yes" | "no"> & { signup: string; payment: "" | "paid" | "not_paid" | "started_not_paid" };

export const emptyListForm = (): ListForm => ({
  lead_stage: [], application_stage: [], lead_source: [], utm_source: [], utm_campaign: [], campus: [], state: [], city: [], grad_year: [],
  vsat_registered: "", exam_assigned: "", exam_given: "", consent_given: "", signup: "", payment: "",
});

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** form → conditions sent to the server (empty filters left out; the server checks everything again) */
export function buildConditions(f: ListForm): ListConditions {
  const c: ListConditions = {};
  for (const k of MULTI_KEYS) {
    const v = f[k].filter(Boolean);
    if (!v.length) continue;
    if (k === "grad_year") c.grad_year = v.map(Number).filter((n) => Number.isInteger(n));
    else c[k] = v;
  }
  for (const k of YESNO_KEYS) if (f[k]) c[k] = f[k] === "yes";
  const [from, to] = f.signup.includes("..") ? f.signup.split("..") : [f.signup, f.signup];
  if (from && to && DAY.test(from) && DAY.test(to)) c.signup = { from, to };
  if (f.payment) c.payment = f.payment;
  return c;
}

export function formFromConditions(c: ListConditions): ListForm {
  const f = emptyListForm();
  for (const k of MULTI_KEYS) {
    const v = c[k];
    if (Array.isArray(v)) f[k] = (v as (string | number)[]).map(String);
  }
  for (const k of YESNO_KEYS) if (typeof c[k] === "boolean") f[k] = c[k] ? "yes" : "no";
  if (c.signup) f.signup = `${c.signup.from}..${c.signup.to}`;
  if (c.payment) f.payment = c.payment;
  return f;
}

const WORDS: Record<string, string> = { vsat: "VSAT" };
/** "vsat_not_cleared" → "VSAT not cleared" */
export const stageLabel = (s: string) =>
  s.split("_").map((w, i) => WORDS[w] ?? (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w)).join(" ");

/** "30/09/2026 05:34 pm" (India time) */
const fmtCreated = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "-" : fmtNow(d);
};

export function toListRow(l: LiveList): ListRow {
  const who = l.owner_is_me ? "You" : "Another admin";
  const isStatic = l.kind === "static";   // Slice 3b · from a CSV upload
  return {
    id: l.id, name: l.name, tagged: false, tags: [], origin: isStatic ? "Static list (CSV)" : "Saved filter (VSAT)", totalLeads: null, uniqueEmail: null, uniqueMobile: null,
    createdOn: fmtCreated(l.created_at), createdBy: who, owner: who, live: true, conditions: l.conditions, ...(isStatic ? { static: true } : {}),
  };
}

const LIST_MESSAGES = { NOT_FOUND: "This list was not found. It may have been deleted.", INVALID: "Some values are not valid. Check the name and filters." };
const NOT_LIVE = (what: string) => new Error(`${what} is not available on live lists yet.`);
const MAX_DELETE = 20;

export const liveListsApi = {
  list: async (q: Query): Promise<Page<ListRow>> => {
    const params: Record<string, string | number> = {};
    const s = q.search?.trim();
    if (s) params.search = s.slice(0, 100);
    if (q.page) params.page = q.page;
    if (q.pageSize) params.size = Math.min(q.pageSize, 100);
    const r = await apiPaged<LiveList>("lists", params, q);
    return { rows: r.rows.map(toListRow), total: r.total, refreshedAt: fmtNow() };
  },
  /** the old filter panel (form / owner / origin) does not apply to saved filters: empty lists */
  options: async (): Promise<Record<string, Option[]>> => ({ institute: [], form: [], owner: [], origin: [] }),
  remove: async (ids: string[]): Promise<{ ok: boolean; removed: number }> => {
    if (ids.length > MAX_DELETE) throw new Error(`Delete up to ${MAX_DELETE} lists at a time.`);
    let removed = 0;
    for (const id of ids) { await apiSend("DELETE", `lists/${encodeURIComponent(id)}`, undefined, LIST_MESSAGES); removed++; }
    return { ok: true, removed };
  },
  changeOwner: async (ids: string[], owner: string): Promise<never> => { void ids; void owner; throw NOT_LIVE("Changing the owner"); },
  /** the old Edit List page: the name is saved; descriptions are not stored for live lists */
  update: async (id: string, patch: { name: string; description: string }): Promise<{ ok: boolean; id: string }> => {
    if (patch.description?.trim()) throw new Error("A description is not saved for live lists yet. Leave it empty.");
    await apiSend("PATCH", `lists/${encodeURIComponent(id)}`, { name: patch.name }, LIST_MESSAGES);
    return { ok: true, id };
  },
  setTags: async (id: string, tags: string[]): Promise<never> => { void id; void tags; throw NOT_LIVE("Tags"); },
  communicateOptions: async (): Promise<never> => { throw NOT_LIVE("Sending to a list"); },
  communicate: async (payload: { listIds: string[]; channel: string; template: string; sender: string; when: string }): Promise<never> => {
    void payload; throw NOT_LIVE("Sending to a list");
  },
};

type RawOptions = Record<MultiKey, (string | number)[]>;

export const listBuilderApi = {
  create: (name: string, conditions: ListConditions) =>
    apiSend<LiveList>("POST", "lists", { name: name.trim(), conditions }, LIST_MESSAGES).then(toListRow),
  update: (id: string, patch: { name?: string; conditions?: ListConditions }) =>
    apiSend<LiveList>("PATCH", `lists/${encodeURIComponent(id)}`, patch, LIST_MESSAGES).then(toListRow),
  preview: async (conditions: ListConditions): Promise<AudiencePreview> => {
    const r = await apiSend<{ total: number; with_phone: number; with_email: number; consented: number; sample: AudiencePreview["sample"] }>(
      "POST", "lists/preview", { conditions }, LIST_MESSAGES);
    return { total: r.total, withPhone: r.with_phone, withEmail: r.with_email, consented: r.consented, sample: r.sample ?? [] };
  },
  /** Slice 3b · live counts + masked sample of one saved list (static: its members; dynamic: its filters) */
  count: async (id: string): Promise<AudiencePreview> => {
    const r = await apiGet<{ total: number; with_phone: number; with_email: number; consented: number; sample: AudiencePreview["sample"] }>(
      `lists/${encodeURIComponent(id)}/count`);
    return { total: r.total, withPhone: r.with_phone, withEmail: r.with_email, consented: r.consented, sample: r.sample ?? [] };
  },
  filterOptions: async (): Promise<ListFilterOptions> => {
    const r = await apiGet<RawOptions>("lists/options");
    const out = {} as ListFilterOptions;
    for (const k of MULTI_KEYS) {
      const pretty = k === "lead_stage" || k === "application_stage";
      out[k] = (r[k] ?? []).map((v) => ({ value: String(v), label: pretty ? stageLabel(String(v)) : String(v) }));
    }
    return out;
  },
};

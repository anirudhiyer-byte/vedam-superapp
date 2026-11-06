/**
 * Communication Manager · LIVE WhatsApp Flow (Slice 6): flow DRAFTS saved in the database.
 *
 * Same method names and shapes as the sample-data `flowsApi` in mock-api.ts, so the page does not change.
 *  - Recommended (f1, f2) come from lib/flow-recommended.ts; their ids are never sent to the API.
 *  - My Flow = /api/admin/comm/flows (create, duplicate, delete, preview, list). Search / filters run here.
 *  - Create resolves "fromId" itself: a Recommended id → its screens copied locally; a live id → its screens are
 *    fetched first. The id itself is never sent. No fromId → the default screen.
 *  - Activate / Deactivate throw "This action is not available on live data yet." Nothing is sent to anyone and
 *    nothing is published to Meta / WhatsApp.
 * Does NOT import mock-api.ts (mock-api.ts imports this file).
 */
import type { FlowRow, FlowScreen, Option, Page, Query } from "./types";
import { FLOWS_LIVE } from "./live-config";
import { apiGet, apiSend } from "./live-api";
import { fmtNow, fmtStamp } from "./live-map";
import { DEFAULT_FLOW_CATEGORIES, RECOMMENDED_FLOWS, SCREEN_DETAILS, copyScreens, isRecommendedId } from "./flow-recommended";
import { FLOW_CATEGORY_MAX, categoryOk, flowCreateBody } from "@/lib/comm/flow-rules";

export const FLOW_NOT_LIVE = "This action is not available on live data yet.";
const GONE = "This flow no longer exists.";

/** which WhatsApp Flow data the page uses */
export const flowsView = (): "live" | "mock" => (FLOWS_LIVE ? "live" : "mock");

// ── what the routes return (comm_flow_* functions, migration 0069) ──
export type LiveFlow = {
  id: string; name: string; description: string; module: "Leads" | "Raw Data"; category: string;
  status: "Draft" | "Inactive"; created_at: string | null; screen_count: number;
};
type LiveFlowList = { total: number; rows: LiveFlow[]; categories: string[] };
type LiveFlowOne = LiveFlow & { screens: FlowScreen[] };

export const FLOW_MESSAGES: Record<string, string> = {
  CONFLICT: "A flow with this name already exists. Choose another name.",
  NOT_FOUND: GONE,
  INVALID: "Check the flow details and try again (live data keeps up to 200 flows).",
  FORBIDDEN: "Only admins can change flows.",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** "2026-11-06 12:00" → "06/11/2026, 12:00 PM" (the format the sample flows use) */
function fmtCreated(iso: string | null): string {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(fmtStamp(iso));
  if (!m) return "-";
  const h = Number(m[4]);
  return `${m[3]}/${m[2]}/${m[1]}, ${String(h % 12 === 0 ? 12 : h % 12).padStart(2, "0")}:${m[5]} ${h >= 12 ? "PM" : "AM"}`;
}

/** live row → the screen's row (whitelisted fields only; no owner, no screens) */
export function toFlowRow(x: LiveFlow): FlowRow {
  return {
    id: String(x.id), name: String(x.name ?? ""), description: String(x.description ?? ""), tag: x.module, category: String(x.category ?? ""),
    scope: "mine", createdOn: fmtCreated(x.created_at), status: x.status === "Inactive" ? "Inactive" : "Draft", module: x.module,
  };
}

// ── client-side query ──
const stampOf = (t: string) => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4}), (\d{2}):(\d{2}) (AM|PM)$/.exec(t);
  return m ? `${m[3]}-${m[2]}-${m[1]} ${String((Number(m[4]) % 12) + (m[6] === "PM" ? 12 : 0)).padStart(2, "0")}:${m[5]}` : "";
};
function query(rows: FlowRow[], q: Query): Page<FlowRow> {
  const s = q.search?.trim().toLowerCase();
  let out = s ? rows.filter((r) => [r.name, r.description, r.tag].some((v) => v.toLowerCase().includes(s))) : [...rows];
  const f = q.filters ?? {};
  if (f.category) out = out.filter((r) => r.category === f.category);
  if (f.status) out = out.filter((r) => r.status === f.status);
  if (q.sortKey) {
    const k = q.sortKey as keyof FlowRow, dir = q.sortDir === "desc" ? -1 : 1;
    out.sort((a, b) => String(a[k] ?? "").localeCompare(String(b[k] ?? "")) * dir);
  } else {
    out.sort((a, b) => stampOf(b.createdOn).localeCompare(stampOf(a.createdOn)));   // newest first
  }
  const page = q.page ?? 1, size = q.pageSize ?? out.length;
  return { rows: out.slice((page - 1) * size, page * size), total: out.length, refreshedAt: fmtNow() };
}

// ── one GET, kept for half a minute; every write forgets it ──
const KEEP_MS = 30_000;
type Kept = { at: number; rows: FlowRow[]; categories: string[] };
let cache: Kept | null = null;
let inflight: Promise<Kept> | null = null;
function load(): Promise<Kept> {
  if (inflight) return inflight;
  if (cache && Date.now() - cache.at < KEEP_MS) return Promise.resolve(cache);
  inflight = apiGet<LiveFlowList>("flows")
    .then((d) => {
      const kept: Kept = {
        at: Date.now(),
        rows: (Array.isArray(d?.rows) ? d.rows : []).map(toFlowRow),
        categories: (Array.isArray(d?.categories) ? d.categories : []).filter((c): c is string => typeof c === "string"),
      };
      cache = kept;
      return kept;
    })
    .finally(() => { inflight = null; });
  return inflight;
}
const forget = () => { cache = null; };

const recommended = (): FlowRow[] => RECOMMENDED_FLOWS.map((f) => ({ ...f, screens: copyScreens(f.screens) }));

async function allCategories(): Promise<string[]> {
  const out = [...DEFAULT_FLOW_CATEGORIES];
  const extra = [...(await load()).categories].sort((a, b) => a.localeCompare(b));
  for (const c of extra) if (!out.some((x) => x.toLowerCase() === c.toLowerCase())) out.push(c);
  return out;
}

async function getOne(id: string): Promise<LiveFlowOne> {
  if (!UUID.test(id)) throw new Error(GONE);
  try {
    return await apiGet<LiveFlowOne>(`flows/${encodeURIComponent(id)}`);
  } catch (e) {
    throw new Error(e instanceof Error && /not found/i.test(e.message) ? GONE : e instanceof Error ? e.message : GONE);
  }
}

export type NewLiveFlow = { name: string; module: "Leads" | "Raw Data"; category: string; description: string; fromId?: string };

export const liveFlowsApi = {
  /** Without a `scope` filter the Recommended list is returned (same as the sample data). */
  list: async (q: Query): Promise<Page<FlowRow>> => {
    const scope = q.filters?.scope ?? "recommended";
    if (scope !== "mine") return query(recommended(), q);
    const c = await load();
    return { ...query(c.rows, q), refreshedAt: fmtNow(new Date(c.at)) };
  },
  options: async (): Promise<Record<string, Option[]>> => ({
    status: [{ value: "Active", label: "Active" }, { value: "Draft", label: "Draft" }],
    category: (await allCategories()).map((c) => ({ value: c, label: c })),
  }),
  categories: allCategories,
  /** live: only checks the name; the category is stored with the flow that uses it */
  addCategory: async (name: string): Promise<string> => {
    const n = String(name ?? "").trim();
    if (!categoryOk(n)) throw new Error(`Use 1 to ${FLOW_CATEGORY_MAX} characters, without < or >.`);
    if ((await allCategories()).some((c) => c.toLowerCase() === n.toLowerCase())) throw new Error("This category already exists.");
    return n;
  },
  preview: async (id: string): Promise<{ name: string; screens: FlowScreen[] }> => {
    const rec = RECOMMENDED_FLOWS.find((f) => f.id === id);
    if (rec) return { name: rec.name, screens: copyScreens(rec.screens?.length ? rec.screens : [SCREEN_DETAILS]) };
    const one = await getOne(id);
    return { name: one.name, screens: Array.isArray(one.screens) ? one.screens : [] };
  },
  /** always a Draft in My Flow */
  create: async (p: NewLiveFlow): Promise<FlowRow> => {
    let screens: FlowScreen[];
    if (!p.fromId) screens = copyScreens([SCREEN_DETAILS]);
    else if (isRecommendedId(p.fromId)) screens = copyScreens(RECOMMENDED_FLOWS.find((f) => f.id === p.fromId)?.screens);
    else screens = copyScreens((await getOne(p.fromId)).screens);
    const body = { name: p.name.trim(), description: p.description.trim(), module: p.module, category: p.category.trim(), screens };
    if (!flowCreateBody.safeParse(body).success) throw new Error(FLOW_MESSAGES.INVALID);
    const row = await apiSend<LiveFlow>("POST", "flows", body, FLOW_MESSAGES);
    forget();
    return toFlowRow(row);
  },
  remove: async (id: string): Promise<void> => {
    if (!UUID.test(id)) throw new Error(GONE);
    try { await apiSend("DELETE", `flows/${encodeURIComponent(id)}`, undefined, FLOW_MESSAGES); }
    finally { forget(); }
  },
  setStatus: async (id: string, status: "Active" | "Draft"): Promise<void> => { void id; void status; throw new Error(FLOW_NOT_LIVE); },
  duplicate: async (id: string): Promise<FlowRow> => {
    if (!UUID.test(id)) throw new Error(GONE);
    try { return toFlowRow(await apiSend<LiveFlow>("POST", `flows/${encodeURIComponent(id)}/duplicate`, undefined, FLOW_MESSAGES)); }
    finally { forget(); }
  },
  /** tests: drop the kept answer */
  forget,
};

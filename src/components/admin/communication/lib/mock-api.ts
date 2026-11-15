import type {
  AutomationDetail, AutomationNode, AutomationRow, NewAutomation, CallRow, Channel, CommDetailRow, CommLogRow, CommPreview, CommStats, CommStatus, StatusDetailRow,
  FlowRow, FlowScreen, ListRow, Option, Page,
  DocFieldStage, DocStatus, DocTemplateForm, DocTemplateRow, LandingBasics, LandingTemplateRow, PerformanceSummary, Query,
  SuppressionRow,
} from "./types";
import { LIVE_PAGES } from "./live-config";
import { liveCommLogsApi, livePerformanceApi, liveSuppressionsApi } from "./live-api";
import { liveAutomationsApi } from "./live-automation";
import { liveFlowsApi } from "./live-flows";
import { csvText } from "./csv-export";
import { DEFAULT_FLOW_CATEGORIES, RECOMMENDED_FLOWS, SCREEN_DETAILS, copyScreens } from "./flow-recommended";
import { liveListsApi } from "./live-lists";

/**
 * Mock API for Communication Manager.
 *
 * ────────────────────────────────────────────────────────────────
 *  THIS IS THE ONLY FILE THAT CHANGES WHEN THE BACKEND IS READY.
 * ────────────────────────────────────────────────────────────────
 * Every export is async and takes a `Query`, exactly like a real
 * fetch/RPC would. Swap the body of each `list()` for a Supabase
 * call (or a route handler) and every screen keeps working — the
 * components never touch the arrays below.
 *
 *   e.g.  const { data, count } = await supabase
 *            .from("cm_lists")
 *            .select("*", { count: "exact" })
 *            .ilike("name", `%${q.search}%`)
 *            .range(from, to);
 *         return { rows: data.map(toListRow), total: count, refreshedAt: now() };
 */

const LATENCY = 260; // simulates a network round-trip so loading states are real
const wait = <T,>(v: T): Promise<T> => new Promise((r) => setTimeout(() => r(v), LATENCY));

const now = () =>
  new Date().toLocaleString("en-GB", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: true,
  }).replace(",", "");

// ── generic in-memory query engine (search → filter → sort → page) ──
function runQuery<T extends Record<string, unknown>>(
  source: T[],
  q: Query,
  opts: {
    searchKeys: (keyof T)[];
    filterMap?: Record<string, (row: T, value: string) => boolean>;
  },
): Page<T> {
  let rows = [...source];

  const s = q.search?.trim().toLowerCase();
  if (s) {
    rows = rows.filter((r) =>
      opts.searchKeys.some((k) => String(r[k] ?? "").toLowerCase().includes(s)),
    );
  }

  for (const [key, value] of Object.entries(q.filters ?? {})) {
    if (!value) continue;
    const fn = opts.filterMap?.[key];
    rows = fn ? rows.filter((r) => fn(r, value)) : rows.filter((r) => String(r[key] ?? "") === value);
  }

  if (q.sortKey) {
    const dir = q.sortDir === "desc" ? -1 : 1;
    rows.sort((a, b) => {
      const x = a[q.sortKey as keyof T], y = b[q.sortKey as keyof T];
      if (x == null) return 1;
      if (y == null) return -1;
      if (typeof x === "number" && typeof y === "number") return (x - y) * dir;
      return String(x).localeCompare(String(y)) * dir;
    });
  }

  const total = rows.length;
  const page = q.page ?? 1;
  const size = q.pageSize ?? rows.length;
  return { rows: rows.slice((page - 1) * size, page * size), total, refreshedAt: now() };
}

/* ══════════════════════════════════════════════════════
   MANAGE LIST
   ══════════════════════════════════════════════════════ */
const LISTS: ListRow[] = [
  { id: "-", name: "LMS", tagged: false, origin: "Leads Manager", totalLeads: null, uniqueEmail: null, uniqueMobile: null, createdOn: "-", createdBy: "-", owner: "System" },
  { id: "2003", name: "Demo21", tagged: true, tags: ["demo", "oct-batch"], form: "application", description: "Demo list for the October batch", origin: "Raw Data", totalLeads: 0, uniqueEmail: 0, uniqueMobile: 0, createdOn: "30/09/2026 17:34 PM", createdBy: "Staff User 02", owner: "Staff User 02" },
  { id: "2002", name: "Demo2", tagged: true, tags: ["demo"], form: "enquiry", description: "", origin: "Raw Data", totalLeads: 0, uniqueEmail: 0, uniqueMobile: 0, createdOn: "30/09/2026 17:33 PM", createdBy: "Staff User 02", owner: "Staff User 02" },
  { id: "2001", name: "Demo", tagged: true, tags: ["demo"], form: "application", description: "First test list", origin: "Raw Data", totalLeads: 0, uniqueEmail: 0, uniqueMobile: 0, createdOn: "30/09/2026 17:27 PM", createdBy: "Staff User 02", owner: "Staff User 02" },
];

/** "30/09/2026 17:34 PM" → "2026-09-30" (the list's created-on day, for date filters). */
const dayOf = (s: string) => { const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(s); return m ? `${m[3]}-${m[2]}-${m[1]}` : ""; };

const mockListsApi = {
  list: (q: Query) =>
    wait(runQuery(LISTS, q, {
      searchKeys: ["name", "origin", "createdBy", "owner", "id"],
      filterMap: {
        form: (r, v) => r.form === v,
        // v2: "from..to" (both ISO days, inclusive) or a single day
        createdOn: (r, v) => {
          const d = dayOf(r.createdOn);
          if (!d) return false;
          const [from, to] = v.includes("..") ? v.split("..") : [v, v];
          return (!from || d >= from) && (!to || d <= to);
        },
      },
    })),
  options: async (): Promise<Record<string, Option[]>> =>
    wait({
      institute: [{ value: "vedam", label: "Vedam School of Technology" }],
      form: [
        { value: "application", label: "Application Form" },
        { value: "enquiry", label: "Enquiry Form" },
      ],
      owner: [
        { value: "System", label: "System" },
        { value: "Staff User 02", label: "Staff User 02" },
      ],
      origin: [
        { value: "Leads Manager", label: "Leads Manager" },
        { value: "Raw Data", label: "Raw Data" },
      ],
    }),
  /** Row-level actions — wire each to its real mutation later. In this mock they change the in-memory rows, so the screen shows the result after a refresh. */
  remove: (ids: string[]) => {
    for (const id of ids) { const i = LISTS.findIndex((l) => l.id === id); if (i >= 0) LISTS.splice(i, 1); }
    return wait({ ok: true, removed: ids.length });
  },
  changeOwner: (ids: string[], owner: string) => {
    LISTS.forEach((l) => { if (ids.includes(l.id)) l.owner = owner; });
    return wait({ ok: true, ids, owner });
  },
  /** v2 · Edit List (name + description). */
  update: (id: string, patch: { name: string; description: string }) => {
    const l = LISTS.find((x) => x.id === id);
    if (!l) return Promise.reject(new Error("This list no longer exists."));
    l.name = patch.name; l.description = patch.description;
    return wait({ ok: true, id });
  },
  /** v2 · Add Tag drawer — replaces the whole tag set. */
  setTags: (id: string, tags: string[]) => {
    const l = LISTS.find((x) => x.id === id);
    if (!l) return Promise.reject(new Error("This list no longer exists."));
    l.tags = tags; l.tagged = tags.length > 0;
    return wait({ ok: true, id, tags });
  },
  /** v2 · Communicate drawer: templates and senders per channel (static here). */
  communicateOptions: () =>
    wait({
      email: { templates: [{ value: "welcome", label: "Welcome to Vedam" }, { value: "vsat", label: "VSAT registration reminder" }, { value: "fee", label: "Fee payment nudge" }] as Option[], senders: [{ value: "admissions", label: "admissions@example.com" }, { value: "connect", label: "connect@example.com" }] as Option[] },
      whatsapp: { templates: [{ value: "wa_welcome", label: "welcome_message" }, { value: "wa_slot", label: "vsat_slot_booking" }, { value: "wa_fee", label: "fee_reminder" }] as Option[], senders: [{ value: "wa_main", label: "Vedam Admissions (WhatsApp)" }] as Option[] },
      sms: { templates: [{ value: "sms_otp", label: "VSAT slot reminder" }, { value: "sms_fee", label: "Fee due reminder" }] as Option[], senders: [{ value: "vedamk", label: "VEDAMK" }] as Option[] },
      amplify: { templates: [{ value: "amp_push", label: "App push · counselling slot" }, { value: "amp_banner", label: "In-app banner · apply now" }] as Option[], senders: [{ value: "app", label: "Vedam app" }] as Option[] },
    }),
  /** v2 · queues a campaign for the chosen lists. Nothing is really sent in this mock. */
  communicate: (payload: { listIds: string[]; channel: string; template: string; sender: string; when: string }) =>
    wait({ ok: true, campaignId: `C${Date.now().toString().slice(-6)}`, ...payload }),
};

/** Live (saved filters on VSAT data, /api/admin/comm/lists) or the sample lists above — switch in lib/live-config.ts. */
export const listsApi: typeof mockListsApi = LIVE_PAGES.lists ? liveListsApi : mockListsApi;

/* ══════════════════════════════════════════════════════
   WHATSAPP FLOW
   ══════════════════════════════════════════════════════ */
/** f1 / f2 (Recommended), the default screen and categories are shared with the live client: lib/flow-recommended.ts */
const FLOWS: FlowRow[] = [
  ...RECOMMENDED_FLOWS.map((f) => ({ ...f, screens: copyScreens(f.screens) })),
  { id: "f3", name: "VSAT Slot Booking", description: "book a VSAT slot over WhatsApp", tag: "Leads", category: "Admissions", scope: "mine", createdOn: "02/09/2026, 10:12 AM", status: "Draft", module: "Leads",
    screens: [
      { id: "screen_one", title: "Pick a slot", cta: "Next", fields: [
        { label: "Preferred date", kind: "date", placeholder: "Select a date" },
        { label: "Time slot", kind: "select", placeholder: "Select a slot" },
      ] },
      { id: "screen_two", title: "Confirm details", cta: "Book slot", fields: [
        { label: "Full name", kind: "text", placeholder: "Your name" },
        { label: "I agree to be contacted about my slot", kind: "checkbox" },
      ] },
    ] },
  { id: "f4", name: "Fee Reminder Flow", description: "nudge unpaid applicants", tag: "Application", category: "Admissions", scope: "mine", createdOn: "21/08/2026, 04:30 PM", status: "Active", module: "Leads",
    screens: [{ id: "screen_one", title: "Payment status", cta: "Send", fields: [
      { label: "Application ID", kind: "text", placeholder: "e.g. VSAT-2041" },
      { label: "Need help with payment?", kind: "checkbox" },
    ] }] },
  { id: "f5", name: "Counselling Follow-up", description: "post-counselling check-in", tag: "Leads", category: "Lead Nurturing", scope: "mine", createdOn: "11/08/2026, 06:02 PM", status: "Draft", module: "Leads",
    screens: [{ id: "screen_one", title: "How was your session?", cta: "Submit", fields: [
      { label: "Rating", kind: "select", placeholder: "Select a rating" },
      { label: "Anything we can improve?", kind: "text", placeholder: "Type here" },
    ] }] },
];
/** "03/11/2026, 02:12 PM" — same look as the seeded dates */
const flowDate = () => now().replace(" ", ", ").replace(/ (am|pm)$/i, (m) => m.toUpperCase());
let FLOW_CATEGORIES = [...DEFAULT_FLOW_CATEGORIES];
let flowSeq = 100;

export type NewFlow = { name: string; module: "Leads" | "Raw Data"; category: string; description: string; fromId?: string };

const mockFlowsApi = {
  /** Without a `scope` filter the Recommended list is returned. */
  list: (q: Query) => {
    const filters = { scope: "recommended", ...(q.filters ?? {}) };
    return wait(runQuery(FLOWS, { ...q, filters }, {
      searchKeys: ["name", "description", "tag"],
      filterMap: {
        scope: (r, v) => r.scope === v,
        category: (r, v) => r.category === v,
        status: (r, v) => r.status === v,
      },
    }));
  },
  options: async (): Promise<Record<string, Option[]>> =>
    wait({
      status: [
        { value: "Active", label: "Active" },
        { value: "Draft", label: "Draft" },
      ],
      category: FLOW_CATEGORIES.map((c) => ({ value: c, label: c })),
    }),
  /** v2 · every category that can be picked when creating a flow */
  categories: async (): Promise<string[]> => wait([...FLOW_CATEGORIES]),
  /** v2 · adds a category (case-insensitive duplicates are refused) */
  addCategory: async (name: string): Promise<string> => {
    const n = name.trim();
    if (FLOW_CATEGORIES.some((c) => c.toLowerCase() === n.toLowerCase())) throw new Error("This category already exists.");
    FLOW_CATEGORIES = [...FLOW_CATEGORIES, n];
    return wait(n);
  },
  /** v2 · the screens shown in the phone preview */
  preview: async (id: string): Promise<{ name: string; screens: FlowScreen[] }> => {
    const f = FLOWS.find((x) => x.id === id);
    if (!f) throw new Error("This flow no longer exists.");
    return wait({ name: f.name, screens: f.screens?.length ? f.screens : [SCREEN_DETAILS] });
  },
  /** v2 · creates a Draft flow in My Flow (no real WhatsApp flow is created in this mock) */
  create: async (p: NewFlow): Promise<FlowRow> => {
    const name = p.name.trim();
    if (FLOWS.some((f) => f.scope === "mine" && f.name.toLowerCase() === name.toLowerCase())) throw new Error("You already have a flow with this name.");
    const from = p.fromId ? FLOWS.find((f) => f.id === p.fromId) : undefined;
    const row: FlowRow = {
      id: `f${++flowSeq}`, name, description: p.description.trim(), tag: p.module, category: p.category,
      scope: "mine", createdOn: flowDate(), status: "Draft", module: p.module,
      screens: from?.screens ? from.screens.map((s) => ({ ...s, fields: [...s.fields] })) : [SCREEN_DETAILS],
    };
    FLOWS.unshift(row);
    return wait(row);
  },
  /** v2 */
  remove: async (id: string): Promise<void> => {
    const i = FLOWS.findIndex((f) => f.id === id && f.scope === "mine");
    if (i < 0) throw new Error("This flow no longer exists.");
    FLOWS.splice(i, 1);
    return wait(undefined);
  },
  /** v2 */
  setStatus: async (id: string, status: "Active" | "Draft"): Promise<void> => {
    const f = FLOWS.find((x) => x.id === id && x.scope === "mine");
    if (!f) throw new Error("This flow no longer exists.");
    f.status = status;
    return wait(undefined);
  },
  /** v2 · copies one of My Flows */
  duplicate: async (id: string): Promise<FlowRow> => {
    const f = FLOWS.find((x) => x.id === id && x.scope === "mine");
    if (!f) throw new Error("This flow no longer exists.");
    let name = `Copy of ${f.name}`; let n = 2;
    while (FLOWS.some((x) => x.scope === "mine" && x.name.toLowerCase() === name.toLowerCase())) name = `Copy ${n++} of ${f.name}`;
    const row: FlowRow = { ...f, id: `f${++flowSeq}`, name, status: "Draft", createdOn: flowDate(), screens: f.screens?.map((s) => ({ ...s, fields: [...s.fields] })) };
    FLOWS.unshift(row);
    return wait(row);
  },
};

/** Live (Slice 6: drafts in the database, /api/admin/comm/flows) or the sample flows above — switch in lib/live-config.ts. */
export const flowsApi: typeof mockFlowsApi = LIVE_PAGES.whatsappFlow ? liveFlowsApi : mockFlowsApi;

/* ══════════════════════════════════════════════════════
   IN-APP CALL LOGS
   ══════════════════════════════════════════════════════ */
const CALLS: CallRow[] = [
  { id: "c1", applicant: "Test Student 01", mobile: "9000000001", callingType: "Incoming", user: "Admin User", callStatus: "Answered", leadStatus: "Verified Leads", startTime: "23/07/2026, 05:47 PM", endTime: "23/07/2026, 05:48 PM", durationSec: 16 },
  { id: "c2", applicant: "Test Student 01", mobile: "9000000001", callingType: "Incoming", user: "Admin User", callStatus: "Answered", leadStatus: "Verified Leads", startTime: "23/07/2026, 05:48 PM", endTime: "23/07/2026, 05:50 PM", durationSec: 138 },
  { id: "c3", applicant: "Test Student 02", mobile: "9000000002", callingType: "Incoming", user: "Admin User", callStatus: "Missed", leadStatus: "Verified Leads", startTime: "23/07/2026, 05:26 PM", endTime: "23/07/2026, 05:26 PM", durationSec: 0 },
  { id: "c4", applicant: "Test Student 02", mobile: "9000000002", callingType: "Outgoing", user: "Admin User", callStatus: "Answered", leadStatus: "Verified Leads", startTime: "23/07/2026, 05:26 PM", endTime: "23/07/2026, 05:33 PM", durationSec: 400 },
  { id: "c5", applicant: "Test Student 02", mobile: "9000000002", callingType: "Incoming", user: "Admin User", callStatus: "Missed", leadStatus: "Verified Leads", startTime: "23/07/2026, 05:26 PM", endTime: "23/07/2026, 05:26 PM", durationSec: 0 },
  { id: "c6", applicant: "", mobile: "9000000003", callingType: "Outgoing", user: "Admin User", callStatus: "Missed", leadStatus: "", startTime: "23/07/2026, 04:21 PM", endTime: "23/07/2026, 04:21 PM", durationSec: 0 },
  { id: "c7", applicant: "", mobile: "9000000003", callingType: "Outgoing", user: "Admin User", callStatus: "Missed", leadStatus: "", startTime: "23/07/2026, 04:21 PM", endTime: "23/07/2026, 04:21 PM", durationSec: 0 },
  { id: "c8", applicant: "Test Student 03", mobile: "9000000004", callingType: "Outgoing", user: "Admin User", callStatus: "Answered", leadStatus: "Verified Leads", startTime: "23/07/2026, 04:18 PM", endTime: "23/07/2026, 04:19 PM", durationSec: 52 },
  { id: "c9", applicant: "Test Student 03", mobile: "9000000004", callingType: "Outgoing", user: "Admin User", callStatus: "Missed", leadStatus: "Verified Leads", startTime: "23/07/2026, 04:18 PM", endTime: "23/07/2026, 04:18 PM", durationSec: 0 },
  { id: "c10", applicant: "Test Student 03", mobile: "9000000004", callingType: "Outgoing", user: "Admin User", callStatus: "Answered", leadStatus: "Verified Leads", startTime: "23/07/2026, 03:33 PM", endTime: "23/07/2026, 03:34 PM", durationSec: 46 },
  { id: "c11", applicant: "Test Student 04", mobile: "9000000005", callingType: "Incoming", user: "Staff User 01", callStatus: "Answered", leadStatus: "Verified Leads", startTime: "22/07/2026, 06:02 PM", endTime: "22/07/2026, 06:05 PM", durationSec: 183 },
  { id: "c12", applicant: "Test Student 05", mobile: "9000000006", callingType: "Outgoing", user: "Staff User 01", callStatus: "Missed", leadStatus: "Unverified Leads", startTime: "22/07/2026, 05:40 PM", endTime: "22/07/2026, 05:40 PM", durationSec: 0 },
];

/** v2 · pads the seed to 38 records (Meritto shows 38). Deterministic, July 2026, newest first. */
(() => {
  const users = ["Staff User 01", "Admin User", "Staff User 03", "Staff User 04", "Staff User 05", "Staff User 06", "Staff User 07", "Staff User 08"];
  const people: [string, string, string][] = [
    ["Test Student 04", "9000000005", "Verified Leads"], ["Test Student 05", "9000000006", "Unverified Leads"], ["Test Student 06", "9000000007", "Verified Leads"],
    ["", "9000000008", ""], ["Test Student 07", "9000000009", "Verified Leads"], ["Test Student 08", "9000000010", "Verified Leads"], ["", "9000000011", ""],
  ];
  const two = (n: number) => String(n).padStart(2, "0");
  const stamp = (day: number, mins: number) => {                   // mins since midnight
    const h24 = Math.floor(mins / 60), m = mins % 60, h12 = h24 % 12 === 0 ? 12 : h24 % 12;
    return `${two(day)}/07/2026, ${two(h12)}:${two(m)} ${h24 >= 12 ? "PM" : "AM"}`;
  };
  let day = 22, mins = 17 * 60 + 20;
  for (let i = 0; CALLS.length < 38; i++) {
    const [applicant, mobile, leadStatus] = people[i % people.length];
    const answered = i % 3 !== 1, dur = answered ? 20 + ((i * 37) % 340) : 0;
    const startMin = mins, endMin = mins + Math.ceil(dur / 60);
    CALLS.push({
      id: `c${CALLS.length + 1}`, applicant, mobile, callingType: i % 2 ? "Outgoing" : "Incoming", user: users[i % users.length],
      callStatus: answered ? "Answered" : "Missed", leadStatus, startTime: stamp(day, startMin), endTime: stamp(day, endMin), durationSec: dur,
    });
    mins -= 47 + ((i * 13) % 61);
    if (mins < 10 * 60) { day -= 1; mins = 18 * 60 - ((i * 11) % 90); }
  }
})();

export const callsApi = {
  list: (q: Query) =>
    wait(runQuery(CALLS, q, {
      searchKeys: ["applicant", "mobile", "user"],
      filterMap: {
        user: (r, v) => r.user === v,
        // Meritto lists "Missed" next to Incoming / Outgoing in the Call Type filter
        callingType: (r, v) => (v === "Missed" ? r.callStatus === "Missed" : r.callingType === v),
        callStatus: (r, v) => r.callStatus === v,
        // v2: "from..to" (ISO days, inclusive) on the call's start day
        callDate: (r, v) => {
          const d = dayOf(r.startTime);
          if (!d) return false;
          const [from, to] = v.includes("..") ? v.split("..") : [v, v];
          return (!from || d >= from) && (!to || d <= to);
        },
      },
    })),
  options: async (): Promise<Record<string, Option[]>> =>
    wait({
      institute: [{ value: "vedam", label: "Vedam School of Technology" }],
      user: ["Staff User 01", "Staff User 03", "Staff User 04", "Staff User 05", "Staff User 06", "Staff User 07", "Staff User 08", "Admin User"].map((n) => ({ value: n, label: n })),
      callingType: [
        { value: "Incoming", label: "Incoming" },
        { value: "Outgoing", label: "Outgoing" },
        { value: "Missed", label: "Missed" },
      ],
      callStatus: [
        { value: "Answered", label: "Answered" },
        { value: "Missed", label: "Missed" },
      ],
    }),
};

/* ══════════════════════════════════════════════════════
   MANAGE COMMUNICATION LOG
   ══════════════════════════════════════════════════════ */
const COMM_LOGS: CommLogRow[] = [
  { id: "l1", channel: "email", jobId: "Job#9000900", preview: "Email", previewNote: "offlineUploadCompleted…", template: "-", status: "In Progress", startDate: "28 Sep, 26 2:39 PM", listName: "1", segmentName: "-", targeted: 2, delivered: 2, automationId: "NA" },
  { id: "l2", channel: "whatsapp", jobId: "Job#9000899", preview: "Whatsapp", template: "25sep_lead", status: "Completed", startDate: "25 Sep, 26 4:48 PM", listName: "1", segmentName: "-", targeted: 1, delivered: 1, automationId: "NA" },
  { id: "l3", channel: "whatsapp", jobId: "Job#9000898", preview: "Whatsapp", template: "25sep_lead", status: "Completed", startDate: "25 Sep, 26 4:45 PM", listName: "1", segmentName: "-", targeted: 1, delivered: 1, automationId: "NA" },
  { id: "l4", channel: "whatsapp", jobId: "Job#9000897", preview: "Whatsapp", template: "25sep_lead", status: "Completed", startDate: "25 Sep, 26 4:20 PM", listName: "1", segmentName: "-", targeted: 1, delivered: 1, automationId: "NA" },
  { id: "l5", channel: "amplify", jobId: "Job#9000896", preview: "Amplify", template: "Ggn Pune for Raw", status: "Completed", startDate: "3 Sep, 26 12:18 PM", listName: "1", segmentName: "-", targeted: 2603, delivered: null, automationId: "NA" },
  { id: "l6", channel: "whatsapp", jobId: "Job#9000895", preview: "Whatsapp", template: "26july_uti", status: "Completed", statusInfo: true, startDate: "2 Sep, 26 9:00 AM", listName: "1", segmentName: "-", targeted: 1470, delivered: 1089, automationId: "NA" },
  { id: "l7", channel: "whatsapp", jobId: "Job#9000894", preview: "Whatsapp", template: "26july_uti", status: "Completed", statusInfo: true, startDate: "2 Sep, 26 9:00 AM", listName: "1", segmentName: "-", targeted: 3496, delivered: 2442, automationId: "NA" },
  { id: "l8", channel: "whatsapp", jobId: "Job#9000893", preview: "Whatsapp", template: "26july_uti", status: "Completed", statusInfo: true, startDate: "1 Sep, 26 6:13 PM", listName: "1", segmentName: "-", targeted: 4540, delivered: 3167, automationId: "NA" },
  { id: "l9", channel: "whatsapp", jobId: "Job#9000892", preview: "Whatsapp", template: "26july_uti", status: "Completed", statusInfo: true, startDate: "1 Sep, 26 6:11 PM", listName: "1", segmentName: "-", targeted: 5376, delivered: 3582, automationId: "NA" },
  { id: "l10", channel: "whatsapp", jobId: "Job#9000891", preview: "Whatsapp", template: "26july_uti", status: "Completed", statusInfo: true, startDate: "1 Sep, 26 6:10 PM", listName: "1", segmentName: "-", targeted: 2191, delivered: 1513, automationId: "NA" },
  { id: "l11", channel: "email", jobId: "Job#9000890", preview: "Email", previewNote: "vsat_reminder_batch3", template: "vsat_sep", status: "Failed", startDate: "30 Aug, 26 11:20 AM", listName: "2", segmentName: "-", targeted: 860, delivered: 0, automationId: "8910" },
  { id: "l12", channel: "sms", jobId: "Job#9000889", preview: "SMS", template: "slot_confirm", status: "Scheduled", startDate: "29 Aug, 26 9:00 AM", listName: "2", segmentName: "-", targeted: 420, delivered: null, automationId: "8909" },
];

/** v2 · fills the extra Meritto columns on the first 12 rows and pads the seed to 44 jobs (deterministic, newest first). */
(() => {
  const senders = ["Staff User 09", "Staff User 01", "System", "Staff User 04", "Staff User 03"];
  const fill = (r: CommLogRow, i: number) => {
    const bulk = r.targeted > 1;
    r.form ??= r.id === "l1" || r.id === "l5" ? "All Forms" : r.listName === "2" ? "All Forms" : i % 4 === 0 ? "All Forms" : "Application Form";
    r.sentBy ??= r.channel === "email" && r.id === "l1" ? "System" : r.channel === "amplify" ? "Staff User 01" : senders[i % senders.length];
    r.campaignName ??= r.channel === "amplify" ? "CS July MQL" : "NA";
    r.campaignType ??= "NA";
    r.retry ??= r.channel === "email" || r.channel === "amplify" ? "Feature not applicable" : bulk ? "Retry Excluded" : "Pre-Implementation";
    r.nature ??= bulk ? "Bulk" : "Single User";
    r.commFor ??= r.automationId !== "NA" ? "Automation" : r.listName === "2" ? "Raw Data" : "Registered Leads";
    r.leadsType ??= "List";
    r.engagement ??= i % 3 === 0 ? "Engagement" : i % 3 === 1 ? "Engagement (Numeric)" : "Activity";
    if (r.channel === "amplify") r.voiceType ??= i % 2 ? "Mio AI Voice Inbound" : "Mio AI Voice Outbound";
    if (r.channel !== "amplify" && r.delivered != null) {
      r.read ??= r.channel === "sms" ? 0 : Math.round(r.delivered * (0.55 + (i % 4) * 0.08));
      r.clicked ??= Math.round((r.channel === "sms" ? r.delivered : r.read) * (0.12 + (i % 3) * 0.05));
    }
  };
  COMM_LOGS.forEach(fill);
  const months = ["Aug", "Aug", "Aug", "Jul", "Jul"], tpl = ["26july_uti", "vsat_sep", "slot_confirm", "25sep_lead", "bootcamp_nov", "fee_reminder"];
  const kinds: Channel[] = ["whatsapp", "whatsapp", "email", "whatsapp", "sms", "whatsapp", "amplify"];
  const stat: CommStatus[] = ["Completed", "Completed", "Completed", "Closed", "Completed", "Undelivered", "Scheduled", "Completed", "In Progress", "Completed"];
  let day = 28, mins = 15 * 60;
  for (let i = 0; COMM_LOGS.length < 44; i++) {
    const channel = kinds[i % kinds.length], status = stat[i % stat.length];
    const targeted = [1, 1, 120, 860, 2540, 1470, 35, 4210][i % 8];
    const h24 = Math.floor(mins / 60), h12 = h24 % 12 === 0 ? 12 : h24 % 12;
    const row: CommLogRow = {
      id: `l${COMM_LOGS.length + 1}`, channel, jobId: `Job#${9000500 - i}`,
      preview: { email: "Email", whatsapp: "Whatsapp", sms: "SMS", amplify: "Amplify" }[channel], previewNote: channel === "email" ? "vsat_reminder_batch" + (i % 5) : undefined,
      template: channel === "amplify" ? "Ggn Pune for Raw" : channel === "email" && i % 2 ? "-" : tpl[i % tpl.length],
      status, statusInfo: status === "Completed" && channel === "whatsapp" && targeted > 100 ? true : undefined,
      startDate: `${day} ${months[i % months.length]}, 26 ${h12}:${String(mins % 60).padStart(2, "0")} ${h24 >= 12 ? "PM" : "AM"}`,
      listName: i % 3 === 2 ? "2" : "1", segmentName: "-", targeted,
      delivered: status === "Scheduled" || status === "In Progress" || channel === "amplify" ? null : status === "Undelivered" ? 0 : Math.round(targeted * (0.62 + (i % 5) * 0.07)),
      automationId: i % 9 === 4 ? "8910" : "NA",
    };
    fill(row, COMM_LOGS.length);
    COMM_LOGS.push(row);
    mins -= 95 + ((i * 29) % 140);
    if (mins < 8 * 60) { day = Math.max(1, day - 1); mins = 18 * 60 - ((i * 17) % 120); }
  }
})();

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "28 Sep, 26 2:39 PM" → "2026-09-28" (the job's start day, for the date filter). */
const commDay = (s: string) => {
  const m = /^(\d{1,2}) ([A-Za-z]{3}), (\d{2})/.exec(s);
  const mi = m ? MONTHS.indexOf(m[2]) : -1;
  return m && mi >= 0 ? `20${m[3]}-${String(mi + 1).padStart(2, "0")}-${String(Number(m[1])).padStart(2, "0")}` : "";
};
const commInRange = (d: string, v: string) => {
  if (!d) return false;
  const [from, to] = v.includes("..") ? v.split("..") : [v, v];
  return (!from || d >= from) && (!to || d <= to);
};
const findLog = (id: string) => {
  const r = COMM_LOGS.find((x) => x.id === id);
  if (!r) throw new Error("This communication was not found. It may have been removed.");
  return r;
};

/** v2 · the dummy recipients behind one job (the Detailed Report). Same job → same rows. */
const DETAIL_STATUS = ["Delivered", "Read", "Replied", "Sent", "Failed", "Clicked", "Read", "Delivered"];
function buildDetail(r: CommLogRow): CommDetailRow[] {
  const n = Math.min(Math.max(r.targeted, 1), 36), seed = Number(r.id.slice(1));
  const convo = ["Utility", "Marketing", "Service"];
  // v2 · when the job has its own Delivered / Read / Clicked numbers, the recipients' statuses follow the same proportions
  let own: string[] | null = null;
  if (r.delivered != null && r.read != null && r.targeted > 0) {
    const cF = Math.round((n * (r.targeted - r.delivered)) / r.targeted), cC = Math.round((n * (r.clicked ?? 0)) / r.targeted);
    const cR = Math.round((n * (r.read - (r.clicked ?? 0))) / r.targeted);
    const list = [...Array(cF).fill("Failed"), ...Array(cC).fill("Clicked"), ...Array(cR).fill("Read")];
    while (list.length < n) list.push("Delivered");
    own = list.slice(0, n);
    const k = seed % n; own = [...own.slice(k), ...own.slice(0, k)];
  }
  return Array.from({ length: n }, (_, i) => ({
    id: `${r.id}-${i + 1}`, automationId: r.automationId, jobId: r.jobId.replace("Job#", ""), type: CHANNEL_LABEL[r.channel],
    name: `Test Student ${String(((seed + i) % 36) + 11).padStart(2, "0")}`, moduleType: r.commFor === "Opportunity" ? "Opportunity" : "Lead",
    listName: r.listName === "2" ? "Raw Data" : "NA", template: r.template === "-" ? "NA" : r.template,
    to: r.channel === "email" ? `lead${seed}${i + 1}@example.com` : `90000${String(seed * 100 + i).padStart(5, "0")}`.slice(0, 10),
    date: (() => { const d = commDay(r.startDate).split("-"); return `${d[2]} ${MONTHS[Number(d[1]) - 1]} ${d[0]} ${r.startDate.split(" ").slice(-2).join(" ").toLowerCase()}`; })(),
    conversationType: `${convo[(seed + i) % 3]}${(seed + i) % 3 === 0 ? " (Free Session)" : ""}`, region: "(Domestic)+91-India",
    status: r.status === "Undelivered" ? "Failed" : own ? own[i] : DETAIL_STATUS[(seed + i) % DETAIL_STATUS.length],
  }));
}

const mockCommLogsApi = {
  list: (q: Query) =>
    wait(runQuery(COMM_LOGS, q, {
      searchKeys: ["jobId", "template", "preview", "previewNote"],
      filterMap: {
        channel: (r, v) => r.channel === v,
        status: (r, v) => r.status === v,
        listName: (r, v) => r.listName === v,
        automationId: (r, v) => r.automationId === v,
        form: (r, v) => r.form === v,
        voiceType: (r, v) => r.voiceType === v,
        template: (r, v) => r.template === v,
        commFor: (r, v) => r.commFor === v,
        nature: (r, v) => r.nature === v,
        sentBy: (r, v) => r.sentBy === v,
        engagement: (r, v) => r.engagement === v,
        leadsType: (r, v) => r.leadsType === v,
        campaignType: (r, v) => r.campaignType === v,
        campaignName: (r, v) => (r.campaignName ?? "").toLowerCase().includes(v.trim().toLowerCase()),
        startDate: (r, v) => commInRange(commDay(r.startDate), v),
      },
    })),
  options: async (): Promise<Record<string, Option[]>> =>
    wait({
      form: [{ value: "All Forms", label: "All Forms" }, { value: "Application Form", label: "Application Form" }],
      channel: [
        { value: "email", label: "Email" },
        { value: "sms", label: "SMS" },
        { value: "whatsapp", label: "Whatsapp" },
        { value: "lead-score", label: "Lead Score" },
        { value: "amplify", label: "Amplify" },
      ],
      voiceType: ["Mio AI Voice Outbound", "Mio AI Voice Inbound"].map((v) => ({ value: v, label: v })),
      template: [...new Set(COMM_LOGS.map((r) => r.template).filter((t) => t !== "-"))].map((v) => ({ value: v, label: v })),
      commFor: ["Registered Leads", "Opportunity", "Raw Data", "Automation"].map((v) => ({ value: v, label: v })),
      nature: ["Single User", "Bulk"].map((v) => ({ value: v, label: `${v} Communication` })),
      sentBy: [...new Set(COMM_LOGS.map((r) => r.sentBy ?? "").filter(Boolean))].map((v) => ({ value: v, label: v })),
      status: ["Scheduled", "In Progress", "Completed", "Closed", "Undelivered", "Failed"].map((v) => ({ value: v, label: v })),
      engagement: ["Engagement", "Engagement (Numeric)", "Activity"].map((v) => ({ value: v, label: v === "Activity" ? "Activity Channel" : v === "Engagement" ? "Engagement Channel" : "Engagement (Numeric) Channel" })),
      leadsType: ["List", "Segment"].map((v) => ({ value: v, label: v })),
      listName: [{ value: "1", label: "01. Registered Lead" }, { value: "2", label: "02. Raw Data" }],
      campaignType: [],
    }),
  /** Preview drawer: the template (WhatsApp / e-mail / SMS) or the voice file (Amplify). */
  preview: async (id: string): Promise<CommPreview> => {
    const r = findLog(id);
    if (r.channel === "email") return wait({ kind: "email", title: "Template Preview", version: 1, subject: r.template === "-" ? "Your upload is complete" : `Update: ${r.template}`, lines: ["Hi {{UserName}},", "Your bulk upload for {{FormName}} has finished processing. Here’s how it went.", "UPLOAD SUMMARY", "Form: {{FormName}}", "Imported: {{ImportedCount}}"] });
    if (r.channel === "sms") return wait({ kind: "sms", title: r.template, version: 1, lines: ["Hi {#var#}, your slot is confirmed for {#var#}. Reply STOP to opt out."] });
    if (r.channel === "amplify") return wait({ kind: "amplify", title: r.template, version: 1, lines: [], audioName: `${r.template.replace(/\s+/g, "_")}.wav`, audioSec: 20 });
    return wait({ kind: "whatsapp", title: r.template, version: 2, lines: ["Hey {{Registered Name}},", "*If you completed Class 12 in 2026, please let us know your current college admission status:*", "Taken Admission", "Not sure yet"] });
  },
  /** The ⓘ next to a status: why part of the job did not go through. */
  statusDetail: async (id: string): Promise<StatusDetailRow[]> => {
    const r = findLog(id), d = commDay(r.startDate).split("-");
    const when = `${d[2]} ${MONTHS[Number(d[1]) - 1]} ${d[0]} ${r.startDate.split(" ").slice(-2).join(" ").toLowerCase()}`;
    const n = r.statusInfo ? Math.min(7, Math.max(1, r.targeted - (r.delivered ?? 0))) : 0;
    return wait(Array.from({ length: n }, (_, i) => ({ id: `${id}-s${i}`, status: i % 4 === 3 ? "Number not on WhatsApp" : "Error while sending international whatsapp message", date: when })));
  },
  /** The popover on the List Name link. */
  listLabels: async (id: string): Promise<string[]> => wait(findLog(id).listName === "2" ? ["02. Raw Data"] : ["01. Registered Lead"]),
  detail: (id: string, q: Query) => wait(runQuery(buildDetail(findLog(id)) as unknown as Record<string, unknown>[], q, {
    searchKeys: ["name", "to", "template"],
    filterMap: {
      status: (r, v) => r.status === v,
      conversationType: (r, v) => String(r.conversationType).startsWith(v),
      // the report shows "25 Sep 2026 04:48 pm"; the range is ISO days
      date: (r, v) => { const m = /^(\d{1,2}) ([A-Za-z]{3}) (\d{4})/.exec(String(r.date)); const mi = m ? MONTHS.indexOf(m[2]) : -1; return !!m && mi >= 0 && commInRange(`${m[3]}-${String(mi + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}`, v); },
      waba: () => true,
    },
  }) as unknown as Page<CommDetailRow>),
  detailStats: async (id: string): Promise<CommStats> => {
    const log = findLog(id), rows = buildDetail(log), n = rows.length, c = (s: string[]) => rows.filter((r) => s.includes(r.status)).length;
    const own = log.delivered != null && log.read != null; // v2 · same numbers as the Communication Performance dashboard
    return wait({
      sent: own ? log.targeted : n, delivered: own ? log.delivered! : c(["Delivered", "Read", "Replied", "Clicked"]),
      read: own ? log.read! : c(["Read", "Replied", "Clicked"]), failed: own ? log.targeted - log.delivered! : c(["Failed"]),
      clicked: own ? log.clicked ?? 0 : c(["Clicked"]), replied: c(["Replied"]), unsubscribed: 0, flowResponse: 0,
    });
  },
  /** Amplify jobs can be closed from the row menu. */
  close: async (id: string): Promise<CommLogRow> => {
    const r = findLog(id);
    if (r.channel !== "amplify") throw new Error("Only Amplify jobs can be closed.");
    if (r.status === "Closed") throw new Error("This job is already closed.");
    r.status = "Closed";
    return wait({ ...r });
  },
};

/** Live (read-only, /api/admin/comm/*) or the sample data above — switch in lib/live-config.ts. */
export const commLogsApi: typeof mockCommLogsApi = LIVE_PAGES.commLogs ? liveCommLogsApi : mockCommLogsApi;

/* ══════════════════════════════════════════════════════
   EXPORT / DOWNLOAD
   ══════════════════════════════════════════════════════ */
/** Builds a CSV client-side and triggers a download. Replace with a
 *  signed-URL export endpoint when the backend can generate files. */
/** Cells go through csvCell (lib/csv-export.ts): formula-injection guard + CSV quoting. */
export function downloadCsv(filename: string, headers: string[], rows: (string | number | null)[][]) {
  const csv = csvText(headers, rows);
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export const CHANNEL_LABEL: Record<Channel, string> = {
  email: "Email", whatsapp: "WhatsApp", amplify: "Amplify", sms: "SMS",
};

/* ══════════════════════════════════════════════════════
   MANAGE AUTOMATION
   ══════════════════════════════════════════════════════ */
type AutoSeed = Omit<AutomationRow, "tags"> & { tags: string[] };
const AUTO_BASE: AutoSeed[] = [
  { id: "8910", name: "Allocation", module: "Lead/Application", list: "Lead", trigger: "On Creation", createdOn: "23/07/2026 04:32 PM", createdBy: "Staff User 01", startDate: "23/07/2026 04:55 PM", endDate: "16/07/2027 04:49 PM", status: "Active", tags: ["VSAT"] },
  { id: "8909", name: "Paid Referral Trigger", module: "Lead/Application", list: "Application Form", trigger: "On Field Update", createdOn: "08/06/2026 01:35 PM", createdBy: "Staff User 01", startDate: "08/06/2026 01:44 PM", endDate: "08/06/2027 01:42 PM", status: "Active", tags: ["Referral", "VSAT"] },
  { id: "8908", name: "Vedantu", module: "Lead/Application", list: "Lead", trigger: "On Creation", createdOn: "12/01/2026 05:03 PM", createdBy: "Staff User 10", startDate: "12/01/2026 05:15 PM", endDate: "07/01/2028 05:11 PM", status: "Active", tags: ["Partner"] },
  { id: "8907", name: "Automation 1700000000", module: "Lead/Application", list: "Application Form", trigger: "On Field Update", createdOn: "15/12/2025 01:23 PM", createdBy: "Staff User 11", startDate: "15/12/2025 06:02 PM", endDate: "30/04/2030 06:02 PM", status: "Draft", tags: [] },
  { id: "8906", name: "Application Stage To Lead Stage", module: "Lead/Application", list: "Application Form", trigger: "On Field Update", createdOn: "19/06/2025 05:42 PM", createdBy: "Staff User 10", startDate: "19/06/2025 07:00 PM", endDate: "25/06/2028 06:39 PM", status: "Pause", tags: ["Nurture"] },
  { id: "8905", name: "Enrolled Automation - Updated Jan26", module: "Lead/Application", list: "Application Form", trigger: "On Field Update", createdOn: "21/05/2025 05:53 PM", createdBy: "Staff User 12", startDate: "21/05/2025 05:58 PM", endDate: "21/05/2028 05:58 PM", status: "Completed", tags: ["Enrolled"] },
  { id: "8904", name: "Pi Cleared Or Not Cleared", module: "Lead/Application", list: "Application Form", trigger: "On Field Update", createdOn: "16/04/2025 05:11 PM", createdBy: "Staff User 13", startDate: "16/04/2025 05:18 PM", endDate: "23/05/2028 05:18 PM", status: "Stopped", tags: [] },
  { id: "8903", name: "VSAT Slot Reminder", module: "Lead/Application", list: "Lead", trigger: "On Creation", createdOn: "02/04/2025 11:05 AM", createdBy: "Admin User", startDate: "02/04/2025 11:30 AM", endDate: "02/04/2027 11:30 AM", status: "Active", tags: ["VSAT", "Reminder"] },
  { id: "8902", name: "Unpaid Application Nudge", module: "Lead/Application", list: "Application Form", trigger: "On Field Update", createdOn: "18/03/2025 03:40 PM", createdBy: "Staff User 02", startDate: "18/03/2025 04:00 PM", endDate: "18/03/2028 04:00 PM", status: "Pause", tags: ["Nurture", "Payment"] },
  { id: "8901", name: "Counselling No-show", module: "Lead/Application", list: "Lead", trigger: "On Field Update", createdOn: "05/02/2025 09:15 AM", createdBy: "Staff User 02", startDate: "05/02/2025 09:30 AM", endDate: "05/02/2027 09:30 AM", status: "Stopped", tags: ["Counselling"] },
];

/** 27 more dummy rows so the totals read 37 of 40 (Active 21, Draft 1, Pause 3, Completed 3, Stopped 9). */
function buildExtraAutomations(): AutoSeed[] {
  const names = [
    "Bootcamp Reminder", "Webinar Follow-up", "Scholarship Nudge", "Fee Receipt Mail", "Slot Booking Confirm", "Campus Visit Invite",
    "Cold Lead Revival", "Parent Update", "Admit Card Alert", "Result Announcement", "Offer Letter Mail", "Seat Hold Reminder",
    "Document Upload Nudge", "Interview Slot", "Referral Thank-you", "Counsellor Allocation", "Event Registration Mail", "Quiz Invite",
    "Waitlist Update", "Open House Invite", "Birthday Wish", "Call Back Request", "Re-engagement Q3", "Payment Failed Retry",
    "Application Incomplete", "Course Brochure Send", "Alumni Talk Invite",
  ];
  const status: AutomationRow["status"][] = [
    ...Array<AutomationRow["status"]>(17).fill("Active"), "Pause", "Completed", "Completed",
    ...Array<AutomationRow["status"]>(7).fill("Stopped"),
  ];
  const triggers = ["On Creation", "On Field Update", "On Specific Date", "At Regular Intervals"];
  const people = ["Staff User 01", "Staff User 10", "Staff User 02", "Admin User", "Staff User 12", "Staff User 11"];
  const tagPool = [["VSAT"], ["Nurture"], ["Payment"], ["Bootcamp"], ["Reminder", "VSAT"], [], ["Campus"], ["Partner"]];
  const pad = (n: number) => String(n).padStart(2, "0");
  return names.map((name, i) => {
    const month = ((i * 5) % 12) + 1, day = ((i * 7) % 27) + 1, year = i < 14 ? 2025 : 2024;
    const created = `${pad(day)}/${pad(month)}/${year} ${pad((i % 11) + 1)}:${pad((i * 13) % 60)} ${i % 2 ? "PM" : "AM"}`;
    const start = `${pad(day)}/${pad(month)}/${year} ${pad((i % 11) + 1)}:${pad(((i * 13) % 60 + 20) % 60)} ${i % 2 ? "PM" : "AM"}`;
    const end = `${pad(day)}/${pad(month)}/${year + 2} ${pad((i % 11) + 1)}:${pad(((i * 13) % 60 + 20) % 60)} ${i % 2 ? "PM" : "AM"}`;
    const kind = i % 9 === 4 ? "Opportunity" : i % 9 === 7 ? "Lead" : "Lead/Application";
    return {
      id: String(2400 - i * 37), name, module: kind,
      list: kind === "Opportunity" ? "Opportunity" : i % 2 ? "Application Form" : "Lead",
      trigger: triggers[i % 4], createdOn: created, createdBy: people[i % people.length], startDate: start, endDate: end,
      status: status[i], tags: tagPool[i % tagPool.length],
    };
  });
}

const AUTOMATIONS: AutomationRow[] = [...AUTO_BASE, ...buildExtraAutomations()];
const AUTOMATION_QUOTA = 40;
const autoNodes = new Map<string, AutomationNode[]>();
let autoSeq = 8920;

/** "04/11/2026 10:58 AM" — same shape as the seeded dates. */
const autoDate = () => now().toUpperCase();

const TRIGGER_TEXT: Record<string, string> = {
  "On Creation": "Runs once for every new record in the list.",
  "On Field Update": "Runs when the chosen field changes on a record.",
  "On Specific Date": "Runs on the date held in the chosen date field.",
  "At Regular Intervals": "Runs again and again on the chosen schedule.",
};
const triggerNode = (a: AutomationRow, config?: string): AutomationNode => ({
  id: "n-trigger", kind: "trigger", title: a.trigger,
  detail: `${TRIGGER_TEXT[a.trigger] ?? "Starts the automation."}${config ? ` (${config})` : ""} List: ${a.list}.`,
});
const waNode = (id: string, title: string, detail: string): AutomationNode => ({ id, kind: "whatsapp", title: `Send WhatsApp · ${title}`, detail });
const mailNode = (id: string, title: string, detail: string): AutomationNode => ({ id, kind: "email", title: `Send Email · ${title}`, detail });

/** Seeded automations get one of three simple, believable workflows (chosen from the id so it never changes). */
function nodesFor(a: AutomationRow): AutomationNode[] {
  const cached = autoNodes.get(a.id);
  if (cached) return cached;
  const v = Number(a.id) % 3;
  const nodes: AutomationNode[] = [triggerNode(a)];
  if (v === 0) {
    nodes.push({
      id: "n-if", kind: "condition", title: "IF lead stage is Applied", detail: "Checks the lead before sending.",
      yes: [waNode("n-yes", "Application reminder", "Template: application_reminder")],
      no: [mailNode("n-no", "Complete your application", "Template: nudge_mail")],
    });
  } else if (v === 1) {
    nodes.push(waNode("n-wa", "Welcome message", "Template: welcome_vsat"), mailNode("n-mail", "Next steps", "Template: next_steps"));
  } else {
    nodes.push(mailNode("n-mail", "Reminder", "Template: reminder_mail"));
  }
  autoNodes.set(a.id, nodes);
  return nodes;
}
const countActions = (nodes: AutomationNode[]): number =>
  nodes.reduce((n, x) => n + (x.kind === "email" || x.kind === "whatsapp" ? 1 : 0) + countActions(x.yes ?? []) + countActions(x.no ?? []), 0);

const autoFilters = {
  status: (r: AutomationRow, v: string) => r.status === v,
  trigger: (r: AutomationRow, v: string) => r.trigger === v,
  list: (r: AutomationRow, v: string) => r.list === v,
  module: (r: AutomationRow, v: string) => r.module === v,
  createdBy: (r: AutomationRow, v: string) => r.createdBy === v,
  tags: (r: AutomationRow, v: string) => !!r.tags?.includes(v),
};
const inRange = (field: "createdOn" | "startDate" | "endDate") => (r: AutomationRow, v: string) => {
  const d = dayOf(r[field]);
  if (!d) return false;
  const [from, to] = v.includes("..") ? v.split("..") : [v, v];
  return (!from || d >= from) && (!to || d <= to);
};
const AUTO_FILTER_MAP = { ...autoFilters, createdOn: inRange("createdOn"), startDate: inRange("startDate"), endDate: inRange("endDate") };
const AUTO_SEARCH: (keyof AutomationRow)[] = ["name", "id", "createdBy", "trigger"];
const autoById = (id: string) => {
  const a = AUTOMATIONS.find((x) => x.id === id);
  if (!a) throw new Error("This automation no longer exists.");
  return a;
};
const autoNameTaken = (name: string, exceptId?: string) =>
  AUTOMATIONS.some((a) => a.id !== exceptId && a.name.toLowerCase() === name.trim().toLowerCase());

export const AUTOMATION_QUOTA_MAX = AUTOMATION_QUOTA;

const mockAutomationsApi = {
  list: (q: Query) => wait(runQuery(AUTOMATIONS, q, { searchKeys: AUTO_SEARCH, filterMap: AUTO_FILTER_MAP })),
  /** Status tiles. They follow the search and every filter except Status, so the tiles still show what each status would give. */
  counts: async (q: Query) => {
    const { status: _ignored, ...others } = q.filters ?? {};
    void _ignored;
    const all = runQuery(AUTOMATIONS, { search: q.search, filters: others }, { searchKeys: AUTO_SEARCH, filterMap: AUTO_FILTER_MAP }).rows;
    const by = (s: string) => all.filter((r) => r.status === s).length;
    return wait({
      Active: by("Active"), Draft: by("Draft"), Pause: by("Pause"), Completed: by("Completed"), Stopped: by("Stopped"),
      total: all.length, used: AUTOMATIONS.length, quota: AUTOMATION_QUOTA,
    });
  },
  options: async (): Promise<Record<string, Option[]>> => {
    const uniq = (xs: string[]) => [...new Set(xs)].sort((a, b) => a.localeCompare(b)).map((v) => ({ value: v, label: v }));
    return wait({
      status: ["Active", "Draft", "Pause", "Completed", "Stopped"].map((v) => ({ value: v, label: v })),
      module: ["Lead/Application", "Lead", "Opportunity"].map((v) => ({ value: v, label: v })),
      list: uniq(AUTOMATIONS.map((a) => a.list)),
      trigger: ["On Creation", "On Field Update", "On Specific Date", "At Regular Intervals"].map((v) => ({ value: v, label: v })),
      createdBy: uniq(AUTOMATIONS.map((a) => a.createdBy)),
      tags: uniq(AUTOMATIONS.flatMap((a) => a.tags ?? [])),
    });
  },
  /** Opens one automation for the Edit Automation page. */
  get: async (id: string): Promise<AutomationDetail> => {
    const a = autoById(id);
    return wait({ row: { ...a }, nodes: nodesFor(a) });
  },
  /** Bulk or single status change. Only legal moves apply (Pause: from Active; Activate: from Pause or Draft; De-activate: from Active or Pause); the rest are skipped. */
  setStatus: async (ids: string[], status: "Active" | "Pause" | "Stopped") => {
    const from: Record<string, AutomationRow["status"][]> = { Pause: ["Active"], Active: ["Pause", "Draft"], Stopped: ["Active", "Pause"] };
    let changed = 0;
    for (const id of ids) {
      const a = AUTOMATIONS.find((x) => x.id === id);
      if (a && from[status].includes(a.status)) { a.status = status; changed++; }
    }
    return wait({ ok: true, changed, skipped: ids.length - changed });
  },
  /** Active automations must be de-activated first. */
  remove: async (ids: string[]) => {
    if (ids.some((id) => AUTOMATIONS.find((a) => a.id === id)?.status === "Active")) throw new Error("Active automations can’t be deleted. De-activate them first.");
    let removed = 0;
    for (const id of ids) { const i = AUTOMATIONS.findIndex((a) => a.id === id); if (i >= 0) { AUTOMATIONS.splice(i, 1); autoNodes.delete(id); removed++; } }
    return wait({ ok: true, removed });
  },
  /** Creates a Draft. In this mock it starts with one starter WhatsApp action, because there is no node editor yet. */
  create: async (p: NewAutomation): Promise<AutomationRow> => {
    if (AUTOMATIONS.length >= AUTOMATION_QUOTA) throw new Error(`Automation limit reached (${AUTOMATION_QUOTA}/${AUTOMATION_QUOTA}). Delete or copy fewer automations.`);
    const stamp = autoDate();
    const row: AutomationRow = {
      id: String(++autoSeq), name: `Automation ${Math.floor(Date.now() / 1000)}`,
      module: p.category === "Opportunity" ? "Opportunity" : "Lead/Application", list: p.module, trigger: p.trigger,
      createdOn: stamp, createdBy: "Admin User", startDate: "—", endDate: "—", status: "Draft", tags: [],
    };
    const starter = waNode("n-starter", "Welcome message (starter)", "Template: welcome_vsat");
    const nodes: AutomationNode[] = [triggerNode(row, p.triggerConfig)];
    if (p.conditions.length) {
      nodes.push({
        id: "n-if", kind: "condition",
        title: `IF ${p.conditions.map((c) => `${c.field} ${c.op} ${c.value}`).join(" AND ")}`,
        detail: "Entry condition. Records that do not match skip this automation.", yes: [starter], no: [],
      });
    } else nodes.push(starter);
    AUTOMATIONS.unshift(row);
    autoNodes.set(row.id, nodes);
    return wait({ ...row });
  },
  rename: async (id: string, name: string): Promise<AutomationRow> => {
    const a = autoById(id);
    const n = name.trim();
    if (autoNameTaken(n, id)) throw new Error("Another automation already has this name.");
    a.name = n;
    return wait({ ...a });
  },
  /** Draft / paused / stopped → Active, with a start date of now. */
  publish: async (id: string): Promise<AutomationRow> => {
    const a = autoById(id);
    if (a.status === "Active") throw new Error("This automation is already active.");
    if (countActions(nodesFor(a)) === 0) throw new Error("Add at least one action before publishing.");
    a.status = "Active"; a.startDate = autoDate();
    return wait({ ...a });
  },
  duplicate: async (id: string): Promise<AutomationRow> => {
    if (AUTOMATIONS.length >= AUTOMATION_QUOTA) throw new Error(`Automation limit reached (${AUTOMATION_QUOTA}/${AUTOMATION_QUOTA}). Delete one first.`);
    const a = autoById(id);
    let name = `Copy of ${a.name}`; let n = 2;
    while (autoNameTaken(name)) name = `Copy ${n++} of ${a.name}`;
    const row: AutomationRow = { ...a, id: String(++autoSeq), name, status: "Draft", createdOn: autoDate(), createdBy: "Admin User", startDate: "—", endDate: "—", tags: [...(a.tags ?? [])] };
    AUTOMATIONS.unshift(row);
    autoNodes.set(row.id, structuredClone(nodesFor(a)));
    return wait({ ...row });
  },
  /** View Performance: the communication jobs this automation has sent. */
  logs: (id: string, q: Query) => mockCommLogsApi.list({ ...q, filters: { ...(q.filters ?? {}), automationId: id } }),
};
/** Live (Slice 8, read-only: /api/admin/comm/automation) or the sample data above — switch in lib/live-config.ts. */
export const automationsApi: typeof mockAutomationsApi = LIVE_PAGES.automation ? liveAutomationsApi : mockAutomationsApi;
export const automationActionCount = countActions;

/* ══════════════════════════════════════════════════════
   SUPPRESSIONS
   ══════════════════════════════════════════════════════ */
const SUPPRESSIONS: SuppressionRow[] = [
  { id: "s1", contact: "test.user01@example.com", channel: "Email", reason: "Unsubscribe", addedOn: "30/09/2026, 02:44 pm", source: "Campaign link" },
  { id: "s2", contact: "admin.user@example.com", channel: "Email", reason: "Unsubscribe", addedOn: "26/09/2026, 09:21 am", source: "Campaign link" },
  { id: "s3", contact: "test.user02@example.com", channel: "Email", reason: "Unsubscribe", addedOn: "09/09/2026, 03:26 pm", source: "Campaign link" },
  { id: "s4", contact: "test.user03@example.com", channel: "Email", reason: "Unsubscribe", addedOn: "08/09/2026, 11:32 pm", source: "Campaign link" },
  { id: "s5", contact: "test.user04@example.com", channel: "Email", reason: "Unsubscribe", addedOn: "30/08/2026, 09:23 am", source: "Campaign link" },
  { id: "s6", contact: "test.user05@example.com", channel: "Email", reason: "Unsubscribe", addedOn: "27/08/2026, 04:37 pm", source: "Campaign link" },
  { id: "s7", contact: "test.user06@example.com", channel: "Email", reason: "Unsubscribe", addedOn: "26/08/2026, 06:06 pm", source: "Campaign link" },
  { id: "s8", contact: "test.user07@example.com", channel: "Email", reason: "Unsubscribe", addedOn: "21/08/2026, 07:04 am", source: "Campaign link" },
  { id: "s9", contact: "test.user08@example.com", channel: "Email", reason: "Unsubscribe", addedOn: "20/08/2026, 08:02 pm", source: "Campaign link" },
  { id: "s10", contact: "test.user09@example.com", channel: "Email", reason: "Unsubscribe", addedOn: "12/08/2026, 10:15 pm", source: "Campaign link" },
  { id: "s11", contact: "bounced@example.com", channel: "Email", reason: "Bounce", addedOn: "28/09/2026, 10:12 am", source: "Hard bounce" },
  { id: "s12", contact: "test.user10@invalid.example", channel: "Email", reason: "Bounce", addedOn: "22/09/2026, 05:40 pm", source: "Hard bounce" },
  { id: "s13", contact: "test.user11@example.com", channel: "Email", reason: "Bounce", addedOn: "14/09/2026, 08:03 am", source: "Soft bounce x5" },
  { id: "s14", contact: "blocked.user@example.com", channel: "Email", reason: "Block", addedOn: "11/09/2026, 07:55 pm", source: "Manual" },
  { id: "s15", contact: "flagged.user@example.com", channel: "Email", reason: "Spam", addedOn: "19/09/2026, 03:11 pm", source: "Spam complaint" },
  { id: "s16", contact: "complaint.user@example.com", channel: "Email", reason: "Spam", addedOn: "07/09/2026, 12:02 pm", source: "Spam complaint" },
  { id: "s17", contact: "typo@exmaple.com", channel: "Email", reason: "Invalid", addedOn: "17/09/2026, 09:47 am", source: "Syntax check" },
  // v2 · WhatsApp has one list only: people who opted out by replying STOP
  { id: "s18", contact: "+91 90000 00001", channel: "WhatsApp", reason: "Unsubscribe", addedOn: "27/10/2026, 07:04 pm", source: "STOP reply", keyword: "Stop" },
  { id: "s19", contact: "+91 90000 00002", channel: "WhatsApp", reason: "Unsubscribe", addedOn: "17/09/2026, 09:34 am", source: "STOP reply", keyword: "Stop" },
  { id: "s20", contact: "+91 90000 00003", channel: "WhatsApp", reason: "Unsubscribe", addedOn: "16/09/2026, 04:02 pm", source: "STOP reply", keyword: "Stop" },
  { id: "s21", contact: "+91 90000 00004", channel: "WhatsApp", reason: "Unsubscribe", addedOn: "15/09/2026, 05:03 pm", source: "STOP reply", keyword: "STOP" },
  { id: "s22", contact: "+91 90000 00005", channel: "WhatsApp", reason: "Unsubscribe", addedOn: "09/09/2026, 06:00 am", source: "STOP reply", keyword: "STOP" },
  { id: "s23", contact: "+91 90000 00006", channel: "WhatsApp", reason: "Unsubscribe", addedOn: "07/09/2026, 09:10 am", source: "STOP reply", keyword: "Stop" },
  { id: "s24", contact: "+91 90000 00007", channel: "WhatsApp", reason: "Unsubscribe", addedOn: "03/09/2026, 10:50 am", source: "STOP reply", keyword: "Stop" },
  { id: "s25", contact: "+91 90000 00008", channel: "WhatsApp", reason: "Unsubscribe", addedOn: "02/09/2026, 07:41 pm", source: "STOP reply", keyword: "STOP" },
  { id: "s26", contact: "+91 90000 00009", channel: "WhatsApp", reason: "Unsubscribe", addedOn: "02/09/2026, 07:39 pm", source: "STOP reply", keyword: "STOP" },
  { id: "s27", contact: "+91 90000 00010", channel: "WhatsApp", reason: "Unsubscribe", addedOn: "02/09/2026, 09:05 am", source: "STOP reply", keyword: "STOP" },
  { id: "s28", contact: "+91 90000 00011", channel: "WhatsApp", reason: "Unsubscribe", addedOn: "18/08/2026, 04:30 pm", source: "STOP reply", keyword: "Stop" },
  { id: "s29", contact: "+91 90000 00012", channel: "WhatsApp", reason: "Unsubscribe", addedOn: "24/07/2026, 11:10 am", source: "STOP reply", keyword: "Stop" },
];

/** "30/09/2026, 02:44 pm" → "2026-09-30 14:44" (sortable) */
const supStamp = (t: string) => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4}), (\d{1,2}):(\d{2}) (am|pm)$/i.exec(t);
  if (!m) return "";
  const h = (Number(m[4]) % 12) + (m[6].toLowerCase() === "pm" ? 12 : 0);
  return `${m[3]}-${m[2]}-${m[1]} ${String(h).padStart(2, "0")}:${m[5]}`;
};
SUPPRESSIONS.forEach((r) => { r.stamp = supStamp(r.addedOn); });
const supNow = () => {
  const d = new Date(), p = (n: number) => String(n).padStart(2, "0"), h = d.getHours() % 12 || 12;
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}, ${p(h)}:${p(d.getMinutes())} ${d.getHours() >= 12 ? "pm" : "am"}`;
};
const SUP_FILTERS = {
  channel: (r: SuppressionRow, v: string) => r.channel === v,
  reason: (r: SuppressionRow, v: string) => r.reason === v,
  addedDate: (r: SuppressionRow, v: string) => commInRange((r.stamp ?? "").slice(0, 10), v),
};
const SUP_EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]{2,}$/;

const mockSuppressionsApi = {
  list: (q: Query) =>
    wait(runQuery(SUPPRESSIONS, q, { searchKeys: ["contact", "source", "keyword"], filterMap: SUP_FILTERS })),
  /** Tab counts for the active channel (follows the search and the date range). */
  counts: async (channel: string, search?: string, addedDate?: string) => {
    const rows = runQuery(SUPPRESSIONS, { search, filters: { channel, ...(addedDate ? { addedDate } : {}) } }, {
      searchKeys: ["contact", "source", "keyword"], filterMap: SUP_FILTERS,
    }).rows;
    const by = (r: string) => rows.filter((x) => x.reason === r).length;
    return wait({ Unsubscribe: by("Unsubscribe"), Bounce: by("Bounce"), Block: by("Block"), Spam: by("Spam"), Invalid: by("Invalid") });
  },
  /** v2 · adds up to 10 contacts at once. Checks every one again here (the screen checks first, the server must too). Already-listed ones are skipped. */
  add: async (channel: "Email" | "WhatsApp", contacts: string[], reason: SuppressionRow["reason"], note?: string) => {
    void note; // the live version stores it; sample data does not
    const list = contacts.map((c) => c.trim()).filter(Boolean);
    if (list.length === 0) throw new Error("Enter at least one contact.");
    if (list.length > 10) throw new Error("You can add up to 10 at a time.");
    const clean = list.map((c) => {
      if (channel === "Email") { if (!SUP_EMAIL.test(c)) throw new Error(`"${c}" is not a valid email address.`); return c.toLowerCase(); }
      const d = c.replace(/[\s+()-]/g, "");
      if (!/^\d{10,15}$/.test(d)) throw new Error(`"${c}" is not a valid mobile number.`);
      return d.length === 10 ? `+91 ${d.slice(0, 5)} ${d.slice(5)}` : `+${d.slice(0, d.length - 10)} ${d.slice(-10, -5)} ${d.slice(-5)}`;
    });
    let added = 0, duplicates = 0;
    const when = supNow();
    for (const contact of [...new Set(clean)]) {
      if (SUPPRESSIONS.some((r) => r.channel === channel && r.reason === reason && r.contact === contact)) { duplicates++; continue; }
      SUPPRESSIONS.unshift({ id: `s${Date.now()}${added}`, contact, channel, reason, addedOn: when, stamp: supStamp(when), source: "Added manually", ...(channel === "WhatsApp" ? { keyword: "Manual" } : {}) });
      added++;
    }
    return wait({ ok: true, added, duplicates });
  },
  remove: async (ids: string[], reason?: string) => {
    void reason; // the live version needs it; sample data does not
    let removed = 0;
    ids.forEach((id) => { const i = SUPPRESSIONS.findIndex((r) => r.id === id); if (i >= 0) { SUPPRESSIONS.splice(i, 1); removed++; } });
    return wait({ ok: true, removed });
  },
};

/** Live (read-only, /api/admin/comm/*) or the sample data above — switch in lib/live-config.ts. */
export const suppressionsApi: typeof mockSuppressionsApi = LIVE_PAGES.suppressions ? liveSuppressionsApi : mockSuppressionsApi;

/* ══════════════════════════════════════════════════════
   COMMUNICATION PERFORMANCE
   ══════════════════════════════════════════════════════ */
const mockPerformanceApi = {
  /**
   * v2 · built only from the jobs in Manage Communication Logs (COMM_LOGS), so both screens always agree.
   * A job is counted when it has finished sending and has a Delivered number: Completed / Closed / Failed / Undelivered, not Amplify.
   * Failed = Targeted − Delivered. Scheduled, In Progress and Amplify (voice) jobs are not counted; they are listed in `basis`.
   */
  summary: async (q: Query): Promise<PerformanceSummary> => {
    const f = q.filters ?? {};
    const rows = COMM_LOGS.filter((r) =>
      (!f.channel || r.channel === f.channel) && (!f.template || r.template === f.template) &&
      (!f.sentBy || r.sentBy === f.sentBy) && (!f.commFor || r.commFor === f.commFor) &&
      (!f.startDate || commInRange(commDay(r.startDate), f.startDate)));
    const done = (r: CommLogRow) => r.channel !== "amplify" && r.delivered != null && ["Completed", "Closed", "Failed", "Undelivered"].includes(r.status);
    const used = rows.filter(done);
    const n = (r: CommLogRow, k: "read" | "clicked") => r[k] ?? 0;
    const add = (rs: CommLogRow[]) => ({
      sent: rs.reduce((s, r) => s + r.targeted, 0), delivered: rs.reduce((s, r) => s + (r.delivered ?? 0), 0),
      read: rs.reduce((s, r) => s + n(r, "read"), 0), clicked: rs.reduce((s, r) => s + n(r, "clicked"), 0),
    });
    const t = add(used);
    const byChannel = (["whatsapp", "email", "sms"] as Channel[]).map((c) => ({ channel: CHANNEL_LABEL[c], ...add(used.filter((r) => r.channel === c)) })).filter((c) => c.sent > 0);
    // trend: by month; when the range covers fewer than 3 months, by week (Monday start) so the chart is not just 1–2 bars
    const days = used.map((r) => ({ d: commDay(r.startDate), r })).filter((x) => x.d).sort((x, y) => x.d.localeCompare(y.d));
    const months = new Set(days.map((x) => x.d.slice(0, 7)));
    const weekly = months.size < 3;
    const key = (d: string) => {
      if (!weekly) return d.slice(0, 7);
      const dt = new Date(d + "T00:00:00Z"); dt.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7));
      return dt.toISOString().slice(0, 10);
    };
    const label = (k: string) => {
      const [y, m, d] = k.split("-");
      return weekly ? `Wk ${Number(d)} ${MONTHS[Number(m) - 1]}` : `${MONTHS[Number(m) - 1]} ${y}`;
    };
    const buckets = new Map<string, CommLogRow[]>();
    days.forEach(({ d, r }) => { const k = key(d); buckets.set(k, [...(buckets.get(k) ?? []), r]); });
    const trend = [...buckets.entries()].sort((x, y) => x[0].localeCompare(y[0])).map(([k, rs]) => ({ label: label(k), sent: add(rs).sent, delivered: add(rs).delivered }));
    return wait({
      totals: { ...t, failed: t.sent - t.delivered },
      byChannel,
      trend,
      basis: {
        matched: rows.length, counted: used.length,
        scheduled: rows.filter((r) => r.status === "Scheduled").length,
        inProgress: rows.filter((r) => r.status === "In Progress").length,
        voice: rows.filter((r) => r.channel === "amplify").length,
      },
      refreshedAt: now(),
    });
  },
  options: async (): Promise<Record<string, Option[]>> =>
    wait({
      channel: [{ value: "whatsapp", label: "WhatsApp" }, { value: "email", label: "Email" }, { value: "sms", label: "SMS" }],
      template: [...new Set(COMM_LOGS.map((r) => r.template).filter((x) => x !== "-"))].map((v) => ({ value: v, label: v })),
      sentBy: [...new Set(COMM_LOGS.map((r) => r.sentBy ?? "").filter(Boolean))].map((v) => ({ value: v, label: v })),
      commFor: ["Registered Leads", "Opportunity", "Raw Data", "Automation"].map((v) => ({ value: v, label: v })),
    }),
};

/** Live (read-only, /api/admin/comm/*) or the sample data above — switch in lib/live-config.ts. */
export const performanceApi: typeof mockPerformanceApi = LIVE_PAGES.performance ? livePerformanceApi : mockPerformanceApi;

/* ══════════════════════════════════════════════════════
   UPLOAD RAW DATA — wizard backing calls
   ══════════════════════════════════════════════════════ */
export const uploadApi = {
  /** v2 · dropdown options for step 1 (institute + forms). Async so the screen has a real loading state. */
  setupOptions: () =>
    wait({
      institutes: [{ value: "vedam", label: "Vedam School of Technology" }] as Option[],
      forms: [{ value: "application", label: "Application Form" }, { value: "enquiry", label: "Enquiry Form" }] as Option[],
    }),
  /** v2 · hands the chosen file's summary to the backend (never the file itself in this mock). */
  stageFile: (meta: { name: string; rows: number; columns: number }) => wait({ ok: true, ...meta }),
  createList: (payload: { institute: string; form: string; name: string; description: string }) =>
    wait({ ok: true, listId: String(9150 + Math.floor(Math.random() * 40)), ...payload }),
  /** Parses a CSV header row client-side so column mapping is real. */
  parseCsv: (text: string) => {
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    const split = (l: string) => l.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
    const headers = lines.length ? split(lines[0]) : [];
    const sample = lines.slice(1, 4).map(split);
    return { headers, sample, rowCount: Math.max(0, lines.length - 1) };
  },
  /** Fields a raw-data row can map onto. */
  targetFields: (): Option[] => [
    { value: "", label: "— Do not import —" },
    { value: "name", label: "Full name" },
    { value: "email", label: "Email" },
    { value: "mobile", label: "Mobile number" },
    { value: "city", label: "City" },
    { value: "course", label: "Course interested" },
    { value: "source", label: "Source" },
    { value: "utm_campaign", label: "UTM campaign" },
    { value: "remarks", label: "Remarks" },
  ],
  commit: (payload: Record<string, unknown>) => wait({ ok: true, jobId: `Upload#${Date.now().toString().slice(-6)}`, ...payload }),
};

/* ══════════════════════════════════════════════════════
   TEMPLATE MANAGER
   ══════════════════════════════════════════════════════ */

const DOC_TEMPLATES: DocTemplateRow[] = [
  { id: "dt1", title: "Default Application Print", formName: "All Forms", docType: "Application Print", sortOrder: 0, createdOn: "-", updatedOn: "-", status: "Active", system: true },
  { id: "dt2", title: "Ggn Pune for Raw", formName: "-", docType: "-", sortOrder: 0, createdOn: "01/09/2026 01:14 PM", updatedOn: "-", status: "Test Mode" },
  { id: "dt3", title: "Code_from_day1", formName: "-", docType: "-", sortOrder: 0, createdOn: "31/08/2026 03:14 PM", updatedOn: "-", status: "Test Mode" },
  { id: "dt4", title: "ggn pune", formName: "-", docType: "-", sortOrder: 0, createdOn: "31/08/2026 03:13 PM", updatedOn: "-", status: "Test Mode" },
  { id: "dt5", title: "Career Caounselling", formName: "-", docType: "-", sortOrder: 0, createdOn: "26/08/2026 12:15 PM", updatedOn: "-", status: "Test Mode" },
  { id: "dt6", title: "Cap round", formName: "-", docType: "-", sortOrder: 0, createdOn: "24/08/2026 12:58 PM", updatedOn: "-", status: "Test Mode" },
  { id: "dt7", title: "Telegram banner", formName: "Application Form", docType: "General Documents", sortOrder: 0, createdOn: "09/06/2026 06:38 PM", updatedOn: "09/06/2026 06:48 PM", status: "Active" },
  { id: "dt8", title: "Refer and earn", formName: "Application Form", docType: "General Documents", sortOrder: 0, createdOn: "03/06/2026 04:45 PM", updatedOn: "03/06/2026 05:35 PM", status: "Active" },
  { id: "dt9", title: "Pune Brouchure", formName: "Application Form", docType: "Static Document", sortOrder: 0, createdOn: "13/05/2026 05:12 PM", updatedOn: "-", status: "Active" },
  { id: "dt10", title: "Gurugram Brouchure", formName: "Application Form", docType: "Static Document", sortOrder: 0, createdOn: "13/05/2026 05:10 PM", updatedOn: "-", status: "Active" },
  { id: "dt11", title: "Offer Letter — B.Tech", formName: "Application Form", docType: "General Documents", sortOrder: 1, createdOn: "02/05/2026 11:20 AM", updatedOn: "18/08/2026 03:40 PM", status: "Active" },
  { id: "dt12", title: "Fee Receipt", formName: "All Forms", docType: "Form Payment Receipt", sortOrder: 2, createdOn: "02/05/2026 11:25 AM", updatedOn: "-", status: "Active" },
  { id: "dt13", title: "Scholarship Letter", formName: "Application Form", docType: "General Documents", sortOrder: 3, createdOn: "19/06/2026 09:05 AM", updatedOn: "-", status: "Draft" },
  { id: "dt14", title: "Hostel Allotment", formName: "All Forms", docType: "General Documents", sortOrder: 4, createdOn: "21/07/2026 04:50 PM", updatedOn: "-", status: "Inactive" },
];

/** Extra fields the Add / Edit drawer needs, kept apart from the list row. */
const DOC_DETAIL: Record<string, Partial<DocTemplateForm>> = {
  dt11: { docSubType: "Offer Letter" },
  dt13: { docSubType: "Offer Letter" },
  dt7: { size: "A5 (210 x 148 mm)", orientation: "Landscape", showAs: "Web View" },
};

export const DOC_TYPES = [
  "General Documents", "Form Payment Receipt", "Application Print", "Offline Application Print", "Attendance Sheet",
  "Token Fee Payment Receipt", "Post Application", "Walkin Letter", "Static Document",
];
export const DOC_SUBTYPES = ["Admit Card", "Result Card", "Score Card", "Offer Letter"];
export const DOC_SIZES = [
  "A0 (1189 x 841 mm)", "A1 (841 x 594 mm)", "A2 (594 x 420 mm)", "A3 (420 x 297 mm)", "A4 (297 x 210 mm)",
  "A5 (210 x 148 mm)", "Legal (297 x 420 mm)", "Tabloid (215 x 275 mm)",
];
export const DOC_TOKEN_FORMATS = ["Upper Case", "Sentence Case", "User Input"];

const tplDate = () => now().toUpperCase();
const docInRange = (field: "createdOn" | "updatedOn") => (r: DocTemplateRow, v: string) => commInRange(dayOf(r[field]), v);
const docRow = (id: string) => {
  const r = DOC_TEMPLATES.find((x) => x.id === id);
  if (!r) throw new Error("This template no longer exists. Refresh the list.");
  return r;
};
const fieldError = (field: string, message: string) => Object.assign(new Error(message), { field });

/** The application form's stages and printable fields (dummy). Toggles persist after Save. */
const FIELD_STAGE_NAMES = ["Stage 1 - Basic Details", "Stage 2 - Academic Details", "Stage 3 - Parent's Details", "Stage 4 - Upload Details", "Stage 5 - Declaration Details", "Stage 6 - Book Your VSAT Slot", "Stage 7 - Book a Campus Visit"];
const FIELD_LABELS: string[][] = [
  ["Basic Details", "Personal Details", "First Name", "Last Name", "Email Address", "Mobile Number", "Gender", "DOB", "Guardian Mobile Number", "Currently residing in (City)"],
  ["Academic Details", "Class 12 Board", "Class 12 Stream", "Class 12 Year of Passing", "Class 12 Percentage", "Class 10 Board", "Class 10 Percentage"],
  ["Parent's Details", "Father's Name", "Father's Occupation", "Mother's Name", "Mother's Occupation", "Parent's Email"],
  ["Upload Details", "Photograph", "Class 10 Marksheet", "Class 12 Marksheet", "ID Proof"],
  ["Declaration Details", "Declaration Accepted", "Place", "Date"],
  ["Slot Details", "VSAT Slot Date", "VSAT Slot Time"],
  ["Visit Details", "Campus", "Visit Date", "Visit Time"],
];
let DOC_FIELD_STATE: DocFieldStage[] = FIELD_STAGE_NAMES.map((name, i) => ({
  id: `st${i + 1}`, name, fields: FIELD_LABELS[i].map((label, j) => ({ id: `st${i + 1}f${j + 1}`, label, on: true })),
}));
const cloneStages = () => DOC_FIELD_STATE.map((s) => ({ ...s, fields: s.fields.map((f) => ({ ...f })) }));

const LANDING_TEMPLATES: LandingTemplateRow[] = [
  { id: "3005", title: "Mobile_NEW", assignedForms: "All Forms", templatePage: "Application", editor: "HTML Uploader", device: "Mobile", createdOn: "24/07/2026 02:40 PM", updatedOn: "24/07/2026 03:06 PM", status: "Active", views: 48220, submits: 3104 },
  { id: "3004", title: "Desktop_NEW", assignedForms: "All Forms", templatePage: "Application", editor: "HTML Uploader", device: "Desktop", createdOn: "24/07/2026 02:20 PM", updatedOn: "05/10/2026 04:23 PM", status: "Active", views: 31840, submits: 2408 },
  { id: "3003", title: "Coded one", assignedForms: "Application Form", templatePage: "Application", editor: "HTML Uploader", device: "Desktop", createdOn: "12/05/2025 02:30 PM", updatedOn: "12/05/2025 02:53 PM", status: "Draft", views: 0, submits: 0 },
  { id: "3002", title: "Application Page New", assignedForms: "All Forms", templatePage: "Application", editor: "Drag & Drop", device: "Both", createdOn: "12/05/2025 02:40 PM", updatedOn: "12/05/2025 02:49 PM", status: "Draft", views: 0, submits: 0 },
  { id: "3001", title: "Application Page", assignedForms: "All Forms", templatePage: "Application", editor: "Drag & Drop", device: "Both", createdOn: "01/12/2025 11:10 AM", updatedOn: "08/12/2025 03:55 PM", status: "Enabled", views: 12044, submits: 702 },
];
const LANDING_DETAIL: Record<string, Partial<LandingBasics>> = {};
let landingSeq = 3006;
const landingRow = (id: string) => {
  const r = LANDING_TEMPLATES.find((x) => x.id === id);
  if (!r) throw new Error("This template no longer exists. Refresh the list.");
  return r;
};
const landingInRange = (field: "createdOn" | "updatedOn") => (r: LandingTemplateRow, v: string) => commInRange(dayOf(r[field]), v);
export const LANDING_DOMAINS = ["apply.example.com"];

export const templatesApi = {
  documents: (q: Query) =>
    wait(runQuery(DOC_TEMPLATES, q, {
      searchKeys: ["title"],
      filterMap: {
        status: (r, val) => r.status === val,
        docType: (r, val) => r.docType === val,
        formName: (r, val) => r.formName === val || r.formName === "All Forms",
        createdOn: docInRange("createdOn"),
        updatedOn: docInRange("updatedOn"),
      },
    })),
  documentOptions: async (): Promise<Record<string, Option[]>> =>
    wait({
      status: ["Active", "Inactive", "Draft", "Test Mode"].map((x) => ({ value: x, label: x })),
      formName: [{ value: "Application Form", label: "Application Form" }],
      docType: DOC_TYPES.map((x) => ({ value: x, label: x })),
      docSubType: DOC_SUBTYPES.map((x) => ({ value: x, label: x })),
      size: DOC_SIZES.map((x) => ({ value: x, label: x })),
      tokenFormat: DOC_TOKEN_FORMATS.map((x) => ({ value: x, label: x })),
    }),
  documentDetail: async (id: string): Promise<DocTemplateForm> => {
    const r = docRow(id);
    const d = DOC_DETAIL[id] ?? {};
    return wait({
      title: r.title, docType: r.docType === "-" ? "" : r.docType, docSubType: d.docSubType ?? "",
      formName: r.formName === "All Forms" || r.formName === "-" ? "" : r.formName,
      html: d.html ?? `<p>Dear {{lead.full_name}},</p><p>This is a sample "${r.title}" document.</p>`,
      size: d.size ?? "A4 (297 x 210 mm)", tokenFormat: d.tokenFormat ?? "", orientation: d.orientation ?? "Portrait",
      showAs: d.showAs ?? "PDF", sortOrder: r.sortOrder ? String(r.sortOrder) : "", makeDefault: d.makeDefault ?? "No",
    });
  },
  /** Add (no id) or edit. Throws an Error; `field` names the input it belongs to. */
  documentSave: async (f: DocTemplateForm, id?: string): Promise<{ id: string }> => {
    const title = f.title.trim();
    if (!title) throw fieldError("title", "Enter a template title.");
    if (!f.docType) throw fieldError("docType", "Select a document type.");
    if (!f.formName) throw fieldError("formName", "Select a form.");
    if (!f.html.replace(/<[^>]*>/g, "").trim()) throw fieldError("html", "Design your template before saving.");
    if (f.sortOrder && !/^\d{1,4}$/.test(f.sortOrder)) throw fieldError("sortOrder", "Sort order must be a whole number (0 to 9999).");
    if (DOC_TEMPLATES.some((r) => r.id !== id && r.title.toLowerCase() === title.toLowerCase())) throw fieldError("title", "A template with this title already exists.");
    const detail: Partial<DocTemplateForm> = { docSubType: f.docType === "General Documents" ? f.docSubType : "", html: f.html, size: f.size, tokenFormat: f.tokenFormat, orientation: f.orientation, showAs: f.showAs, makeDefault: f.makeDefault };
    if (id) {
      const r = docRow(id);
      Object.assign(r, { title, formName: f.formName, sortOrder: Number(f.sortOrder || 0), updatedOn: tplDate() });
      DOC_DETAIL[id] = { ...DOC_DETAIL[id], ...detail };
      return wait({ id });
    }
    const nid = `dt${Date.now()}`;
    DOC_TEMPLATES.unshift({ id: nid, title, formName: f.formName, docType: f.docType, sortOrder: Number(f.sortOrder || 0), createdOn: tplDate(), updatedOn: "-", status: "Draft" });
    DOC_DETAIL[nid] = detail;
    return wait({ id: nid });
  },
  documentSetStatus: async (id: string, status: DocStatus) => { docRow(id).status = status; docRow(id).updatedOn = tplDate(); return wait({ ok: true, id, status }); },
  documentCopy: async (id: string) => {
    const r = docRow(id); const nid = `dt${Date.now()}`;
    DOC_TEMPLATES.unshift({ ...r, id: nid, title: `Copy of ${r.title}`, createdOn: tplDate(), updatedOn: "-", status: "Draft", system: undefined });
    DOC_DETAIL[nid] = { ...DOC_DETAIL[id] };
    return wait({ ok: true, id: nid });
  },
  documentGenerate: async (id: string) => { docRow(id); return wait({ ok: true, id }); },
  documentFields: async (formName: string): Promise<DocFieldStage[]> => {
    if (formName !== "Application Form") throw new Error("This form has no stages to configure.");
    return wait(cloneStages());
  },
  documentFieldsSave: async (formName: string, stages: DocFieldStage[]) => {
    if (formName !== "Application Form") throw new Error("This form has no stages to configure.");
    DOC_FIELD_STATE = stages.map((s) => ({ ...s, fields: s.fields.map((f) => ({ ...f })) }));
    return wait({ ok: true });
  },

  landing: (q: Query) =>
    wait(runQuery(LANDING_TEMPLATES, q, {
      searchKeys: ["title", "assignedForms", "editor"],
      filterMap: {
        status: (r, val) => r.status === val,
        device: (r, val) => r.device === val || r.device === "Both",
        editor: (r, val) => r.editor === val,
        form: (r, val) => r.assignedForms === val || r.assignedForms === "All Forms",
        templateType: (r, val) => r.templatePage === (val === "Application Page" ? "Application" : "Marketing"),
        createdOn: landingInRange("createdOn"),
        updatedOn: landingInRange("updatedOn"),
      },
    })),
  landingOptions: async (): Promise<Record<string, Option[]>> =>
    wait({
      status: ["Active", "Inactive", "Draft", "Enabled"].map((x) => ({ value: x, label: x })),
      form: [{ value: "Application Form", label: "Application Form" }],
      templateType: ["Application Page", "Landing Page"].map((x) => ({ value: x, label: x })),
      device: ["Mobile", "Desktop"].map((x) => ({ value: x, label: x })),
      domain: LANDING_DOMAINS.map((x) => ({ value: x, label: x })),
    }),
  landingDetail: async (id: string): Promise<LandingBasics> => {
    const r = landingRow(id); const d = LANDING_DETAIL[id] ?? {};
    return wait({
      kind: r.templatePage, editor: r.editor, forms: r.assignedForms === "All Forms" ? [] : [r.assignedForms],
      device: r.device === "Both" ? "" : r.device, name: r.title, tag: "", metaHead: "", metaTitle: "", metaKeywords: "", metaDescription: "",
      pageLoader: false, lazyLoad: false, domain: "", path: "", ...d,
    });
  },
  landingCheckUrl: async (domain: string, path: string): Promise<{ available: boolean }> => {
    if (!domain) throw fieldError("domain", "Select a domain first.");
    if (!/^[a-z0-9][a-z0-9-]{1,60}$/i.test(path)) throw fieldError("path", "Use letters, numbers and dashes only (2 or more characters).");
    return wait({ available: path.toLowerCase() !== "apply" });
  },
  /** Step 1 of the wizard. Throws an Error; `field` names the input it belongs to. */
  landingSave: async (b: LandingBasics, id?: string): Promise<{ id: string }> => {
    const name = b.name.trim();
    if (b.kind === "Application" && !b.device) throw fieldError("device", "Select a device type.");
    if (!name) throw fieldError("name", "Enter a template name.");
    if (LANDING_TEMPLATES.some((r) => r.id !== id && r.title.toLowerCase() === name.toLowerCase())) throw fieldError("name", "A template with this name already exists.");
    if (b.kind === "Marketing") {
      if (!b.domain) throw fieldError("domain", "Select a domain.");
      if (!b.path.trim()) throw fieldError("path", "Enter the page path.");
      if ((await templatesApi.landingCheckUrl(b.domain, b.path.trim())).available === false) throw fieldError("path", "This URL is already taken. Try another path.");
    }
    const { kind, editor, forms, device, ...rest } = b;
    void kind; void editor;
    if (id) {
      const r = landingRow(id);
      Object.assign(r, { title: name, assignedForms: forms.length ? forms.join(", ") : "All Forms", updatedOn: tplDate(), ...(b.kind === "Application" ? { device: device as "Mobile" | "Desktop" } : {}) });
      LANDING_DETAIL[id] = { ...LANDING_DETAIL[id], ...rest, name, forms, device };
      return wait({ id });
    }
    const nid = String(landingSeq++);
    LANDING_TEMPLATES.unshift({
      id: nid, title: name, assignedForms: forms.length ? forms.join(", ") : "All Forms", templatePage: b.kind, editor: b.editor,
      device: b.kind === "Application" ? (device as "Mobile" | "Desktop") : "Both", createdOn: tplDate(), updatedOn: tplDate(), status: "Draft", views: 0, submits: 0,
    });
    LANDING_DETAIL[nid] = { ...rest, name, forms, device };
    return wait({ id: nid });
  },
  landingGetUrl: async (id: string) => { landingRow(id); return wait({ url: `https://${LANDING_DOMAINS[0]}/p/${id}` }); },
  landingAddToGallery: async (id: string) => { landingRow(id); return wait({ ok: true, id }); },
};

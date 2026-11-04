/**
 * Communication Manager — domain types.
 *
 * Every screen talks to its data source through the Query/Page contract below.
 * When the real backend lands, only `lib/mock-api.ts` changes: the shapes here
 * and every component stay exactly as they are.
 */

// ── query contract (what a screen asks for) ────────────
export type SortDir = "asc" | "desc";

export type Query = {
  search?: string;
  page?: number;          // 1-based
  pageSize?: number;
  sortKey?: string;
  sortDir?: SortDir;
  filters?: Record<string, string>;
};

export type Page<T> = {
  rows: T[];
  total: number;          // total matching rows, not just this page
  refreshedAt: string;
};

// ── option lists (feed the filter dropdowns) ───────────
export type Option = { value: string; label: string };

// ── Manage List ────────────────────────────────────────
export type ListRow = {
  id: string;
  name: string;
  tagged: boolean;
  origin: string;
  totalLeads: number | null;   // null → render "View Count" link
  uniqueEmail: number | null;
  uniqueMobile: number | null;
  createdOn: string;
  createdBy: string;
  owner: string;
  /** v2 (optional so older code keeps compiling) */
  form?: string;               // "application" | "enquiry"
  description?: string;
  tags?: string[];
};

// ── WhatsApp Flow ──────────────────────────────────────
export type FlowRow = {
  id: string;
  name: string;
  description: string;
  tag: string;
  category: string;        // left-rail grouping
  scope: "recommended" | "mine";
  createdOn: string;
  status: "Active" | "Draft" | "Inactive";
  /** v2 (optional so older code keeps compiling) */
  module?: "Leads" | "Raw Data";
  screens?: FlowScreen[];
};

/** v2 · one screen of a flow, as shown in the phone preview */
export type FlowField = { label: string; kind: "text" | "select" | "date" | "checkbox"; placeholder?: string };
export type FlowScreen = { id: string; title: string; fields: FlowField[]; cta: string };

// ── In-App Call Logs ───────────────────────────────────
export type CallRow = {
  id: string;
  applicant: string;
  mobile: string;
  callingType: "Incoming" | "Outgoing";
  user: string;
  callStatus: "Answered" | "Missed";
  leadStatus: string;
  startTime: string;
  endTime: string;
  durationSec: number;
};

// ── Manage Communication Log ───────────────────────────
export type Channel = "email" | "whatsapp" | "amplify" | "sms";

export type CommLogRow = {
  id: string;
  channel: Channel;
  jobId: string;
  preview: string;
  previewNote?: string;
  template: string;
  status: CommStatus;
  statusInfo?: boolean;     // the ⓘ badge next to status
  startDate: string;
  listName: string;
  segmentName: string;
  targeted: number;
  delivered: number | null;
  automationId: string;
  /** v2 (optional so older code keeps compiling) — the extra Meritto columns and filters */
  form?: string;                         // "All Forms" | "Application Form"
  sentBy?: string;
  campaignName?: string;
  campaignType?: string;
  retry?: string;                        // "Feature not applicable" | "Pre-Implementation" | "Retry Excluded"
  nature?: "Single User" | "Bulk";
  commFor?: "Registered Leads" | "Raw Data" | "Opportunity" | "Automation";
  leadsType?: "List" | "Segment";
  engagement?: string;                   // "Engagement" | "Engagement (Numeric)" | "Activity"
  voiceType?: string;                    // Amplify only: "Mio AI Voice Outbound" | "Mio AI Voice Inbound"
  /** v2 · per-job engagement numbers (dummy). Read / Clicked exist only for jobs that have a Delivered number and are not Amplify. */
  read?: number;
  clicked?: number;
};

export type CommStatus = "Completed" | "In Progress" | "Failed" | "Scheduled" | "Closed" | "Undelivered";

/** v2 · Preview drawer content (WhatsApp bubble, e-mail, SMS, or an Amplify voice file) */
export type CommPreview = {
  kind: Channel; title: string; version: number; subject?: string; lines: string[]; audioName?: string; audioSec?: number;
};
/** v2 · one line in the "Status Detail" modal */
export type StatusDetailRow = { id: string; status: string; date: string };
/** v2 · one recipient in the Communication Logs Detailed Report */
export type CommDetailRow = {
  id: string; automationId: string; jobId: string; type: string; name: string; moduleType: string; listName: string;
  template: string; to: string; date: string; conversationType: string; region: string; status: string;
};
export type CommStats = { sent: number; delivered: number; read: number; failed: number; clicked: number; replied: number; unsubscribed: number; flowResponse: number };

// ── Manage Automation ──────────────────────────────────
export type AutomationRow = {
  id: string;
  name: string;
  module: string;
  list: string;
  trigger: string;
  createdOn: string;
  createdBy: string;
  startDate: string;
  endDate: string;
  status: "Active" | "Draft" | "Pause" | "Completed" | "Stopped";
  /** v2 */
  tags?: string[];
};

/** v2 · one box on the Edit Automation canvas. An IF/ELSE ("condition") node carries a Yes and a No branch. */
export type AutomationNodeKind = "trigger" | "condition" | "email" | "whatsapp";
export type AutomationNode = {
  id: string; kind: AutomationNodeKind; title: string; detail: string;
  yes?: AutomationNode[]; no?: AutomationNode[];
};
export type AutomationDetail = { row: AutomationRow; nodes: AutomationNode[] };

/** v2 · what the Create Automation wizard sends */
export type NewAutomation = {
  category: string;
  trigger: string;
  /** field / date field / repeat, depending on the trigger */
  triggerConfig?: string;
  module: string;
  conditions: { field: string; op: string; value: string }[];
};

// ── Suppressions ───────────────────────────────────────
export type SuppressionRow = {
  id: string;
  contact: string;          // email id or mobile number
  channel: "Email" | "WhatsApp";
  reason: "Unsubscribe" | "Bounce" | "Block" | "Spam" | "Invalid";
  addedOn: string;
  source: string;
  /** v2 · "2026-09-30 14:44" — sortable form of addedOn (the display text sorts wrongly as dd/mm/yyyy). */
  stamp?: string;
  /** v2 · WhatsApp only: the word the person replied with (Stop / STOP). */
  keyword?: string;
};

// ── Communication Performance ──────────────────────────
export type PerformanceSummary = {
  totals: { sent: number; delivered: number; read: number; clicked: number; failed: number };
  byChannel: { channel: string; sent: number; delivered: number; read: number; clicked: number }[];
  trend: { label: string; sent: number; delivered: number }[];
  /** v2 · what the numbers are built from: the jobs in Manage Communication Logs that match the filters. */
  basis: { matched: number; counted: number; scheduled: number; inProgress: number; voice: number };
  refreshedAt: string;
};

/* ══════════════════════════════════════════════════════
   TEMPLATE MANAGER
   ══════════════════════════════════════════════════════ */

export type DocStatus = "Active" | "Inactive" | "Draft" | "Test Mode";

export type DocTemplateRow = {
  id: string;
  title: string;
  formName: string;
  docType: string;
  sortOrder: number;
  createdOn: string;
  updatedOn: string;
  status: DocStatus;
  /** the built-in print template: not editable, has Field(s) configuration + Generate instead */
  system?: boolean;
};

/** Everything the Add / Edit Document Template drawer edits. */
export type DocTemplateForm = {
  title: string;
  docType: string;
  docSubType: string;
  formName: string;
  html: string;
  size: string;
  tokenFormat: string;
  orientation: "Portrait" | "Landscape";
  showAs: "PDF" | "Web View";
  sortOrder: string;
  makeDefault: "No" | "Yes";
};

export type DocFieldStage = { id: string; name: string; fields: { id: string; label: string; on: boolean }[] };

export type LandingEditor = "HTML Uploader" | "Drag & Drop";
export type LandingKind = "Application" | "Marketing";

export type LandingTemplateRow = {
  id: string;
  title: string;
  assignedForms: string;
  /** "Application" or "Marketing" (shown under Page Type) */
  templatePage: LandingKind;
  editor: LandingEditor;
  device: "Mobile" | "Desktop" | "Both";
  createdOn: string;
  updatedOn: string;
  status: "Active" | "Inactive" | "Draft" | "Enabled";
  views: number;
  submits: number;
};

/** Step 1 of the Add / Edit Layout Template wizard. */
export type LandingBasics = {
  kind: LandingKind;
  editor: LandingEditor;
  forms: string[];
  device: string;
  name: string;
  tag: string;
  metaHead: string;
  metaTitle: string;
  metaKeywords: string;
  metaDescription: string;
  pageLoader: boolean;
  lazyLoad: boolean;
  /** Marketing pages only */
  domain: string;
  path: string;
};

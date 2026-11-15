/**
 * WhatsApp Flow · the two "Recommended" flows, the default screen and the default categories.
 * They live in the app's code, never in the database, and their ids (f1, f2) are never sent to the API.
 * Shared by the sample data (mock-api.ts) and the live client (live-flows.ts) so the two cannot drift apart.
 */
import type { FlowRow, FlowScreen } from "./types";

export const SCREEN_DETAILS: FlowScreen = {
  id: "screen_one", title: "Candidate Details", cta: "Continue",
  fields: [
    { label: "Full name", kind: "text", placeholder: "Your name" },
    { label: "Mobile number", kind: "text", placeholder: "10-digit number" },
    { label: "Email", kind: "text", placeholder: "you@example.com" },
  ],
};

export const RECOMMENDED_FLOWS: readonly FlowRow[] = [
  { id: "f1", name: "Lead from Raw Data", description: "testing", tag: "Raw Data", category: "Lead Nurturing", scope: "recommended", createdOn: "18/09/2025, 12:48 PM", status: "Active", module: "Raw Data", screens: [SCREEN_DETAILS] },
  { id: "f2", name: "Miss Call Data Flow", description: "data collection for missed calls", tag: "Leads", category: "Lead Nurturing", scope: "recommended", createdOn: "09/09/2025, 12:48 PM", status: "Active", module: "Leads",
    screens: [{ id: "screen_one", title: "Candidate Details", cta: "Continue", fields: [
      { label: "Full name", kind: "text", placeholder: "Your name" },
      { label: "Mobile number", kind: "text", placeholder: "10-digit number" },
      { label: "Best time to call", kind: "select", placeholder: "Select a time" },
    ] }] },
];

export const DEFAULT_FLOW_CATEGORIES: readonly string[] = ["Lead Nurturing", "Admissions"];

export const isRecommendedId = (id: string): boolean => RECOMMENDED_FLOWS.some((f) => f.id === id);

/** a deep copy of screens (never hand out the shared objects) */
export const copyScreens = (s: readonly FlowScreen[] | undefined): FlowScreen[] =>
  (s ?? []).map((x) => ({ ...x, fields: x.fields.map((f) => ({ ...f })) }));

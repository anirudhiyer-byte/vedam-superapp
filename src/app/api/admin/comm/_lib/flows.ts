/**
 * Communication Manager · Slice 6 · WhatsApp Flow drafts — limits and the create plan.
 * The body schema (strict, plain-text screens) lives in src/lib/comm/flow-rules.ts and is shared with the browser;
 * the database checks everything again (0069). Nothing here sends a message or talks to Meta / WhatsApp.
 */
import type { FlowCreateBody } from "@/lib/comm/flow-rules";
import type { WritePlan } from "./write";

/** a few creates / copies / deletes per minute is plenty for a drafts page */
export const FLOW_LIMITS = { action: "comm_flow", perUser: 30, perIp: 90 } as const;
/** 20 KB of screens + name / description / category, JSON-escaped; anything bigger is refused before parsing */
export const FLOW_BODY_MAX_BYTES = 32 * 1024;

export function planCreate(b: FlowCreateBody): WritePlan {
  return {
    ok: true, fn: "comm_flow_create",
    args: { p_name: b.name.trim(), p_description: b.description, p_module: b.module, p_category: b.category.trim(), p_screens: b.screens },
  };
}

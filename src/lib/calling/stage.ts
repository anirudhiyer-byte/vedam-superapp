/**
 * Calling pool · the student's VSAT stage (migration 0181). The database works the value out
 * (calling__vsat_stage): a VSAT pipeline stage, or "no_application" / "not_registered". This only
 * turns it into words for the Calling Data table.
 */
import { STAGE_LABEL, type Stage } from "@/lib/vsat/pipeline";

export const CALLING_STAGE_EXTRA: Record<string, string> = {
  not_registered: "Not registered",
  no_application: "Registered, no application",
};

/** "vsat_cleared" → "VSAT cleared"; empty → "—" (e.g. assigned before 0181); unknown keys are shown as words, never raw. */
export function callingStageLabel(v: unknown): string {
  if (typeof v !== "string" || v.trim() === "") return "—";
  if (v in CALLING_STAGE_EXTRA) return CALLING_STAGE_EXTRA[v];
  if (v in STAGE_LABEL) return STAGE_LABEL[v as Stage];
  return v.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

/** True when the student moved after the lead was assigned (both known and different). */
export function stageMovedSinceAssignment(atAssignment: unknown, now: unknown): boolean {
  return typeof atAssignment === "string" && atAssignment !== "" && typeof now === "string" && now !== "" && atAssignment !== now;
}

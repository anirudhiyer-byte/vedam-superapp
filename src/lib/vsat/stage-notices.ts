/**
 * VSAT stage emails · server job (service role). Server-only.
 *
 *   sendStageNotices   emails a student when admissions moves them to a stage that has its own comms step:
 *                        pi_cleared → "PI cleared → student" (0173, owner's review: "the student gets the PI-cleared email")
 *
 * The database queues one job when a student becomes PI cleared (the vsat_stage_notice trigger on vsat_pipeline,
 * once per student and attempt) and hands each job out once (vsat_stage_notices_claim). A job whose student is no
 * longer at that stage (moved back, on hold, dropped) is skipped there, so a student never gets an outdated email.
 * With the step or the comms master switch off, the job is closed as skipped (no late emails when it is turned on).
 * Called by the "send now" route after admissions moves students, and by the VSAT cron (every 10 minutes).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { deliverEmail } from "@/lib/email/deliver";
import { fillTemplate } from "./interviews";

if (typeof window !== "undefined") throw new Error("vsat/stage-notices is server-only");

/** The stages that send an email, and their comms step (the step key is the stage, as in vsat_comm_steps). */
export const STAGE_NOTICE_STEPS = ["pi_cleared"] as const;
export type StageNoticeStage = (typeof STAGE_NOTICE_STEPS)[number];
/** The placeholders a stage email can use. */
export const STAGE_NOTICE_VARS = ["name", "application_no", "dashboard_link"] as const;

export type StageNoticeJob = {
  id: string; stage: string; attempts: number; sent_to: string[] | null;
  student: { name: string | null; email: string | null; lead_id: string | null; application_no: string | null; campus: string | null };
};
type StepCfg = { step_key: string; title: string; enabled: boolean; test_mode: boolean; email_enabled: boolean; email_subject: string; email_body: string };
export type StageNoticeConfig = { master: boolean; testEmail: string; steps: Partial<Record<string, StepCfg>> };

export async function loadStageNoticeConfig(db: SupabaseClient): Promise<StageNoticeConfig> {
  const [{ data: stepRows }, { data: settings }] = await Promise.all([
    db.from("vsat_comm_steps").select("step_key, title, enabled, test_mode, email_enabled, email_subject, email_body").in("step_key", [...STAGE_NOTICE_STEPS]),
    db.from("vsat_comm_settings").select("master, test_email").eq("id", true).maybeSingle(),
  ]);
  const s = settings as { master?: boolean; test_email?: string } | null;
  return {
    master: !!s?.master, testEmail: (s?.test_email ?? "").trim(),
    steps: Object.fromEntries(((stepRows ?? []) as StepCfg[]).map((r) => [r.step_key, r])),
  };
}

export function stageEmailVars(job: StageNoticeJob, site: string): Record<(typeof STAGE_NOTICE_VARS)[number], string> {
  return {
    name: (job.student.name ?? "").trim() || "Student",
    application_no: job.student.application_no ?? "",
    dashboard_link: `${site}/apply/dashboard`,
  };
}

type Deliver = typeof deliverEmail;

/** Claim stage email jobs and send them. `ids` limits it to some students (the route after a move). */
export async function sendStageNotices(
  db: SupabaseClient,
  opts: { ids?: string[]; limit?: number; site: string },
  deps: { deliver?: Deliver; config?: StageNoticeConfig } = {},
): Promise<{ jobs: number; sent: number; failed: number; off: number }> {
  const out = { jobs: 0, sent: 0, failed: 0, off: 0 };
  const p: Record<string, unknown> = { limit: opts.limit ?? 20 };
  if (opts.ids) p.application_ids = opts.ids;
  const { data, error } = await db.rpc("vsat_stage_notices_claim", { p });
  if (error) throw new Error(`stage_notices_claim: ${error.message}`);
  const jobs = (Array.isArray(data) ? data : []) as StageNoticeJob[];
  if (!jobs.length) return out;
  const cfg = deps.config ?? (await loadStageNoticeConfig(db));
  const deliver = deps.deliver ?? deliverEmail;

  for (const job of jobs) {
    out.jobs++;
    const sentTo = [...(job.sent_to ?? [])];
    let failed = false;
    // a stage without its own step has nothing to send (closed as skipped)
    const step = (STAGE_NOTICE_STEPS as readonly string[]).includes(job.stage) ? cfg.steps[job.stage] ?? null : null;
    const to = step?.test_mode ? cfg.testEmail : (job.student.email ?? "").trim();
    if (sentTo.includes("student")) {
      // already delivered on an earlier try
    } else if (!cfg.master || !step || !step.enabled || !step.email_enabled || !to) {
      out.off++;
    } else {
      const vars = stageEmailVars(job, opts.site);
      try {
        const r = await deliver({
          to,
          subject: fillTemplate(step.email_subject, vars, "text"),
          html: fillTemplate(step.email_body, vars, "html"),
          kind: `vsat_${job.stage}`,
          userId: !step.test_mode ? job.student.lead_id : null,
          refId: job.id,
          refName: step.title,
        });
        if (r.ok) { sentTo.push("student"); out.sent++; } else { failed = true; out.failed++; }
      } catch {
        failed = true;
        out.failed++;
      }
    }
    const status = failed ? "failed" : sentTo.length > 0 ? "sent" : "skipped";
    await db.rpc("vsat_stage_notice_done", { p: { id: job.id, status, detail: { sent_to: sentTo, test: !!step?.test_mode } } });
  }
  return out;
}

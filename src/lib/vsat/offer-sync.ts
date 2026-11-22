/**
 * VSAT offers · server job (service role). Server-only.
 *
 *   sendOfferNotices   the "Offer released → student" email through the VSAT comms step offer_released
 *
 * The database queues one email job per release (migration 0144, vsat_offer_events) and hands each job out
 * once (vsat_offer_notices_claim). A job whose offer is no longer the current, valid one (cancelled,
 * re-released, past the deadline) is skipped there, so a student never gets an outdated offer. With the
 * step or the comms master switch off, the job is closed as skipped (no late emails when it is turned on).
 * Called by the "send now" route after a release and by the VSAT cron (every 10 minutes, production).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { deliverEmail } from "@/lib/email/deliver";
import { fillTemplate } from "./interviews";
import { OFFER_STEP, offerVars, type OfferJob } from "./offers";

if (typeof window !== "undefined") throw new Error("vsat/offer-sync is server-only");

type StepCfg = { step_key: string; title: string; enabled: boolean; test_mode: boolean; email_enabled: boolean; email_subject: string; email_body: string };
export type OfferNoticeConfig = { master: boolean; testEmail: string; step: StepCfg | null };

export async function loadOfferNoticeConfig(db: SupabaseClient): Promise<OfferNoticeConfig> {
  const [{ data: step }, { data: settings }] = await Promise.all([
    db.from("vsat_comm_steps").select("step_key, title, enabled, test_mode, email_enabled, email_subject, email_body").eq("step_key", OFFER_STEP).maybeSingle(),
    db.from("vsat_comm_settings").select("master, test_email").eq("id", true).maybeSingle(),
  ]);
  const s = settings as { master?: boolean; test_email?: string } | null;
  return { master: !!s?.master, testEmail: (s?.test_email ?? "").trim(), step: (step as StepCfg | null) ?? null };
}

type Deliver = typeof deliverEmail;

/** Claim offer email jobs and send them. `ids` limits it to some students (the route after a release). */
export async function sendOfferNotices(
  db: SupabaseClient,
  opts: { ids?: string[]; limit?: number; site: string },
  deps: { deliver?: Deliver; config?: OfferNoticeConfig } = {},
): Promise<{ jobs: number; sent: number; failed: number; off: number }> {
  const out = { jobs: 0, sent: 0, failed: 0, off: 0 };
  const p: Record<string, unknown> = { limit: opts.limit ?? 20 };
  if (opts.ids) p.application_ids = opts.ids;
  const { data, error } = await db.rpc("vsat_offer_notices_claim", { p });
  if (error) throw new Error(`offer_notices_claim: ${error.message}`);
  const jobs = (Array.isArray(data) ? data : []) as OfferJob[];
  if (!jobs.length) return out;
  const cfg = deps.config ?? (await loadOfferNoticeConfig(db));
  const deliver = deps.deliver ?? deliverEmail;

  for (const job of jobs) {
    out.jobs++;
    const sentTo = [...(job.sent_to ?? [])];
    let failed = false;
    const step = cfg.step;
    const to = step?.test_mode ? cfg.testEmail : (job.student.email ?? "").trim();
    if (sentTo.includes("student")) {
      // already delivered on an earlier try
    } else if (!cfg.master || !step || !step.enabled || !step.email_enabled || !to) {
      out.off++;
    } else {
      const vars = offerVars(job, opts.site);
      try {
        const r = await deliver({
          to,
          subject: fillTemplate(step.email_subject, vars, "text"),
          html: fillTemplate(step.email_body, vars, "html"),
          kind: `vsat_${OFFER_STEP}`,
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
    await db.rpc("vsat_offer_notice_done", { p: { id: job.id, status, detail: { sent_to: sentTo, test: !!step?.test_mode } } });
  }
  return out;
}

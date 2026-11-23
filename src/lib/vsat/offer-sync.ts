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
 *
 * The student's Acceptance Letter (PDF, offer-letter-pdf.ts) goes with the email. If it cannot be drawn
 * (no campus), the email is not sent and the job is marked failed, so a student never gets the email
 * without the letter it asks them to sign.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { deliverEmail } from "@/lib/email/deliver";
import { fillTemplate } from "./interviews";
import { OFFER_STEP, offerEmailVars, type OfferJob } from "./offers";
import { CAMPUS_LETTER, campusKey, letterFileName, offerDays, type CampusKey, type LetterInput } from "./offer-letter";
import { buildOfferLetterPdfBase64 } from "./offer-letter-pdf";

if (typeof window !== "undefined") throw new Error("vsat/offer-sync is server-only");

type StepCfg = { step_key: string; title: string; enabled: boolean; test_mode: boolean; email_enabled: boolean; email_subject: string; email_body: string };
type CampusCfg = { programme_fee: number | string | null; offer_days: number | null };
export type OfferNoticeConfig = { master: boolean; testEmail: string; step: StepCfg | null; campus?: Partial<Record<CampusKey, CampusCfg>> };

export async function loadOfferNoticeConfig(db: SupabaseClient): Promise<OfferNoticeConfig> {
  const [{ data: step }, { data: settings }, { data: campuses }] = await Promise.all([
    db.from("vsat_comm_steps").select("step_key, title, enabled, test_mode, email_enabled, email_subject, email_body").eq("step_key", OFFER_STEP).maybeSingle(),
    db.from("vsat_comm_settings").select("master, test_email").eq("id", true).maybeSingle(),
    db.from("vsat_campus_settings").select("campus, programme_fee, offer_days"),
  ]);
  const s = settings as { master?: boolean; test_email?: string } | null;
  const campus: Partial<Record<CampusKey, CampusCfg>> = {};
  for (const c of (campuses ?? []) as ({ campus: string } & CampusCfg)[]) {
    const k = campusKey(c.campus);
    if (k) campus[k] = { programme_fee: c.programme_fee, offer_days: c.offer_days };
  }
  return { master: !!s?.master, testEmail: (s?.test_email ?? "").trim(), step: (step as StepCfg | null) ?? null, campus };
}

type Deliver = typeof deliverEmail;
type Letter = (input: LetterInput) => Promise<string>;

/** What the letter needs for one email job (the campus settings, else the season's letter values). */
export function letterInput(job: OfferJob, cfg: OfferNoticeConfig, site: string): LetterInput | null {
  const campus = campusKey(job.student.campus);
  if (!campus) return null;
  const c = cfg.campus?.[campus];
  return {
    name: (job.student.name ?? "").trim() || "Student",
    campus,
    pct: job.scholarship_pct,
    programmeFee: c?.programme_fee ?? CAMPUS_LETTER[campus].programmeFee,
    seatBlock: job.amount ?? 50000,
    days: offerDays(job.released_at, job.expires_at, c?.offer_days ?? 5),
    dashboardLink: `${site}/apply/dashboard`,
  };
}

/** Claim offer email jobs and send them. `ids` limits it to some students (the route after a release). */
export async function sendOfferNotices(
  db: SupabaseClient,
  opts: { ids?: string[]; limit?: number; site: string },
  deps: { deliver?: Deliver; config?: OfferNoticeConfig; letter?: Letter } = {},
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
  const letter = deps.letter ?? buildOfferLetterPdfBase64;

  for (const job of jobs) {
    out.jobs++;
    const sentTo = [...(job.sent_to ?? [])];
    let failed = false;
    let why: string | null = null;
    const step = cfg.step;
    const to = step?.test_mode ? cfg.testEmail : (job.student.email ?? "").trim();
    if (sentTo.includes("student")) {
      // already delivered on an earlier try
    } else if (!cfg.master || !step || !step.enabled || !step.email_enabled || !to) {
      out.off++;
    } else {
      const vars = offerEmailVars(job, opts.site);
      try {
        const input = letterInput(job, cfg, opts.site);
        if (!input) throw Object.assign(new Error("no campus"), { why: "letter_no_campus" });
        const pdf = await letter(input).catch((e: unknown) => { throw Object.assign(new Error(String(e)), { why: "letter_failed" }); });
        const r = await deliver({
          to,
          subject: fillTemplate(step.email_subject, vars, "text"),
          html: fillTemplate(step.email_body, vars, "html"),
          kind: `vsat_${OFFER_STEP}`,
          userId: !step.test_mode ? job.student.lead_id : null,
          refId: job.id,
          refName: step.title,
          attachments: [{ filename: letterFileName(job.student.name), content: pdf, mimetype: "application/pdf" }],
        });
        if (r.ok) { sentTo.push("student"); out.sent++; } else { failed = true; out.failed++; }
      } catch (e) {
        failed = true;
        why = (e as { why?: string }).why ?? null;
        out.failed++;
      }
    }
    const status = failed ? "failed" : sentTo.length > 0 ? "sent" : "skipped";
    const detail: Record<string, unknown> = { sent_to: sentTo, test: !!step?.test_mode };
    if (why) detail.why = why;
    await db.rpc("vsat_offer_notice_done", { p: { id: job.id, status, detail } });
  }
  return out;
}

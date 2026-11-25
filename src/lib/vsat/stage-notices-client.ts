/**
 * VSAT stage emails (0173) · browser side: after admin / admissions move students to a stage that sends an email
 * (PI cleared), ask the server to send those emails now instead of waiting for the cron (every 10 minutes).
 * Best effort: whatever is not sent here is sent by the cron.
 */

/** The stages that send the student an email when a student is moved there. */
export const STAGES_WITH_EMAIL: readonly string[] = ["pi_cleared"];
/** Students per "send now" call (the database hands out at most 100 jobs per call). */
export const STAGE_NOTICE_MAX = 100;

/** Splits the moved students into calls of STAGE_NOTICE_MAX. */
export function noticeChunks(ids: string[]): string[][] {
  const out: string[][] = [];
  const uniq = [...new Set(ids)];
  for (let i = 0; i < uniq.length; i += STAGE_NOTICE_MAX) out.push(uniq.slice(i, i + STAGE_NOTICE_MAX));
  return out;
}

/** Sends the queued stage emails of these students now; false if a call failed (the cron sends them later). */
export async function sendStageEmailsNow(ids: string[], post: typeof fetch = fetch): Promise<boolean> {
  let ok = true;
  for (const chunk of noticeChunks(ids)) {
    try {
      const res = await post("/api/vsat/stage-notices/notify", {
        method: "POST", credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ application_ids: chunk }),
      });
      if (!res.ok) ok = false;
    } catch {
      ok = false;
    }
  }
  return ok;
}

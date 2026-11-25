import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { STAGE_NOTICE_STEPS, sendStageNotices, stageEmailVars, type StageNoticeConfig, type StageNoticeJob } from "./stage-notices";

function fakeDb(answers: Record<string, unknown>) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const db = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      const a = answers[fn];
      return { data: a ?? null, error: a instanceof Error ? { message: a.message } : null };
    },
  } as unknown as SupabaseClient;
  return { db, calls };
}

const job: StageNoticeJob = {
  id: "sn-1", stage: "pi_cleared", attempts: 1, sent_to: [],
  student: { name: "Asha <i>R</i>", email: "asha@example.com", lead_id: "lead-9", application_no: "VED-42", campus: "pune" },
};
const cfg = (over: Partial<StageNoticeConfig> = {}, step: Partial<NonNullable<StageNoticeConfig["steps"]["pi_cleared"]>> = {}): StageNoticeConfig => ({
  master: true, testEmail: "qa@vedam.org",
  steps: {
    pi_cleared: { step_key: "pi_cleared", title: "PI cleared → student", enabled: true, test_mode: false, email_enabled: true,
                  email_subject: "You've cleared your Vedam interview, {{name}}", email_body: "<p>Hi {{name}} ({{application_no}}): {{dashboard_link}}</p>", ...step },
  },
  ...over,
});
const SITE = "https://one.vedam.org";

describe("sendStageNotices (PI cleared → student)", () => {
  it("only PI cleared sends an email for now", () => {
    expect([...STAGE_NOTICE_STEPS]).toEqual(["pi_cleared"]);
  });
  it("emails the student through the step and records it", async () => {
    const sent: Record<string, unknown>[] = [];
    const { db, calls } = fakeDb({ vsat_stage_notices_claim: [job], vsat_stage_notice_done: { updated: true } });
    const r = await sendStageNotices(db, { site: SITE, ids: ["A1"] }, { config: cfg(), deliver: async (o) => { sent.push(o); return { ok: true }; } });
    expect(r).toEqual({ jobs: 1, sent: 1, failed: 0, off: 0 });
    expect(calls[0]).toEqual({ fn: "vsat_stage_notices_claim", args: { p: { limit: 20, application_ids: ["A1"] } } });
    expect(sent[0]).toMatchObject({ to: "asha@example.com", subject: "You've cleared your Vedam interview, Asha <i>R</i>", kind: "vsat_pi_cleared",
      userId: "lead-9", refId: "sn-1", refName: "PI cleared → student" });
    expect(String(sent[0].html)).toBe("<p>Hi Asha &lt;i&gt;R&lt;/i&gt; (VED-42): https://one.vedam.org/apply/dashboard</p>");
    expect(calls.at(-1)).toEqual({ fn: "vsat_stage_notice_done", args: { p: { id: "sn-1", status: "sent", detail: { sent_to: ["student"], test: false } } } });
  });
  it("comms master off, step off, email off, no step or no email → nothing sent, job closed as skipped", async () => {
    for (const c of [cfg({ master: false }), cfg({}, { enabled: false }), cfg({}, { email_enabled: false }), cfg({ steps: {} })]) {
      const { db, calls } = fakeDb({ vsat_stage_notices_claim: [job], vsat_stage_notice_done: { updated: true } });
      let n = 0;
      const r = await sendStageNotices(db, { site: SITE }, { config: c, deliver: async () => { n++; return { ok: true }; } });
      expect(n).toBe(0);
      expect(r.off).toBe(1);
      expect((calls.at(-1)!.args.p as { status: string }).status).toBe("skipped");
    }
    const { db } = fakeDb({ vsat_stage_notices_claim: [{ ...job, student: { ...job.student, email: " " } }], vsat_stage_notice_done: {} });
    expect((await sendStageNotices(db, { site: SITE }, { config: cfg(), deliver: async () => ({ ok: true }) })).off).toBe(1);
  });
  it("a stage without its own email step is closed as skipped", async () => {
    let n = 0;
    const { db, calls } = fakeDb({ vsat_stage_notices_claim: [{ ...job, stage: "counselling_done" }], vsat_stage_notice_done: {} });
    const r = await sendStageNotices(db, { site: SITE }, { config: cfg(), deliver: async () => { n++; return { ok: true }; } });
    expect(n).toBe(0);
    expect(r.off).toBe(1);
    expect((calls.at(-1)!.args.p as { status: string }).status).toBe("skipped");
  });
  it("test mode → the comms test inbox, never the student, no user id", async () => {
    const sent: Record<string, unknown>[] = [];
    const { db, calls } = fakeDb({ vsat_stage_notices_claim: [job], vsat_stage_notice_done: {} });
    await sendStageNotices(db, { site: SITE }, { config: cfg({}, { test_mode: true }), deliver: async (o) => { sent.push(o); return { ok: true }; } });
    expect(sent[0]).toMatchObject({ to: "qa@vedam.org", userId: null });
    expect((calls.at(-1)!.args.p as { detail: { test: boolean } }).detail.test).toBe(true);
  });
  it("delivery fails or throws → failed (the database retries it)", async () => {
    for (const deliver of [async () => ({ ok: false, error: "smtp" }), async () => { throw new Error("down"); }]) {
      const { db, calls } = fakeDb({ vsat_stage_notices_claim: [job], vsat_stage_notice_done: {} });
      const r = await sendStageNotices(db, { site: SITE }, { config: cfg(), deliver });
      expect(r.failed).toBe(1);
      expect((calls.at(-1)!.args.p as { status: string }).status).toBe("failed");
    }
  });
  it("already delivered on an earlier try → not sent twice", async () => {
    let n = 0;
    const { db, calls } = fakeDb({ vsat_stage_notices_claim: [{ ...job, sent_to: ["student"] }], vsat_stage_notice_done: {} });
    await sendStageNotices(db, { site: SITE }, { config: cfg(), deliver: async () => { n++; return { ok: true }; } });
    expect(n).toBe(0);
    expect((calls.at(-1)!.args.p as { status: string }).status).toBe("sent");
  });
  it("nothing queued → no config read, no calls after the claim; a claim error throws", async () => {
    const { db, calls } = fakeDb({ vsat_stage_notices_claim: [] });
    expect(await sendStageNotices(db, { site: SITE })).toEqual({ jobs: 0, sent: 0, failed: 0, off: 0 });
    expect(calls).toHaveLength(1);
    const bad = fakeDb({ vsat_stage_notices_claim: new Error("FORBIDDEN") });
    await expect(sendStageNotices(bad.db, { site: SITE })).rejects.toThrow("stage_notices_claim: FORBIDDEN");
  });
  it("placeholders: a missing name reads Student", () => {
    expect(stageEmailVars({ ...job, student: { ...job.student, name: " " } }, SITE)).toEqual({
      name: "Student", application_no: "VED-42", dashboard_link: "https://one.vedam.org/apply/dashboard",
    });
  });
});

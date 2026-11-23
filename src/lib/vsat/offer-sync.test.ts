import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { letterInput, sendOfferNotices, type OfferNoticeConfig } from "./offer-sync";
import type { LetterInput } from "./offer-letter";
import type { OfferJob } from "./offers";

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

const job: OfferJob = {
  id: "ev-1", kind: "released", attempts: 1, sent_to: [], scholarship_pct: 40, released_at: "2026-11-23T10:00:00Z",
  expires_at: "2026-11-28T18:29:59Z", amount: "50000",
  student: { name: "Ravi <b>K</b>", email: "ravi@example.com", lead_id: "lead-1", application_no: "V-1", campus: "gurugram" },
};
const cfg = (over: Partial<OfferNoticeConfig> = {}, step: Partial<NonNullable<OfferNoticeConfig["step"]>> = {}): OfferNoticeConfig => ({
  master: true, testEmail: "qa@vedam.org",
  step: { step_key: "offer_released", title: "Offer released → student", enabled: true, test_mode: false, email_enabled: true,
          email_subject: "Your offer: {{scholarship}}%", email_body: "<p>Hi {{student_name}}, {{campus}}, ₹{{amount}} by {{deadline_date}}</p>", ...step },
  ...over,
});
const SITE = "https://one.vedam.org";

describe("sendOfferNotices", () => {
  it("emails the student and records it", async () => {
    const sent: Record<string, unknown>[] = [];
    const { db, calls } = fakeDb({ vsat_offer_notices_claim: [job], vsat_offer_notice_done: { updated: true } });
    const r = await sendOfferNotices(db, { site: SITE, ids: ["A1"] }, { config: cfg(), deliver: async (o) => { sent.push(o); return { ok: true }; } });
    expect(r).toEqual({ jobs: 1, sent: 1, failed: 0, off: 0 });
    expect(calls[0]).toEqual({ fn: "vsat_offer_notices_claim", args: { p: { limit: 20, application_ids: ["A1"] } } });
    expect(sent[0]).toMatchObject({ to: "ravi@example.com", subject: "Your offer: 40%", kind: "vsat_offer_released", userId: "lead-1", refId: "ev-1" });
    expect(String(sent[0].html)).toBe("<p>Hi Ravi &lt;b&gt;K&lt;/b&gt;, Gurugram, ₹50,000 by Sat, 28 Nov 2026</p>");
    expect(calls.at(-1)).toEqual({ fn: "vsat_offer_notice_done", args: { p: { id: "ev-1", status: "sent", detail: { sent_to: ["student"], test: false } } } });
  });
  it("comms master off, step off or no email → nothing sent, job closed as skipped", async () => {
    for (const c of [cfg({ master: false }), cfg({}, { enabled: false }), cfg({}, { email_enabled: false }), cfg({ step: null })]) {
      const { db, calls } = fakeDb({ vsat_offer_notices_claim: [job], vsat_offer_notice_done: { updated: true } });
      let n = 0;
      const r = await sendOfferNotices(db, { site: SITE }, { config: c, deliver: async () => { n++; return { ok: true }; } });
      expect(n).toBe(0);
      expect(r.off).toBe(1);
      expect((calls.at(-1)!.args.p as { status: string }).status).toBe("skipped");
    }
    const { db } = fakeDb({ vsat_offer_notices_claim: [{ ...job, student: { ...job.student, email: " " } }], vsat_offer_notice_done: {} });
    expect((await sendOfferNotices(db, { site: SITE }, { config: cfg(), deliver: async () => ({ ok: true }) })).off).toBe(1);
  });
  it("test mode → the comms test inbox, never the student, no user id", async () => {
    const sent: Record<string, unknown>[] = [];
    const { db, calls } = fakeDb({ vsat_offer_notices_claim: [job], vsat_offer_notice_done: {} });
    await sendOfferNotices(db, { site: SITE }, { config: cfg({}, { test_mode: true }), deliver: async (o) => { sent.push(o); return { ok: true }; } });
    expect(sent[0]).toMatchObject({ to: "qa@vedam.org", userId: null });
    expect((calls.at(-1)!.args.p as { detail: { test: boolean } }).detail.test).toBe(true);
  });
  it("delivery fails or throws → failed (the database retries it)", async () => {
    for (const deliver of [async () => ({ ok: false, error: "smtp" }), async () => { throw new Error("down"); }]) {
      const { db, calls } = fakeDb({ vsat_offer_notices_claim: [job], vsat_offer_notice_done: {} });
      const r = await sendOfferNotices(db, { site: SITE }, { config: cfg(), deliver });
      expect(r.failed).toBe(1);
      expect((calls.at(-1)!.args.p as { status: string }).status).toBe("failed");
    }
  });
  it("already delivered on an earlier try → not sent twice", async () => {
    let n = 0;
    const { db, calls } = fakeDb({ vsat_offer_notices_claim: [{ ...job, sent_to: ["student"] }], vsat_offer_notice_done: {} });
    await sendOfferNotices(db, { site: SITE }, { config: cfg(), deliver: async () => { n++; return { ok: true }; } });
    expect(n).toBe(0);
    expect((calls.at(-1)!.args.p as { status: string }).status).toBe("sent");
  });
  it("nothing queued → no config read, no calls after the claim", async () => {
    const { db, calls } = fakeDb({ vsat_offer_notices_claim: [] });
    expect(await sendOfferNotices(db, { site: SITE })).toEqual({ jobs: 0, sent: 0, failed: 0, off: 0 });
    expect(calls).toHaveLength(1);
  });
  it("claim error → throws (the cron reports it)", async () => {
    const { db } = fakeDb({ vsat_offer_notices_claim: new Error("boom") });
    await expect(sendOfferNotices(db, { site: SITE })).rejects.toThrow(/offer_notices_claim/);
  });
});

describe("sendOfferNotices · Acceptance Letter attached", () => {
  it("attaches the letter (PDF named after the student), drawn from the campus settings", async () => {
    const sent: Record<string, unknown>[] = [];
    const seen: LetterInput[] = [];
    const { db } = fakeDb({ vsat_offer_notices_claim: [job], vsat_offer_notice_done: {} });
    const config = { ...cfg(), campus: { gurugram: { programme_fee: "1800000", offer_days: 5 } } };
    await sendOfferNotices(db, { site: SITE }, { config, deliver: async (o) => { sent.push(o); return { ok: true }; }, letter: async (i) => { seen.push(i); return "UERGLQ==" } });
    expect(seen[0]).toEqual({ name: "Ravi <b>K</b>", campus: "gurugram", pct: 40, programmeFee: "1800000", seatBlock: "50000", days: 5, dashboardLink: "https://one.vedam.org/apply/dashboard" });
    expect(sent[0].attachments).toEqual([{ filename: "Acceptance_Letter_Ravi_b_K_b.pdf", content: "UERGLQ==", mimetype: "application/pdf" }]);
  });
  it("the real letter is a PDF (season fee when the settings have none)", async () => {
    const sent: Record<string, unknown>[] = [];
    const { db } = fakeDb({ vsat_offer_notices_claim: [job], vsat_offer_notice_done: {} });
    await sendOfferNotices(db, { site: SITE }, { config: cfg(), deliver: async (o) => { sent.push(o); return { ok: true }; } });
    const att = (sent[0].attachments as { content: string }[])[0];
    expect(Buffer.from(att.content, "base64").subarray(0, 5).toString()).toBe("%PDF-");
  }, 30_000);
  it("no campus → no email without its letter: failed, reason kept", async () => {
    let n = 0;
    const { db, calls } = fakeDb({ vsat_offer_notices_claim: [{ ...job, student: { ...job.student, campus: null } }], vsat_offer_notice_done: {} });
    const r = await sendOfferNotices(db, { site: SITE }, { config: cfg(), deliver: async () => { n++; return { ok: true }; } });
    expect(n).toBe(0);
    expect(r.failed).toBe(1);
    expect(calls.at(-1)!.args.p).toEqual({ id: "ev-1", status: "failed", detail: { sent_to: [], test: false, why: "letter_no_campus" } });
  });
  it("the letter cannot be drawn → not sent, failed (retried)", async () => {
    let n = 0;
    const { db, calls } = fakeDb({ vsat_offer_notices_claim: [job], vsat_offer_notice_done: {} });
    const r = await sendOfferNotices(db, { site: SITE }, { config: cfg(), deliver: async () => { n++; return { ok: true }; }, letter: async () => { throw new Error("font"); } });
    expect(n).toBe(0);
    expect(r.failed).toBe(1);
    expect((calls.at(-1)!.args.p as { detail: { why: string } }).detail.why).toBe("letter_failed");
  });
  it("letterInput: days from the release and deadline, else the campus days", () => {
    expect(letterInput(job, cfg(), SITE)?.days).toBe(5);
    expect(letterInput({ ...job, released_at: null }, { ...cfg(), campus: { gurugram: { programme_fee: null, offer_days: 2 } } }, SITE)).toMatchObject({ days: 2, programmeFee: 1800000 });
    expect(letterInput({ ...job, student: { ...job.student, name: "  " } }, cfg(), SITE)?.name).toBe("Student");
  });
});

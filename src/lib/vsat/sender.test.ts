import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { vsatSender } from "./sender";
import { sendOfferNotices, type OfferNoticeConfig } from "./offer-sync";
import { smtp2goSend } from "@/lib/email/smtp2go";
import type { OfferJob } from "./offers";

describe("vsatSender (Phase 7: VSAT emails from the admissions address)", () => {
  it("uses VSAT_SENDER_EMAIL when it is a plain email address", () => {
    expect(vsatSender({ VSAT_SENDER_EMAIL: "admissions@vedam.org" })).toEqual({ fromEmail: "admissions@vedam.org" });
    expect(vsatSender({ VSAT_SENDER_EMAIL: "  admissions@vedam.org " })).toEqual({ fromEmail: "admissions@vedam.org" });
  });
  it("not set, empty or not an address → today's sender (nothing passed)", () => {
    for (const v of [undefined, "", "   ", "admissions", "a@b", "Vedam <admissions@vedam.org>", "a@vedam.org,b@vedam.org", "x y@vedam.org"]) {
      expect(vsatSender({ VSAT_SENDER_EMAIL: v })).toEqual({});
    }
  });
});

describe("a VSAT email carries the VSAT sender", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  const job: OfferJob = {
    id: "ev-1", kind: "released", attempts: 1, sent_to: [], scholarship_pct: 40, released_at: "2026-11-23T10:00:00Z",
    expires_at: "2026-11-28T18:29:59Z", amount: "50000",
    student: { name: "Ravi", email: "ravi@example.com", lead_id: "lead-1", application_no: "V-1", campus: "pune" },
  };
  const cfg: OfferNoticeConfig = {
    master: true, testEmail: "qa@vedam.org",
    step: { step_key: "offer_released", title: "Offer released → student", enabled: true, test_mode: false, email_enabled: true,
            email_subject: "Offer", email_body: "<p>Hi</p>" },
  };
  const db = { rpc: async (fn: string) => ({ data: fn === "vsat_offer_notices_claim" ? [job] : { updated: true }, error: null }) } as unknown as SupabaseClient;

  it("offer email: fromEmail is the admissions address when set, absent when not", async () => {
    const sent: Record<string, unknown>[] = [];
    vi.stubEnv("VSAT_SENDER_EMAIL", "admissions@vedam.org");
    await sendOfferNotices(db, { site: "https://one.vedam.org" }, { config: cfg, deliver: async (o) => { sent.push(o); return { ok: true }; } });
    vi.stubEnv("VSAT_SENDER_EMAIL", "");
    await sendOfferNotices(db, { site: "https://one.vedam.org" }, { config: cfg, deliver: async (o) => { sent.push(o); return { ok: true }; } });
    expect(sent[0].fromEmail).toBe("admissions@vedam.org");
    expect("fromEmail" in sent[1]).toBe(false);
  });

  it("SMTP2GO sends from the given address, else from SMTP2GO_SENDER", async () => {
    vi.stubEnv("SMTP2GO_API_KEY", "test-key");
    vi.stubEnv("SMTP2GO_SENDER", "connect@vedam.org");
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ data: { succeeded: 1, email_id: "m-1" } }), { status: 200 });
    }));
    await smtp2goSend({ to: "s@example.com", subject: "s", html: "<p>x</p>", fromEmail: "admissions@vedam.org" });
    await smtp2goSend({ to: "s@example.com", subject: "s", html: "<p>x</p>" });
    expect(bodies[0].sender).toBe("Vedam School of Technology <admissions@vedam.org>");
    expect(bodies[1].sender).toBe("Vedam School of Technology <connect@vedam.org>");
  });
});

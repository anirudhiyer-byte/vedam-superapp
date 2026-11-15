import { describe, expect, it } from "vitest";
import { BOOK_CODES, parseBookResult, popupFor, withReturn } from "./booking-codes";
import { PEERPATH_LINKS } from "./constants";

const ID = "5011eb15-74e9-4f7b-8b5d-192ff8f14aef";
const ctx = { returnTo: "/peerpath/talk-to-senior/book?senior=abc&start=2026-11-03T04%3A30%3A00Z&type=1%3A1", seniorPath: "/peerpath/talk-to-senior/seniors/abc" };

describe("parseBookResult", () => {
  it("accepts a real OK with an id", () => {
    expect(parseBookResult({ ok: true, code: "OK", id: ID })).toEqual({ ok: true, code: "OK", id: ID });
  });
  it("keeps every known failure code", () => {
    for (const code of BOOK_CODES.filter((c) => c !== "OK")) {
      expect(parseBookResult({ ok: false, code })).toEqual({ ok: false, code });
    }
  });
  it("turns anything unexpected into SERVER (never trusts odd shapes)", () => {
    for (const bad of [null, undefined, "OK", 42, [], {}, { ok: true }, { ok: true, code: "OK" }, { ok: true, code: "OK", id: "not-a-uuid" },
      { ok: false }, { ok: false, code: "DROP TABLE" }, { ok: false, code: 123 }, { ok: "yes", code: "OK", id: ID }]) {
      expect(parseBookResult(bad)).toEqual({ ok: false, code: "SERVER" });
    }
  });
  it("an OK code with ok:false is a failure, not a booking", () => {
    expect(parseBookResult({ ok: false, code: "OK", id: ID })).toEqual({ ok: false, code: "SERVER" });
  });
});

describe("withReturn (return URL so the user comes back to the same senior and time)", () => {
  it("adds the return path as ?next=", () => {
    const href = withReturn("/apply", ctx.returnTo);
    const u = new URL(href, "https://x.invalid");
    expect(u.pathname).toBe("/apply");
    expect(u.searchParams.get("next")).toBe(ctx.returnTo);
  });
  it("keeps an existing query on the base link", () => {
    const u = new URL(withReturn("/apply?src=peerpath", "/peerpath"), "https://x.invalid");
    expect(u.searchParams.get("src")).toBe("peerpath");
    expect(u.searchParams.get("next")).toBe("/peerpath");
  });
  it("drops return paths that leave the site", () => {
    for (const bad of ["https://evil.example", "//evil.example/x", "/\\evil.example", "javascript:alert(1)", "", "peerpath"]) {
      expect(new URL(withReturn("/apply", bad), "https://x.invalid").searchParams.get("next")).toBeNull();
    }
  });
});

describe("popupFor — every failure code has a plain message and no raw error", () => {
  it("case 2: PAYMENT_PENDING -> 'Payment not completed' + Complete payment (config link, with return)", () => {
    const p = popupFor("PAYMENT_PENDING", ctx);
    expect(p.title).toBe("Payment not completed");
    expect(p.action?.label).toBe("Complete payment");
    const u = new URL(p.action!.href, "https://x.invalid");
    expect(u.pathname).toBe(PEERPATH_LINKS.completePayment);
    expect(u.searchParams.get("next")).toBe(ctx.returnTo);
  });
  it("case 3: NOT_REGISTERED -> 'Not registered for VSAT' + Register now (with return)", () => {
    const p = popupFor("NOT_REGISTERED", ctx);
    expect(p.title).toBe("Not registered for VSAT");
    expect(p.action?.label).toBe("Register now");
    const u = new URL(p.action!.href, "https://x.invalid");
    expect(u.pathname).toBe(PEERPATH_LINKS.register);
    expect(u.searchParams.get("next")).toBe(ctx.returnTo);
  });
  it("EMAIL_NOT_VERIFIED -> verify the email inside the popup (no link away, so no loop)", () => {
    const p = popupFor("EMAIL_NOT_VERIFIED", ctx);
    expect(p.title).toBe("Verify your email");
    expect(p.verifyEmail).toBe(true);
    expect(p.action).toBeUndefined();
  });
  it("EMAIL_MISSING (0036: no email on the application) -> add an email inside the popup, never 'Verify your email'", () => {
    expect((BOOK_CODES as readonly string[]).includes("EMAIL_MISSING")).toBe(true);
    const p = popupFor("EMAIL_MISSING", ctx);
    expect(p.title).toBe("Add your email");
    expect(p.title).not.toMatch(/verify/i);
    expect(p.verifyEmail).toBe(true);
    expect(p.action).toBeUndefined();
  });
  it("EMAIL_MISSING from the database reaches the UI (not turned into SERVER)", () => {
    expect(parseBookResult({ ok: false, code: "EMAIL_MISSING" })).toEqual({ ok: false, code: "EMAIL_MISSING" });
  });
  it("PHONE_MISSING is gone (phone is optional since 0035)", () => {
    expect((BOOK_CODES as readonly string[]).includes("PHONE_MISSING")).toBe(false);
  });
  it("SLOT_UNAVAILABLE -> back to this senior's free times", () => {
    expect(popupFor("SLOT_UNAVAILABLE", ctx).action?.href).toBe(ctx.seniorPath);
  });
  it("NOT_LOGGED_IN -> log in and come back", () => {
    const u = new URL(popupFor("NOT_LOGGED_IN", ctx).action!.href, "https://x.invalid");
    expect(u.pathname).toBe(PEERPATH_LINKS.login);
    expect(u.searchParams.get("next")).toBe(ctx.returnTo);
  });
  it("BOOKING_CLOSED, RATE_LIMITED, LIMIT_REACHED, RESCHEDULE_CLOSED, INVALID, SERVER, FORBIDDEN all have text", () => {
    for (const c of ["BOOKING_CLOSED", "RATE_LIMITED", "LIMIT_REACHED", "RESCHEDULE_CLOSED", "INVALID", "SERVER", "FORBIDDEN"] as const) {
      const p = popupFor(c, ctx);
      expect(p.title.length).toBeGreaterThan(3);
      expect(p.body.length).toBeGreaterThan(10);
      expect(JSON.stringify(p)).not.toMatch(/sqlstate|exception|violates|PGRST|relation/i);
    }
  });
  it("BOOKING_CLOSED offers no booking action", () => {
    expect(popupFor("BOOKING_CLOSED", ctx).action).toBeUndefined();
  });
});

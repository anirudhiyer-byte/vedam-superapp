import { describe, expect, it } from "vitest";
import { afterSend, afterVerify, cleanCode, cleanEmail, sendCodeError, verifyCodeError } from "./verify-email";

describe("afterSend — what updateUser({ email }) did", () => {
  it("already the verified login email -> done (no code)", () => {
    expect(afterSend({ email: "a@x.com", email_confirmed_at: "2026-10-30T00:00:00Z" }, "a@x.com")).toBe("done");
  });
  it("already the login email but never confirmed -> ask for a fresh confirmation code (Auth sends nothing for it)", () => {
    expect(afterSend({ email: "A@x.com ", email_confirmed_at: null }, "a@x.com")).toBe("resend_signup");
  });
  it("a new address (phone-only login, or a different email) -> email-change code sent", () => {
    expect(afterSend({ email: null, new_email: "a@x.com" }, "a@x.com")).toBe("code_sent");
    expect(afterSend({ email: "old@x.com", new_email: "a@x.com" }, "a@x.com")).toBe("code_sent");
  });
});

describe("afterVerify — only 'done' when the login email really is verified", () => {
  it("login email is now this address and verified -> done", () => {
    expect(afterVerify({ email: "a@x.com", email_confirmed_at: "2026-10-30T00:00:00Z" }, "a@x.com")).toBe("done");
  });
  it("secure email change: new address accepted, current one still pending -> confirm_current", () => {
    expect(afterVerify({ email: "old@x.com", new_email: "a@x.com", email_confirmed_at: "2026-01-01T00:00:00Z" }, "a@x.com")).toBe("confirm_current");
  });
  it("email changed but not verified, or no user -> retry (never a fake success)", () => {
    expect(afterVerify({ email: "a@x.com", email_confirmed_at: null }, "a@x.com")).toBe("retry");
    expect(afterVerify(null, "a@x.com")).toBe("retry");
  });
});

describe("cleanEmail", () => {
  it("trims and lower-cases a valid email", () => {
    expect(cleanEmail("  Student@Example.COM ")).toBe("student@example.com");
  });
  it("refuses anything that is not one plain email", () => {
    for (const bad of ["", "   ", "student", "a@b", "a b@c.com", "a@b.com, c@d.com", "x".repeat(250) + "@a.com", "<script>@a.com"]) {
      expect(cleanEmail(bad)).toBeNull();
    }
  });
});

describe("cleanCode", () => {
  it("keeps only digits (people paste '123 456')", () => {
    expect(cleanCode(" 123 456 ")).toBe("123456");
  });
  it("needs 6 to 10 digits", () => {
    expect(cleanCode("12345")).toBeNull();
    expect(cleanCode("12345678901")).toBeNull();
    expect(cleanCode("abcdef")).toBeNull();
  });
});

describe("sendCodeError — never shows the raw Supabase message", () => {
  it("email used by another account", () => {
    expect(sendCodeError({ code: "email_exists", message: "x" })).toMatch(/another account/);
    expect(sendCodeError({ message: "A user with this email address has already been registered" })).toMatch(/another account/);
  });
  it("too many codes", () => {
    expect(sendCodeError({ status: 429, message: "x" })).toMatch(/wait/);
    expect(sendCodeError({ code: "over_email_send_rate_limit", message: "x" })).toMatch(/wait/);
    expect(sendCodeError({ message: "For security purposes, you can only request this after 42 seconds." })).toMatch(/wait/);
  });
  it("bad address", () => {
    expect(sendCodeError({ code: "email_address_invalid", message: "x" })).toMatch(/valid email/);
  });
  it("anything else is generic and leaks nothing", () => {
    const m = sendCodeError({ message: 'relation "auth.users" does not exist' });
    expect(m).not.toMatch(/relation|auth\.users/);
    expect(m).toMatch(/couldn't send/);
  });
});

describe("verifyCodeError", () => {
  it("wrong or expired code", () => {
    expect(verifyCodeError({ code: "otp_expired", message: "x" })).toMatch(/wrong or has expired/);
    expect(verifyCodeError({ message: "Token has expired or is invalid" })).toMatch(/wrong or has expired/);
  });
  it("too many tries", () => {
    expect(verifyCodeError({ status: 429, message: "x" })).toMatch(/wait/);
  });
  it("anything else is generic", () => {
    expect(verifyCodeError({ message: "internal: pq something" })).not.toMatch(/pq/);
  });
});

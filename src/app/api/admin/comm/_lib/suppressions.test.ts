/** Suppressions (Slice 2) · schema + normalising helpers (pure). Fake data only. */
import { describe, expect, it } from "vitest";
import { addBody, isValidEmail, isValidMobile, phone91, removeBody } from "./suppressions";

describe("phone91 (same rule as comm__phone91 in the database)", () => {
  it.each([
    ["+91 90000 00301", "919000000301"], ["09000000301", "919000000301"], ["9000000301", "919000000301"],
    ["919000000301", "919000000301"], ["+91 (900) 000-0301", "919000000301"],
  ])("%s → %s", (input, out) => expect(phone91(input)).toBe(out));
  it.each(["12345", "5000000301", "+1 202 555 0100", "9000000301900000030", ""])("%s → null", (input) => expect(phone91(input)).toBeNull());
});

describe("contact checks", () => {
  it("e-mail: trims and lower-cases before checking", () => {
    expect(isValidEmail("  ZZ-S2@Example.INVALID  ")).toBe(true);
    for (const bad of ["zz.example.invalid", "zz two@example.invalid", "zz@two@example.invalid", "zz-a@example", "a,b@example.invalid", `${"a".repeat(250)}@x.in`, "zz\t@example.invalid"]) {
      expect(isValidEmail(bad), bad).toBe(false);
    }
  });
  it("mobile: only digits, spaces, + ( ) - and an Indian mobile in the end", () => {
    expect(isValidMobile("+91 90000 00301")).toBe(true);
    for (const bad of ["98abc76543", "12345", "+1 202 555 0100", "9000000301\n"]) expect(isValidMobile(bad), JSON.stringify(bad)).toBe(false);
  });
});

describe("addBody / removeBody", () => {
  const ADD = { channel: "Email", contact: "zz-s2@example.invalid", category: "Spam" };
  it("accepts one contact with an optional note up to 200 characters", () => {
    expect(addBody.safeParse(ADD).success).toBe(true);
    expect(addBody.safeParse({ ...ADD, note: "n".repeat(200) }).success).toBe(true);
    expect(addBody.safeParse({ ...ADD, note: "n".repeat(201) }).success).toBe(false);
  });
  it("WhatsApp only takes the opt-out list (Unsubscribe)", () => {
    expect(addBody.safeParse({ channel: "WhatsApp", contact: "9000000301", category: "Unsubscribe" }).success).toBe(true);
    expect(addBody.safeParse({ channel: "WhatsApp", contact: "9000000301", category: "Bounce" }).success).toBe(false);
  });
  it("refuses unknown keys and arrays", () => {
    expect(addBody.safeParse({ ...ADD, id: "x" }).success).toBe(false);
    expect(addBody.safeParse({ ...ADD, contact: ["zz-s2@example.invalid"] }).success).toBe(false);
  });
  it("remove reason: 10–200 characters after trimming, no control characters, nothing else", () => {
    expect(removeBody.safeParse({ reason: "ZZ added by mistake" }).success).toBe(true);
    expect(removeBody.safeParse({ reason: "  short  " }).success).toBe(false);
    expect(removeBody.safeParse({ reason: "ZZ added by\nmistake" }).success).toBe(false);
    expect(removeBody.safeParse({ reason: "ZZ added by mistake", id: "x" }).success).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { BOOK_FIELDS, MAX_BODY_BYTES, bearerToken, pickBookFields, readJsonObject, sameOrigin } from "./book-request";

const req = (body: string, headers: Record<string, string> = {}) =>
  new Request("https://staging.example/api/peerpath/book", { method: "POST", body, headers: { host: "staging.example", ...headers } });

describe("sameOrigin (CSRF guard for cookie requests)", () => {
  it("allows the site's own origin", () => {
    expect(sameOrigin(req("{}", { origin: "https://staging.example" }))).toBe(true);
  });
  it("blocks other sites, missing origin and garbage", () => {
    expect(sameOrigin(req("{}", { origin: "https://evil.example" }))).toBe(false);
    expect(sameOrigin(req("{}", { origin: "https://staging.example.evil.example" }))).toBe(false);
    expect(sameOrigin(req("{}"))).toBe(false);
    expect(sameOrigin(req("{}", { origin: "null" }))).toBe(false);
    expect(sameOrigin(req("{}", { origin: "not a url" }))).toBe(false);
  });
});

describe("bearerToken", () => {
  it("reads a Bearer token", () => {
    expect(bearerToken(req("{}", { authorization: "Bearer abc.def.ghi" }))).toBe("abc.def.ghi");
  });
  it("ignores other schemes and empty values", () => {
    expect(bearerToken(req("{}", { authorization: "Basic abc" }))).toBeNull();
    expect(bearerToken(req("{}", { authorization: "Bearer " }))).toBeNull();
    expect(bearerToken(req("{}"))).toBeNull();
  });
});

describe("readJsonObject", () => {
  it("returns a plain object", async () => {
    expect(await readJsonObject(req('{"a":1}'))).toEqual({ a: 1 });
  });
  it("rejects malformed, non-object and oversized bodies", async () => {
    for (const b of ["", "{", "null", "[]", '"x"', "42", "true"]) expect(await readJsonObject(req(b))).toBeNull();
    expect(await readJsonObject(req(JSON.stringify({ pad: "y".repeat(MAX_BODY_BYTES) })))).toBeNull();
  });
});

describe("pickBookFields — nothing but the booking fields reaches the database", () => {
  it("keeps only seniorId, start, type, duration, question, rescheduleOf", () => {
    const out = pickBookFields({
      seniorId: "s", start: "t", type: "1:1", duration: 30, question: "q", rescheduleOf: null,
      email: "attacker@example.invalid", phone: "+919999999999", name: "x", payment_stage_1: "payment_approved",
      vsat_paid_at: "2026-01-01", status: "completed", applicant_user_id: "u", __proto__: { admin: true },
    });
    expect(Object.keys(out).sort()).toEqual([...BOOK_FIELDS].sort());
    expect(out).not.toHaveProperty("email");
    expect(out).not.toHaveProperty("payment_stage_1");
    expect(out).not.toHaveProperty("vsat_paid_at");
  });
  it("leaves missing fields out instead of inventing them", () => {
    expect(pickBookFields({ seniorId: "s" })).toEqual({ seniorId: "s" });
  });
});

import { describe, it, expect } from "vitest";
import { elevateSignature, elevateHeaders } from "./sign";
import { nextRetry, stateForOutcome, classifyHttp, BACKOFF_MS } from "./outbox";
import { isElevateStatus, CAMPUS_STATUSES } from "./statuses";

describe("elevate signature", () => {
  // Known-answer vector (computed with node crypto) — guards the algorithm against regressions.
  // NB: the integration guide's own worked-example hash is illustrative and does not
  // reproduce from its printed body, so real end-to-end verification is done against
  // Elevate's test-mode endpoint, not that vector.
  it("matches a fixed HMAC-SHA256(secret, `ts.body`) vector", () => {
    const body = '{"event_id":"e1","status":"Lead"}';
    expect(elevateSignature("vedam-test", "1700000000", body)).toBe(
      "a58b7fc53992a1bc0bfbc403ddd1a7f51d0e9731113559dd51763a645dcecdd4",
    );
  });

  it("builds headers that re-verify with the same algorithm", () => {
    const body = '{"event_id":"e2","status":"Form Paid"}';
    const h = elevateHeaders("sek", body, 1_700_000_000_000); // pinned clock → ts 1700000000
    expect(h["x-elevate-timestamp"]).toBe("1700000000");
    expect(h["x-elevate-signature"]).toBe(elevateSignature("sek", "1700000000", body));
    expect(h["content-type"]).toBe("application/json");
  });

  it("timestamp is unix SECONDS, not millis", () => {
    const h = elevateHeaders("s", "{}", 1_700_000_000_000);
    expect(h["x-elevate-timestamp"]).toBe("1700000000");
  });
});

describe("outbox retry/backoff", () => {
  it("follows the 1m/5m/30m/2h schedule then dies", () => {
    expect(nextRetry(0)).toEqual({ dead: false, delayMs: 60_000 });
    expect(nextRetry(1)).toEqual({ dead: false, delayMs: 300_000 });
    expect(nextRetry(2)).toEqual({ dead: false, delayMs: 1_800_000 });
    expect(nextRetry(3)).toEqual({ dead: false, delayMs: 7_200_000 });
    expect(nextRetry(4)).toEqual({ dead: true, delayMs: 0 });
    expect(BACKOFF_MS.length).toBe(4);
  });
});

describe("outcome → state", () => {
  it("treats applied/quiet/duplicate/older/older_step/ignored/test as sent", () => {
    for (const o of ["applied", "quiet", "duplicate", "older", "older_step", "ignored", "test"])
      expect(stateForOutcome(o)).toBe("sent");
  });
  it("keeps held and rejected distinct and non-retrying", () => {
    expect(stateForOutcome("held")).toBe("held");
    expect(stateForOutcome("rejected")).toBe("rejected");
  });
});

describe("http classification", () => {
  it("200 ok, 5xx retry, 4xx fatal", () => {
    expect(classifyHttp(200)).toBe("ok");
    expect(classifyHttp(503)).toBe("retry");
    expect(classifyHttp(500)).toBe("retry");
    expect(classifyHttp(400)).toBe("fatal");
    expect(classifyHttp(401)).toBe("fatal");
    expect(classifyHttp(404)).toBe("fatal");
    expect(classifyHttp(413)).toBe("fatal");
  });
});

describe("statuses", () => {
  it("validates the 17 statuses and campus set", () => {
    expect(isElevateStatus("Form Paid")).toBe(true);
    expect(isElevateStatus("Nope")).toBe(false);
    expect(CAMPUS_STATUSES.has("Seat Booked")).toBe(true);
    expect(CAMPUS_STATUSES.has("Lead")).toBe(false);
  });
});

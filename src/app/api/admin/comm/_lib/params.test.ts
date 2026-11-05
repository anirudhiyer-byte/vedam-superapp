import { describe, expect, it } from "vitest";
import {
  addDays, istToday, logsQuery, parseQuery, recipientsQuery, suppressionsQuery, toRange, idParam,
} from "./params";

const url = (qs: string) => new URL(`https://staging.example/api/admin/comm/x${qs ? `?${qs}` : ""}`);
const NOW = new Date("2026-11-05T06:30:00Z"); // 12:00 IST

describe("istToday / addDays", () => {
  it("uses the India date, not the UTC date", () => {
    expect(istToday(new Date("2026-11-04T19:00:00Z"))).toBe("2026-11-05"); // 00:30 IST next day
    expect(istToday(NOW)).toBe("2026-11-05");
  });
  it("adds days across month and year ends", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("toRange", () => {
  it("normal: a 7-day range becomes [from 00:00 IST, day after to 00:00 IST)", () => {
    expect(toRange("2026-10-01", "2026-10-07")).toEqual({ ok: true, from: "2026-10-01T00:00:00+05:30", to: "2026-10-08T00:00:00+05:30" });
  });
  it("edge: exactly 90 days is allowed, 91 is refused", () => {
    expect(toRange("2026-08-08", "2026-11-05").ok).toBe(true);
    expect(toRange("2026-08-07", "2026-11-05")).toEqual({ ok: false, code: "RANGE_TOO_LONG" });
  });
  it("edge: one day (from = to) is allowed", () => {
    expect(toRange("2026-10-01", "2026-10-01")).toEqual({ ok: true, from: "2026-10-01T00:00:00+05:30", to: "2026-10-02T00:00:00+05:30" });
  });
  it("no dates: default last 90 days when asked, otherwise no range", () => {
    expect(toRange(undefined, undefined, { defaultDays: 90, now: NOW })).toEqual({ ok: true, from: "2026-08-08T00:00:00+05:30", to: "2026-11-06T00:00:00+05:30" });
    expect(toRange(undefined, undefined)).toEqual({ ok: true, from: null, to: null });
  });
  it("invalid: only one side, reversed, or impossible dates", () => {
    expect(toRange("2026-10-01", undefined)).toEqual({ ok: false, code: "INVALID" });
    expect(toRange(undefined, "2026-10-01")).toEqual({ ok: false, code: "INVALID" });
    expect(toRange("2026-10-07", "2026-10-01")).toEqual({ ok: false, code: "INVALID" });
    expect(toRange("2026-02-30", "2026-03-01")).toEqual({ ok: false, code: "INVALID" });
  });
});

describe("parseQuery", () => {
  it("normal: accepts known keys and turns page/size into numbers", () => {
    const r = parseQuery(url("from=2026-10-01&to=2026-10-07&channel=email&page=2&size=25&sort=targeted&dir=asc"), logsQuery);
    expect(r).toEqual({ ok: true, data: { from: "2026-10-01", to: "2026-10-07", channel: "email", page: 2, size: 25, sort: "targeted", dir: "asc" } });
  });
  it("normal: no query string is fine", () => {
    expect(parseQuery(url(""), logsQuery)).toEqual({ ok: true, data: {} });
  });
  it("invalid: unknown keys are refused (no silent ignoring)", () => {
    expect(parseQuery(url("created_by=x"), logsQuery).ok).toBe(false);
    expect(parseQuery(url("p_size=1000"), logsQuery).ok).toBe(false);
  });
  it("invalid: the same key twice is refused", () => {
    expect(parseQuery(url("channel=email&channel=whatsapp"), logsQuery).ok).toBe(false);
  });
  it("invalid: page size over 100, page 0, non-numbers, decimals, exponent forms", () => {
    for (const qs of ["size=101", "size=0", "page=0", "page=10001", "size=abc", "size=10.5", "size=1e2", "size=-5", "size=%2010"]) {
      expect(parseQuery(url(qs), logsQuery).ok, qs).toBe(false);
    }
  });
  it("invalid: bad enum values and too-long text", () => {
    for (const qs of ["channel=sms", "status=Deleted", "dir=sideways", "sort=created_by", `search=${"a".repeat(101)}`, "from=01-10-2026", "search="]) {
      expect(parseQuery(url(qs), logsQuery).ok, qs).toBe(false);
    }
  });
  it("suppressions: channel is required", () => {
    expect(parseQuery(url(""), suppressionsQuery).ok).toBe(false);
    expect(parseQuery(url("channel=Email&reason=Bounce"), suppressionsQuery).ok).toBe(true);
    expect(parseQuery(url("channel=Fax"), suppressionsQuery).ok).toBe(false);
  });
  it("recipients: only Sent/Delivered/Read/Clicked/Failed", () => {
    expect(parseQuery(url("status=Read"), recipientsQuery).ok).toBe(true);
    expect(parseQuery(url("status=Opened"), recipientsQuery).ok).toBe(false);
  });
});

describe("idParam", () => {
  it("accepts a uuid and refuses anything else", () => {
    expect(idParam.safeParse("5011eb15-74e9-4f7b-8b5d-192ff8f14aef").success).toBe(true);
    for (const v of ["1", "' or 1=1 --", "5011eb15-74e9-4f7b-8b5d-192ff8f14aef;drop", ""]) expect(idParam.safeParse(v).success).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { awardedPct, counsellingPayload, type CounsellingFormInput } from "./counselling-form";
import { adjustment, feedbackLabel, modeLabel, pct, rupees, rupeesShort, share } from "./counselling-evaluation";

const blank: CounsellingFormInput = { feedback: "", parentPresent: "", connected: "", heardFrom: "", remarks: "", adjust: "", adjustReason: "" };

describe("counselling form → request (0184)", () => {
  it("an old-style form (remarks only) sends only what it always sent", () => {
    const r = counsellingPayload("APP-1", { ...blank, remarks: "  zz ok  " });
    expect(r).toEqual({ ok: true, adjust: 0, payload: { application_id: "APP-1", remarks: "zz ok" } });
  });
  it("the sheet's answers go under the keys the database accepts", () => {
    const r = counsellingPayload("APP-1", { ...blank, feedback: "likely", parentPresent: "mother", connected: "yes", heardFrom: " Referral ", adjust: "+5", adjustReason: " Strong projects " });
    expect(r).toEqual({ ok: true, adjust: 5, payload: {
      application_id: "APP-1", feedback: "likely", parent_present: "mother", connected_students: true, heard_from: "Referral",
      adjust_pct: 5, adjust_reason: "Strong projects",
    } });
  });
  it("Offline Form Filled (0186): yes / no go as true / false; blank is left out", () => {
    const yes = counsellingPayload("APP-1", { ...blank, offlineForm: "yes" });
    expect(yes.ok && yes.payload.offline_form_filled).toBe(true);
    const no = counsellingPayload("APP-1", { ...blank, offlineForm: "no" });
    expect(no.ok && no.payload.offline_form_filled).toBe(false);
    const none = counsellingPayload("APP-1", { ...blank, offlineForm: "" });
    expect(none.ok && "offline_form_filled" in none.payload).toBe(false);
  });
  it("connected = no is sent as false (not left out)", () => {
    const r = counsellingPayload("APP-1", { ...blank, connected: "no" });
    expect(r.ok && r.payload.connected_students).toBe(false);
  });
  it("adjustment: whole numbers −5 … +5 only", () => {
    for (const bad of ["6", "-6", "2.5", "abc", "1e1"]) expect(counsellingPayload("A", { ...blank, adjust: bad, adjustReason: "x" }).ok).toBe(false);
    for (const good of ["-5", "0", "5", " 3 "]) expect(counsellingPayload("A", { ...blank, adjust: good, adjustReason: "x" }).ok).toBe(true);
  });
  it("any adjustment other than 0 needs a reason; 0 sends no adjustment at all", () => {
    expect(counsellingPayload("A", { ...blank, adjust: "-2" })).toMatchObject({ ok: false });
    const zero = counsellingPayload("A", { ...blank, adjust: "0", adjustReason: "ignored" });
    expect(zero.ok && "adjust_pct" in zero.payload).toBe(false);
  });
  it("a value outside the lists is refused before it reaches the database", () => {
    expect(counsellingPayload("A", { ...blank, feedback: "maybe" }).ok).toBe(false);
    expect(counsellingPayload("A", { ...blank, parentPresent: "uncle" }).ok).toBe(false);
    expect(counsellingPayload("A", { ...blank, heardFrom: "x".repeat(301) }).ok).toBe(false);
  });
  it("the awarded % shown = formula + adjustment, kept within 0–100", () => {
    expect(awardedPct(30, 5)).toBe(35);
    expect(awardedPct(2, -5)).toBe(0);
    expect(awardedPct(98, 5)).toBe(100);
    expect(awardedPct(null, 3)).toBeNull();
  });
});

describe("Counselling Evaluation formatting (0184)", () => {
  it("rupees: whole, Indian grouping; short form in lakh", () => {
    expect(rupees(1202500)).toBe("₹12,02,500");
    expect(rupees(null)).toBe("—");
    expect(rupeesShort(1433750)).toBe("₹14.34 L");
    expect(rupeesShort(1800000)).toBe("₹18 L");
    expect(rupeesShort(92500)).toBe("₹92,500");
  });
  it("percent and share", () => {
    expect(pct(32.5)).toBe("32.5%");
    expect(pct(null)).toBe("—");
    expect(share(1, 3)).toBe("33%");
    expect(share(0, 0)).toBe("—");
  });
  it("labels: mode and feedback, with the empty case named", () => {
    expect(modeLabel("online")).toBe("Online");
    expect(modeLabel(null)).toBe("Not chosen");
    expect(feedbackLabel("may_or_may_not")).toBe("May or may not");
    expect(feedbackLabel(null)).toBe("Not given");
  });
  it("the counsellor's adjustment shows as a signed difference", () => {
    expect(adjustment({ calculated_pct: 30, awarded_pct: 35 })).toBe("+5");
    expect(adjustment({ calculated_pct: 30, awarded_pct: 28 })).toBe("−2");
    expect(adjustment({ calculated_pct: 30, awarded_pct: 30 })).toBe("");
    expect(adjustment({ calculated_pct: null, awarded_pct: 30 })).toBe("");
  });
});

describe("counselling setup checks (0184)", async () => {
  const { offlineDateText, zoomLinkProblem } = await import("./counselling-setup");
  it("Zoom link: same rule as the database", () => {
    expect(zoomLinkProblem("https://us06web.zoom.us/j/87616210964?pwd=abc.1")).toBeNull();
    expect(zoomLinkProblem("https://zoom.us/j/1")).toBeNull();
    expect(zoomLinkProblem("http://us06web.zoom.us/j/1")).not.toBeNull();
    expect(zoomLinkProblem("https://meet.google.com/abc-defg-hij")).not.toBeNull();
    expect(zoomLinkProblem("https://evilzoom.us/j/1")).not.toBeNull();
    expect(zoomLinkProblem("https://zoom.us.evil.com/j/1")).not.toBeNull();
    expect(zoomLinkProblem("https://zoom.us/j/1 x")).not.toBeNull();
    expect(zoomLinkProblem("")).not.toBeNull();
  });
  it("offline date: the email's words", () => {
    expect(offlineDateText("2026-11-28")).toBe("Sat, 28 Nov 2026");
    expect(offlineDateText("bad")).toBe("bad");
  });
});

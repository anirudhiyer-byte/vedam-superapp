import { describe, expect, it } from "vitest";
import { buildCampaignPayload, fmtNum, type CampaignForm } from "./campaigns";

const base: CampaignForm = {
  name: "  VSAT-12 ", campaign_start: "2026-05-01", campaign_end: "2026-05-12", last_date_to_apply: "",
  application_target: "", budget: "", planned_l2p: "", planned_cpp: "", metadata: "",
};

describe("buildCampaignPayload", () => {
  it("trims, defaults target and budget to 0, turns empty optionals into null, empty JSON into {}", () => {
    const r = buildCampaignPayload(base);
    expect(r).toEqual({ ok: true, payload: {
      name: "VSAT-12", campaign_start: "2026-05-01", campaign_end: "2026-05-12", last_date_to_apply: null,
      application_target: "0", budget: "0", planned_l2p: null, planned_cpp: null, metadata: {},
    } });
  });
  it("keeps filled values and the id", () => {
    const r = buildCampaignPayload({ ...base, last_date_to_apply: "2026-05-15", application_target: "400", budget: "500000", planned_l2p: "12.5", planned_cpp: "8000",
      metadata: '{"filters":{"campus_preference":"ADYPU Pune"}}' }, "abc");
    expect(r.ok && r.payload).toMatchObject({ id: "abc", last_date_to_apply: "2026-05-15", application_target: "400", planned_l2p: "12.5", planned_cpp: "8000",
      metadata: { filters: { campus_preference: "ADYPU Pune" } } });
  });
  it("does not add an id on create", () => {
    const r = buildCampaignPayload(base);
    expect(r.ok && "id" in r.payload).toBe(false);
  });
  it("rejects invalid JSON with the CRM sentence", () => {
    expect(buildCampaignPayload({ ...base, metadata: "{abc" })).toEqual({ ok: false, error: "Custom fields JSON is invalid" });
  });
  it.each(["[1,2]", '"text"', "null", "5", "true"])("rejects JSON that is not an object (%s)", (m) => {
    const r = buildCampaignPayload({ ...base, metadata: m });
    expect(r.ok).toBe(false);
  });
  it("whitespace-only optional fields count as empty", () => {
    const r = buildCampaignPayload({ ...base, planned_l2p: "   ", planned_cpp: " ", last_date_to_apply: "  ", metadata: "   " });
    expect(r.ok && r.payload).toMatchObject({ planned_l2p: null, planned_cpp: null, last_date_to_apply: null, metadata: {} });
  });
  it("passes <script> text through as plain data (the screen renders it as text)", () => {
    const r = buildCampaignPayload({ ...base, name: "<script>alert(1)</script>" });
    expect(r.ok && r.payload.name).toBe("<script>alert(1)</script>");
  });
  it("sends only known keys", () => {
    const r = buildCampaignPayload(base);
    expect(r.ok && Object.keys(r.payload).sort()).toEqual(
      ["application_target", "budget", "campaign_end", "campaign_start", "last_date_to_apply", "metadata", "name", "planned_cpp", "planned_l2p"]);
  });
  it("never sends an exam date (the form has no such field; the database keeps a stored one on edit)", () => {
    const created = buildCampaignPayload(base);
    const edited = buildCampaignPayload(base, "abc");
    expect(created.ok && "exam_date" in created.payload).toBe(false);
    expect(edited.ok && "exam_date" in edited.payload).toBe(false);
  });
});

describe("fmtNum", () => {
  it("groups thousands like the CRM", () => { expect(fmtNum(1200000)).toBe("1,200,000"); expect(fmtNum(0)).toBe("0"); });
  it("handles null, undefined, text and NaN", () => { expect(fmtNum(null)).toBe("0"); expect(fmtNum(undefined)).toBe("0"); expect(fmtNum("abc")).toBe("0"); expect(fmtNum(NaN)).toBe("0"); });
  it("keeps decimals", () => { expect(fmtNum(8000.5)).toBe("8,000.5"); });
});

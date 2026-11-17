import { describe, it, expect } from "vitest";
import { utmForLead } from "./utm";

describe("utmForLead", () => {
  it("passes through a real UTM source", () => {
    expect(utmForLead({ utm_source: "google", utm_medium: "cpc", utm_campaign: "vsat2027" }))
      .toEqual({ utm_source: "google", utm_medium: "cpc", utm_campaign: "vsat2027" });
  });
  it("no referrer → direct", () => {
    expect(utmForLead({})).toEqual({ utm_source: "direct", utm_medium: "none" });
  });
  it("search engine referrer → organic", () => {
    expect(utmForLead({ referrer: "https://www.google.com/search?q=vedam" }))
      .toEqual({ utm_source: "google", utm_medium: "organic" });
  });
  it("social referrer → social", () => {
    expect(utmForLead({ referrer: "https://l.instagram.com/" }))
      .toEqual({ utm_source: "instagram", utm_medium: "social" });
  });
  it("own domain referrer → direct (internal)", () => {
    expect(utmForLead({ referrer: "https://vedam.org/pyq" }))
      .toEqual({ utm_source: "direct", utm_medium: "none" });
  });
  it("other external referrer → referral with the host", () => {
    expect(utmForLead({ referrer: "https://news.ycombinator.com/item?id=1" }))
      .toEqual({ utm_source: "news.ycombinator.com", utm_medium: "referral" });
  });
});

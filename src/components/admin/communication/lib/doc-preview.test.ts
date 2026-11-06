import { describe, expect, it } from "vitest";
import { PREVIEW_CSP, PREVIEW_SANDBOX, buildPreviewDoc, escapeHtml, fillSample, sampleValues } from "./doc-preview";

const NOW = new Date("2026-11-06T06:30:00Z");

describe("preview document", () => {
  it("sandbox is empty: no allow-scripts, no allow-same-origin", () => {
    expect(PREVIEW_SANDBOX).toBe("");
  });
  it("CSP blocks everything except inline styles", () => {
    expect(PREVIEW_CSP).toBe("default-src 'none'; style-src 'unsafe-inline'");
    const doc = buildPreviewDoc("<p>x</p>", NOW);
    expect(doc).toContain(`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">`);
    expect(doc).not.toMatch(/script-src|unsafe-eval|allow-/);
  });
  it("merge fields are filled with fake sample values only", () => {
    expect(fillSample("<p>{{first_name}} / {{full_name}} / {{vsat_id}} / {{campus}} / {{today}}</p>", NOW))
      .toBe("<p>Test / Test Student / VSAT-TEST-0001 / Test Campus / 06 Nov 2026</p>");
  });
  it("sample values are escaped before they go into the HTML", () => {
    expect(escapeHtml(`<b>"x" & 'y'</b>`)).toBe("&lt;b&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/b&gt;");
    for (const v of Object.values(sampleValues(NOW))) expect(v).toBe(escapeHtml(v));   // nothing to escape in the fixed fake values
  });
  it("unknown placeholders are left alone (the server already refuses them)", () => {
    expect(fillSample("<p>{{email}} {{constructor}}</p>", NOW)).toBe("<p>{{email}} {{constructor}}</p>");
  });
  it("the template goes inside <body>, after the CSP", () => {
    const doc = buildPreviewDoc("<h1>Offer</h1>", NOW);
    expect(doc.indexOf("Content-Security-Policy")).toBeLessThan(doc.indexOf("<body>"));
    expect(doc).toMatch(/<body><h1>Offer<\/h1><\/body><\/html>$/);
    expect(doc).not.toMatch(/<script/i);
  });
  it("no real-looking personal data in the sample values", () => {
    expect(JSON.stringify(sampleValues(NOW))).not.toMatch(/@|\d{10}/);
  });
});

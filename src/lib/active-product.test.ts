import { describe, expect, it } from "vitest";
import { productFor } from "./active-product";

describe("productFor (active-time heartbeat)", () => {
  it("keeps the existing products unchanged", () => {
    expect(productFor("/codesprint")).toBe("codesprint");
    expect(productFor("/codesprint/module/1")).toBe("codesprint");
    expect(productFor("/events")).toBe("bootcamp");
    expect(productFor("/e/some-bootcamp")).toBe("bootcamp");
    expect(productFor("/pyq/jee-main")).toBe("pyq");
  });

  it("adds College Predictor, VSAT early registration and Talk to a Senior", () => {
    expect(productFor("/predict")).toBe("cp");
    expect(productFor("/college-predictor")).toBe("cp");
    expect(productFor("/apply")).toBe("vsat");
    expect(productFor("/apply?next=/peerpath")).toBe("vsat");
    expect(productFor("/peerpath/talk-to-senior")).toBe("peerpath");
  });

  it("counts other pages only toward the whole site", () => {
    expect(productFor("/")).toBeNull();
    expect(productFor("/profile")).toBeNull();
    expect(productFor("/dashboard")).toBeNull();
    expect(productFor("/admin/insights")).toBeNull();
    expect(productFor(null)).toBeNull();
    expect(productFor(undefined)).toBeNull();
  });
});

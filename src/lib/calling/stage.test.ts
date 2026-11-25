import { describe, expect, it } from "vitest";
import { callingStageLabel, stageMovedSinceAssignment } from "./stage";

describe("calling stage labels (0181)", () => {
  it("VSAT stages use the pipeline's words", () => {
    expect(callingStageLabel("vsat_cleared")).toBe("VSAT cleared");
    expect(callingStageLabel("vsat_not_cleared")).toBe("VSAT not cleared");
    expect(callingStageLabel("offer_sent")).toBe("Offer sent");
  });
  it("the two non-pipeline values", () => {
    expect(callingStageLabel("not_registered")).toBe("Not registered");
    expect(callingStageLabel("no_application")).toBe("Registered, no application");
  });
  it("empty / missing → dash (assigned before 0181, or never assigned)", () => {
    for (const v of [null, undefined, "", "  ", 3]) expect(callingStageLabel(v)).toBe("—");
  });
  it("an unknown key is still words, never raw", () => {
    expect(callingStageLabel("some_new_stage")).toBe("Some new stage");
  });
  it("moved since assignment only when both are known and differ", () => {
    expect(stageMovedSinceAssignment("vsat_cleared", "interview_scheduled")).toBe(true);
    expect(stageMovedSinceAssignment("vsat_cleared", "vsat_cleared")).toBe(false);
    expect(stageMovedSinceAssignment(null, "vsat_cleared")).toBe(false);
    expect(stageMovedSinceAssignment("vsat_cleared", "")).toBe(false);
  });
});

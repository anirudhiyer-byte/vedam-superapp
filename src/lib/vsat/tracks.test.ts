import { describe, expect, it } from "vitest";
import { TRACKS } from "./tracks";

describe("0164: the stages of each step (the database's list)", () => {
  it("interview: VSAT cleared → PI not appeared; counselling: PI cleared → Counselling not appeared", () => {
    expect(TRACKS.interview.stepStages).toEqual(["vsat_cleared", "interview_scheduled", "interviewed", "pi_not_appeared"]);
    expect(TRACKS.counselling.stepStages).toEqual(["pi_cleared", "counselling_scheduled", "counselled", "counselling_not_appeared"]);
  });
  it("each step's list holds the scheduled stage and the one before it", () => {
    for (const t of Object.values(TRACKS)) {
      expect(t.stepStages).toContain(t.stage);
      expect(t.stepStages).toContain(t.fromStage);
    }
  });
});

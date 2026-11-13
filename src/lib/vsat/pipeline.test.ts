import { describe, expect, it } from "vitest";
import {
  PANEL_STAGES, STAGES, canManage, errorText, hasVsatRole, interviewFormErrors, isHttpsLink, isVsatTeamPath, istSlot, needsReason, visiblePanels,
  type InterviewForm,
} from "./pipeline";

describe("needsReason (same rule as vsat__move_checked)", () => {
  it("next stage, active → no reason", () => {
    expect(needsReason("exam_taken", "active", "vsat_cleared", "active")).toBe(false);
  });
  it("moving back, skipping, not selected, on hold, reopening → reason", () => {
    expect(needsReason("vsat_cleared", "active", "exam_taken", "active")).toBe(true);
    expect(needsReason("booked", "active", "vsat_cleared", "active")).toBe(true);
    expect(needsReason("exam_taken", "active", "exam_taken", "not_selected")).toBe(true);
    expect(needsReason("pi_cleared", "active", "pi_cleared", "on_hold")).toBe(true);
    expect(needsReason("exam_taken", "not_selected", "vsat_cleared", "active")).toBe(true);
  });
  it("absent at the same stage → no reason", () => {
    expect(needsReason("interview_scheduled", "active", "interview_scheduled", "absent")).toBe(false);
  });
  it("offer_sent → seat_blocked / lapsed / cancelled are all one step", () => {
    for (const s of ["seat_blocked", "offer_lapsed", "offer_cancelled"] as const) expect(needsReason("offer_sent", "active", s, "active")).toBe(false);
  });
});

describe("roles → panels", () => {
  it("admin and admissions see all four panels", () => {
    expect(visiblePanels({ admin: true, roles: [] })).toEqual(["apps", "exam", "intv", "couns"]);
    expect(visiblePanels({ admin: false, roles: ["admissions"] })).toEqual(["apps", "exam", "intv", "couns"]);
    expect(canManage({ admin: false, roles: ["admissions"] })).toBe(true);
  });
  it("interviewer / counsellor see only their panel", () => {
    expect(visiblePanels({ admin: false, roles: ["interviewer"] })).toEqual(["intv"]);
    expect(visiblePanels({ admin: false, roles: ["counsellor"] })).toEqual(["couns"]);
    expect(visiblePanels({ admin: false, roles: ["counsellor", "interviewer"] })).toEqual(["intv", "couns"]);
    expect(canManage({ admin: false, roles: ["interviewer", "counsellor"] })).toBe(false);
  });
  it("no role → nothing", () => {
    expect(visiblePanels({ admin: false, roles: [] })).toEqual([]);
  });
});

describe("panel stages (trickle-down)", () => {
  it("every panel stage is a real stage; Applications shows all", () => {
    for (const list of Object.values(PANEL_STAGES)) for (const s of list) expect(STAGES).toContain(s);
    expect(PANEL_STAGES.apps).toEqual(STAGES);
  });
  it("Interview starts at VSAT cleared, Counselling at PI cleared", () => {
    expect(PANEL_STAGES.intv[0]).toBe("vsat_cleared");
    expect(PANEL_STAGES.couns[0]).toBe("pi_cleared");
    expect(PANEL_STAGES.intv).not.toContain("exam_taken");
  });
});

describe("errorText", () => {
  it("maps known codes to plain English", () => {
    expect(errorText("REASON_REQUIRED")).toMatch(/reason/i);
    expect(errorText("SLOT_TAKEN")).toMatch(/another student/);
    expect(errorText("BAD_VALUE: logic")).toBe('Please check "Logical reasoning".');
    expect(errorText("NO_BAND")).toMatch(/scholarship band/);
  });
  it("never shows raw database text", () => {
    expect(errorText('duplicate key value violates unique constraint "x"')).toBe("Something went wrong. Please try again.");
    expect(errorText(undefined)).toBe("Something went wrong. Please try again.");
    expect(errorText("UNKNOWN_KEY: role")).toMatch(/unexpected/);
  });
});

describe("interview form checks", () => {
  const ok: InterviewForm = { communication: 4, logic: 4, passion: 3, achievements: 3, why_program: 4, cheating_seen: false, interviewer_verdict: "selected" };
  it("a full form has no errors", () => { expect(interviewFormErrors(ok)).toEqual([]); });
  it("missing / out of range / decimal parts are flagged", () => {
    expect(interviewFormErrors({ ...ok, logic: null })).toHaveLength(1);
    expect(interviewFormErrors({ ...ok, logic: 6 })).toHaveLength(1);
    expect(interviewFormErrors({ ...ok, logic: 3.5 })).toHaveLength(1);
  });
  it("cheating seen and verdict are required", () => {
    expect(interviewFormErrors({ ...ok, cheating_seen: null, interviewer_verdict: "" })).toHaveLength(2);
  });
});

describe("slots and links", () => {
  it("builds an IST ISO slot the database accepts", () => {
    expect(istSlot("2026-11-20", "15:30")).toBe("2026-11-20T15:30:00+05:30");
    expect(istSlot("tomorrow", "15:30")).toBeNull();
    expect(istSlot("2026-11-20", "3pm")).toBeNull();
  });
  it("only https meeting links", () => {
    expect(isHttpsLink("https://meet.google.com/abc-defg-hij")).toBe(true);
    expect(isHttpsLink("http://meet.google.com/abc")).toBe(false);
    expect(isHttpsLink("javascript:alert(1)")).toBe(false);
  });
});

describe("admin middleware exception for VSAT team members", () => {
  it("only exactly /admin/vsat", () => {
    expect(isVsatTeamPath("/admin/vsat")).toBe(true);
    expect(isVsatTeamPath("/admin/vsat/")).toBe(true);
    for (const p of ["/admin", "/admin/vsat-early", "/admin/vsat-forms", "/admin/vsat-exam-dates", "/admin/vsat/x", "/admin/growth"]) {
      expect(isVsatTeamPath(p)).toBe(false);
    }
  });
  it("needs a real role from vsat_my_roles", () => {
    expect(hasVsatRole({ admin: false, roles: ["interviewer"] })).toBe(true);
    expect(hasVsatRole({ admin: true, roles: [] })).toBe(true);
    for (const d of [null, undefined, "x", {}, { admin: false, roles: [] }, { admin: "true", roles: [""] }, { roles: [1] }]) {
      expect(hasVsatRole(d)).toBe(false);
    }
  });
});

import { describe, expect, it } from "vitest";
import {
  PANEL_STAGES, STAGES, STAGE_GROUPS, STATUSES, canManage, errorText, hasVsatRole, interviewFormErrors, isHttpsLink, isTerminalFail,
  isVsatTeamPath, istSlot, needsReason, statusLabel, visiblePanels,
  type InterviewForm,
} from "./pipeline";

describe("needsReason (same rule as vsat__move_checked, 0177)", () => {
  it("next stage, active → no reason", () => {
    expect(needsReason("exam_taken", "active", "vsat_cleared", "active")).toBe(false);
  });
  it("moving back, skipping, not cleared, on hold, reopening → reason", () => {
    expect(needsReason("vsat_cleared", "active", "exam_taken", "active")).toBe(true);
    expect(needsReason("booked", "active", "vsat_cleared", "active")).toBe(true);
    // 0177: rejecting is a stage now (was status not_selected)
    expect(needsReason("exam_taken", "active", "vsat_not_cleared", "active")).toBe(true);
    expect(needsReason("interviewed", "active", "pi_not_cleared", "active")).toBe(true);
    expect(needsReason("pi_cleared", "active", "pi_cleared", "on_hold")).toBe(true);
    // 0177: reopening = leaving a "not cleared" / "not appeared" stage (was not_selected → active), even at the same order
    expect(needsReason("vsat_not_cleared", "active", "vsat_cleared", "active")).toBe(true);
    expect(needsReason("counselling_not_appeared", "active", "counselled", "active")).toBe(true);
    expect(needsReason("pi_cleared", "on_hold", "pi_cleared", "active")).toBe(true);
  });
  it("a no-show (the next step, PI not appeared) → no reason", () => {
    // 0177: was "absent at the same stage"; a no-show is the stage PI not appeared now
    expect(needsReason("interview_scheduled", "active", "pi_not_appeared", "active")).toBe(false);
  });
  it("offer_sent → enrolled / lapsed / cancelled are all one step", () => {
    for (const s of ["enrolled", "offer_lapsed", "offer_cancelled"] as const) expect(needsReason("offer_sent", "active", s, "active")).toBe(false);
  });
});

describe("0177 stage model", () => {
  it("only Active and On hold are statuses", () => {
    expect(STATUSES).toEqual(["active", "on_hold"]);
  });
  it("both not-cleared stages exist and sit in their panels", () => {
    expect(STAGES).toContain("vsat_not_cleared");
    expect(STAGES).toContain("pi_not_cleared");
    expect(PANEL_STAGES.exam).toContain("vsat_not_cleared");
    expect(PANEL_STAGES.intv).toContain("pi_not_cleared");
  });
  it("the Move-stage groups hold every stage exactly once; offers sit under Counselling", () => {
    const all = STAGE_GROUPS.flatMap((g) => [...g.stages]);
    expect([...all].sort()).toEqual([...STAGES].sort());
    expect(new Set(all).size).toBe(all.length);
    const couns = STAGE_GROUPS.find((g) => g.label === "Counselling")!.stages;
    for (const s of ["offer_sent", "offer_lapsed", "offer_cancelled"] as const) expect(couns).toContain(s);
  });
  it("terminal fail (attempt 2) mirrors vsat__is_terminal_fail", () => {
    for (const s of ["vsat_not_cleared", "pi_not_cleared", "vsat_not_appeared", "pi_not_appeared", "counselling_not_appeared"])
      expect(isTerminalFail(s, "active")).toBe(true);
    expect(isTerminalFail("vsat_cleared", "active")).toBe(false);
    expect(isTerminalFail("pi_cleared", "on_hold")).toBe(false);
    // rows from before 0177
    expect(isTerminalFail("exam_taken", "not_selected")).toBe(true);
    expect(isTerminalFail("interviewed", "not_selected")).toBe(true);
  });
  it("status labels, including the retired ones still in history", () => {
    expect(statusLabel("active")).toBe("Active");
    expect(statusLabel("on_hold")).toBe("On hold");
    expect(statusLabel("not_selected")).toBe("Not selected");
    expect(statusLabel("absent")).toBe("Absent");
    expect(statusLabel(null)).toBe("");
    expect(statusLabel("something_else")).toBe("something_else");
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
    expect(errorText("COUNT_CHANGED")).toMatch(/Preview again/);
    expect(errorText("BAD_VALUE: verdict")).toBe('Please check "Proctoring verdict".');
  });
  it("never shows raw database text", () => {
    expect(errorText('duplicate key value violates unique constraint "x"')).toBe("Something went wrong. Please try again.");
    expect(errorText(undefined)).toBe("Something went wrong. Please try again.");
    expect(errorText("UNKNOWN_KEY: role")).toMatch(/unexpected/);
  });
  it("shows the settings rule the database gave, and only that kind of text", () => {
    expect(errorText("BAD_BANDS: category 2 must end where category 1 starts")).toBe("Category 2 must end where category 1 starts.");
    expect(errorText("BAD_ANCHORS: 2 to 10 points")).toBe("2 to 10 points.");
    expect(errorText("BAD_BANDS: <script>alert(1)</script>")).toBe("Something went wrong. Please try again.");
    expect(errorText("PAST_DATE")).toMatch(/from tomorrow/);
    expect(errorText("NO_ACCOUNT")).toMatch(/sign up/);
    expect(errorText("FORBIDDEN_COLUMN: family_income")).toMatch(/family income/);
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
  // 0166 (owner's review): the interviewer gives no verdict any more; cheating seen is still required
  it("cheating seen is required; the interviewer's verdict is not", () => {
    expect(interviewFormErrors({ ...ok, cheating_seen: null, interviewer_verdict: "" })).toEqual(["Cheating seen: pick yes or no"]);
    const { interviewer_verdict: _dropped, ...noVerdict } = ok;
    void _dropped;
    expect(interviewFormErrors(noVerdict)).toEqual([]);
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

describe("errorText · interviews (0140)", () => {
  it("every code the interview functions raise has its own plain message", () => {
    for (const code of ["SLOT_IN_PAST", "ALREADY_SCHEDULED", "ALREADY_INTERVIEWED", "NO_INTERVIEW", "TOO_EARLY", "LINK_IN_USE", "NOTHING_TO_RETRY", "NO_FREE_SLOT"]) {
      expect(errorText(code)).not.toBe("Something went wrong. Please try again.");
    }
    expect(errorText("BAD_VALUE: duration_min")).toBe('Please check "Length".');
    expect(errorText("BAD_VALUE: interviewer_ids")).toBe('Please check "Interviewer".');
  });
});

describe("errorText · booking from the panel rows (0143)", () => {
  it("every code the row functions raise has its own plain message", () => {
    for (const code of ["CLASH", "NO_DRAFT", "SLOT_TAKEN", "NOT_AN_INTERVIEWER", "WRONG_STAGE", "SLOT_IN_PAST", "ALREADY_INTERVIEWED", "ALREADY_SCHEDULED", "NO_FREE_SLOT"]) {
      expect(errorText(code)).not.toBe("Something went wrong. Please try again.");
    }
    expect(errorText("BAD_VALUE: application_ids")).not.toBe("Something went wrong. Please try again.");
    expect(errorText("BAD_VALUE: start")).toBe('Please check "Start time".');
  });
});

describe("errorText · offers (0144)", () => {
  it("every code the offer functions raise has its own plain message", () => {
    for (const code of ["NO_SCHOLARSHIP", "ALREADY_RELEASED", "CAMPUS_MISSING", "WRONG_STAGE", "REASON_REQUIRED", "STAGE_CHANGED"]) {
      expect(errorText(code)).not.toBe("Something went wrong. Please try again.");
    }
    expect(errorText("NO_SCHOLARSHIP")).toMatch(/counselling/);
    expect(errorText("BAD_VALUE: dry_run")).toBe('Please check "Preview".');
  });
});

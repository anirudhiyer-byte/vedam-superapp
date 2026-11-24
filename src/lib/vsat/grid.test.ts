import { describe, expect, it } from "vitest";
import {
  DEFAULT_COLUMNS, NO_COUNSELLOR, NO_INTERVIEWER, VALUE_CHOICES, columnLabel, describeClause, formatValue, isFilterable, linkText, meetLink, panelScope, parseSearchValues,
  peopleOptions, pickSummary, requestColumns, sanitizeColumns, toCsv, type GridColumn, type GridRow,
} from "./grid";
import { PANEL_STAGES } from "./pipeline";

const col = (key: string, type: GridColumn["type"] = "text", restricted = false, group = "Personal"): GridColumn => ({ key, type, group, virtual: false, restricted });

describe("columnLabel", () => {
  it("uses the readable names for the common columns", () => {
    expect(columnLabel("registered_name")).toBe("Student");
    expect(columnLabel("vsat")).toBe("VSAT");
    expect(columnLabel("counselling_pct")).toBe("Scholarship %");
    expect(columnLabel("class12_percentage")).toBe("Class 12 %");
  });
  it("humanises anything else, keeping the abbreviations", () => {
    expect(columnLabel("olympiad1_intl_rank")).toBe("Olympiad1 intl. rank");
    expect(columnLabel("jee_appeared_when")).toBe("JEE appeared");
    expect(columnLabel("coding2_percentile")).toBe("Coding2 percentile");
    expect(columnLabel("some_new_column_url")).toBe("Some new column URL");
  });
});

describe("default columns and the request", () => {
  it("every panel starts with the student column and the stage", () => {
    for (const p of ["apps", "exam", "intv", "couns"] as const) {
      expect(DEFAULT_COLUMNS[p][0]).toBe("registered_name");
      expect(DEFAULT_COLUMNS[p]).toContain("stage");
    }
  });
  it("adds the app no. and the override markers the cells need", () => {
    expect(requestColumns(["registered_name", "vps_effective"])).toEqual(expect.arrayContaining(["application_no", "vps_override"]));
    expect(requestColumns(["eligible_effective"])).toContain("eligible_override");
    expect(requestColumns(["campus"])).not.toContain("vps_override");
  });
  it("the Applications panel has no scope; the others send their stages", () => {
    expect(panelScope("apps")).toBeUndefined();
    expect(panelScope("intv")).toEqual([...PANEL_STAGES.intv]);
  });
});

describe("sanitizeColumns", () => {
  const catalog = [col("registered_name"), col("campus"), col("stage", "stage"), col("registered_email", "text", true)];
  it("drops saved columns the catalogue no longer offers (e.g. a contact column for an interviewer)", () => {
    expect(sanitizeColumns(["registered_name", "campus", "registered_mobile"], catalog, ["stage"])).toEqual(["registered_name", "campus"]);
  });
  it("falls back to the defaults when nothing valid was saved, and keeps the student column first", () => {
    expect(sanitizeColumns(null, catalog, ["stage", "registered_name", "nope"])).toEqual(["registered_name", "stage"]);
    expect(sanitizeColumns("garbage", catalog, ["campus"])).toEqual(["registered_name", "campus"]);
  });
});

describe("parseSearchValues", () => {
  it("splits on commas, new lines, semicolons, slashes and tabs; trims; dedupes", () => {
    expect(parseSearchValues("GRD1, grd3\n GRD1 ;\tGRD4/GRD5")).toEqual(["GRD1", "grd3", "GRD4", "GRD5"]);
  });
  it("drops values the database would refuse (under 2 or over 100 characters)", () => {
    expect(parseSearchValues("a, ok, " + "x".repeat(101))).toEqual(["ok"]);
  });
  it("stops at 200 values", () => {
    const many = Array.from({ length: 250 }, (_, i) => `v${i}`).join(",");
    expect(parseSearchValues(many)).toHaveLength(200);
  });
});

describe("formatValue", () => {
  it("formats by type", () => {
    expect(formatValue("bool", "x", true)).toBe("Yes");
    expect(formatValue("bool", "x", false)).toBe("No");
    expect(formatValue("num", "vps_effective", 8.43)).toBe("8.43");
    expect(formatValue("num", "exam_percentile", 80)).toBe("80");
    expect(formatValue("num", "counselling_pct", 30)).toBe("30%");
    expect(formatValue("num", "class12_percentage", "80.00")).toBe("80%");
    expect(formatValue("stage", "stage", "vsat_cleared")).toBe("VSAT cleared");
    expect(formatValue("status", "status", "on_hold")).toBe("On hold");
    expect(formatValue("text", "x", null)).toBe("—");
    expect(formatValue("date", "date_of_birth", "2008-05-14")).toMatch(/14 May 2008/);
  });
});

describe("toCsv", () => {
  it("writes the labels as the header, the app no. first, and quotes every field", () => {
    const rows: GridRow[] = [
      { application_id: "A1", application_no: "VSAT/26/1", stage: "booked", status: "active", attempt_no: 1, registered_name: 'Asha "AJ" Rao', campus: "pune", vps_effective: null },
    ];
    const csv = toCsv(rows, [{ key: "registered_name", type: "text" }, { key: "campus", type: "text" }, { key: "vps_effective", type: "num" }]);
    expect(csv.split("\n")[0]).toBe('"App no.","Student","Campus","VPS"');
    expect(csv.split("\n")[1]).toBe('"VSAT/26/1","Asha ""AJ"" Rao","pune",""');
  });
});

describe("pickSummary", () => {
  it("All / the one label / N selected", () => {
    const l = (v: string) => v.toUpperCase();
    expect(pickSummary([], l)).toBe("All");
    expect(pickSummary(["booked"], l)).toBe("BOOKED");
    expect(pickSummary(["a", "b", "c"], l)).toBe("3 selected");
  });
});

describe("VSAT Exam results (0135)", () => {
  it("the Exam panel opens on the results sheet: %, percentile, the three sections, VPS, eligibility, proctoring", () => {
    expect(DEFAULT_COLUMNS.exam).toEqual(expect.arrayContaining([
      "exam_percentage", "exam_percentile", "exam_section_maths", "exam_section_lr", "exam_section_cs", "vps_effective", "eligible_effective", "proctoring",
    ]));
  });
  it("VPS brings its calculated value along so the cell can show it next to an override", () => {
    expect(requestColumns(["vps_effective"])).toEqual(expect.arrayContaining(["vps_override", "vps_calculated"]));
    expect(requestColumns(["exam_percentage"])).not.toContain("vps_calculated");
  });
  it("labels the new columns in plain words and keeps the stored VPS apart from the calculated one", () => {
    expect(columnLabel("exam_percentage")).toBe("Exam %");
    expect(columnLabel("exam_section_lr")).toBe("Logical reasoning");
    expect(columnLabel("vps_calculated")).toBe("VPS (calculated)");
    expect(columnLabel("vps_score")).toBe("VPS (stored)");
    expect(columnLabel("exam_overall")).toBe("Result (Wheebox)");
  });
  it("formats the exam % with a sign and fixed-list values with their words", () => {
    expect(formatValue("num", "exam_percentage", 75.5)).toBe("75.5%");
    expect(formatValue("text", "proctoring", "disqualified")).toBe("Disqualified");
    expect(formatValue("text", "class12_result", "yet_to_graduate")).toBe("Yet to graduate");
    expect(formatValue("text", "class12_result", "something_new")).toBe("something_new");
  });
  it("the filter builder trusts the database's filterable flag, else real columns of a filterable type only", () => {
    const v = (key: string, type: GridColumn["type"], filterable?: boolean): GridColumn => ({ key, type, group: "Exam", virtual: true, restricted: false, filterable });
    expect(isFilterable(v("vps_effective", "num", true))).toBe(true);
    expect(isFilterable(v("stage", "stage", false))).toBe(false);
    expect(isFilterable(v("vsat", "text"))).toBe(false);                 // virtual, no flag (older response) → not offered
    expect(isFilterable(col("class12_percentage", "num"))).toBe(true);   // real, no flag → by type
    expect(isFilterable(col("form_data", "json"))).toBe(false);
  });
  it("filter chips show the readable value for fixed-list columns", () => {
    expect(describeClause({ column: "proctoring", op: "eq", v: "disqualified" }, "text")).toBe("Proctoring is Disqualified");
    expect(describeClause({ column: "class12_result", op: "in", v: ["pass", "yet_to_graduate"] }, "text")).toBe("12th result is any of Pass, Yet to graduate");
    expect(describeClause({ column: "vps_effective", op: "gte", v: "7.4" }, "num")).toBe("VPS ≥ 7.4");
    expect(VALUE_CHOICES.proctoring.map((c) => c.value)).toEqual(["disqualified", "cleared"]);
  });
});

describe("interviews (0140)", () => {
  it("the Interview panel shows the Meet state and attendance next to the slot", () => {
    expect(DEFAULT_COLUMNS.intv.slice(4, 8)).toEqual(["interviewer", "interview_slot", "interview_meet", "interview_attendance"]);
    expect(columnLabel("interview_meet")).toBe("Interview Meet");
  });
  it("Meet state reads as words in cells and CSV", () => {
    expect(formatValue("text", "interview_meet", "ready")).toBe("Meet ready");
    expect(formatValue("text", "interview_meet", "own_link")).toBe("Own link");
    expect(formatValue("text", "interview_meet", "failed")).toBe("Meet failed");
    expect(formatValue("text", "interview_meet", null)).toBe("—");
    expect(formatValue("text", "interview_meet", "something_new")).toBe("something_new");
  });
});

describe("status columns read as words (cells and CSV)", () => {
  // 0164 (owner's review): the attendance column is the Status, Done / No-show / Rescheduled ("Joined" became "Done")
  it("interview and counselling status use the drawer's words; unknown values pass through", () => {
    for (const key of ["interview_attendance", "counselling_attendance"]) {
      expect(formatValue("text", key, "scheduled")).toBe("Not marked yet");
      expect(formatValue("text", key, "done")).toBe("Done");
      expect(formatValue("text", key, "no_show")).toBe("No-show");
      expect(formatValue("text", key, "rescheduled")).toBe("Rescheduled");
      expect(formatValue("text", key, "other")).toBe("other");
      expect(formatValue("text", key, null)).toBe("—");
    }
  });
  it("CSV carries the words too", () => {
    const rows = [{ application_id: "A1", application_no: "A1", stage: "interview_scheduled", status: "active", attempt_no: 1, interview_attendance: "no_show" }] as unknown as GridRow[];
    expect(toCsv(rows, [{ key: "interview_attendance", type: "text" }])).toBe('"App no.","Interview status"\n"A1","No-show"');
  });
});

describe("counselling (0158): Counsellor dropdown and Counselling Meet", () => {
  it("the Counselling panel shows the Meet state next to the slot", () => {
    expect(DEFAULT_COLUMNS.couns.slice(4, 7)).toEqual(["counsellor", "counselling_slot", "counselling_meet"]);
    expect(columnLabel("counselling_meet")).toBe("Counselling Meet");
  });
  it("Meet state reads as words in cells and CSV, like the interview one", () => {
    expect(formatValue("text", "counselling_meet", "ready")).toBe("Meet ready");
    expect(formatValue("text", "counselling_meet", "creating")).toBe("Creating Meet…");
    expect(formatValue("text", "counselling_meet", "cancelled")).toBe("Cancelled");
    expect(formatValue("text", "counselling_meet", null)).toBe("—");
    expect(formatValue("text", "counselling_meet", "something_new")).toBe("something_new");
    const rows = [{ application_id: "A1", application_no: "A1", stage: "counselling_scheduled", status: "active", attempt_no: 1, counselling_meet: "own_link" }] as unknown as GridRow[];
    expect(toCsv(rows, [{ key: "counselling_meet", type: "text" }])).toBe('"App no.","Counselling Meet"\n"A1","Own link"');
  });
  it("people dropdown: names A–Z, then the 'nobody yet' option, with counts", () => {
    const opts = peopleOptions({ u2: "Zoya", u1: "Arjun" }, { u1: 3, u2: 1, none: 4 }, [],
      { none: NO_COUNSELLOR, noneLabel: "No counsellor", fallback: "Counsellor", loaded: true });
    expect(opts).toEqual([
      { value: "u1", label: "Arjun", count: 3 }, { value: "u2", label: "Zoya", count: 1 }, { value: "none", label: "No counsellor", count: 4 },
    ]);
  });
  it("a chosen counsellor stays listed at 0 (and without a name), counts are empty before the first load", () => {
    const opts = peopleOptions({}, {}, ["u9", NO_COUNSELLOR], { none: NO_COUNSELLOR, noneLabel: "No counsellor", fallback: "Counsellor", loaded: true });
    expect(opts).toEqual([{ value: "u9", label: "Counsellor", count: 0 }, { value: "none", label: "No counsellor", count: 0 }]);
    const before = peopleOptions(undefined, undefined, [], { none: NO_COUNSELLOR, noneLabel: "No counsellor", fallback: "Counsellor", loaded: false });
    expect(before).toEqual([{ value: "none", label: "No counsellor", count: null }]);
  });
  it("the interviewer dropdown gives the same list it gave before the shared helper", () => {
    const opts = peopleOptions({ a: "Bina" }, { a: 2, none: 1 }, ["b"], { none: NO_INTERVIEWER, noneLabel: "No interviewer", fallback: "Interviewer", loaded: true });
    expect(opts).toEqual([
      { value: "a", label: "Bina", count: 2 }, { value: "b", label: "Interviewer", count: 0 }, { value: "none", label: "No interviewer", count: 1 },
    ]);
  });
});

describe("0163/0164: Join link, reschedule counts, status columns", () => {
  it("meetLink gives only a clean https link that came with its own Meet column", () => {
    const row = { interview_meet_link: "https://meet.google.com/abc-defg-hij", counselling_meet_link: "https://zoom.us/j/123?pwd=x" };
    expect(meetLink(row, "interview_meet")).toBe("https://meet.google.com/abc-defg-hij");
    expect(meetLink(row, "counselling_meet")).toBe("https://zoom.us/j/123?pwd=x");
    expect(meetLink(row, "interview_slot")).toBeNull();
    expect(meetLink({}, "interview_meet")).toBeNull();
    for (const bad of ["http://meet.google.com/x", "javascript:alert(1)", "https://user:pw@evil.example/x", "not a url", 42, null, "https://" + "a".repeat(500)]) {
      expect(meetLink({ interview_meet_link: bad }, "interview_meet")).toBeNull();
    }
  });
  it("linkText drops https:// and shortens long links", () => {
    expect(linkText("https://meet.google.com/abc-defg-hij")).toBe("meet.google.com/abc-defg-hij");
    expect(linkText("https://zoom.us/j/1234567890123456789012345?pwd=abcdef", 20)).toBe("zoom.us/j/123456789…");
  });
  it("the interview / counselling panels show status and reschedule count by default, not the interviewer's verdict", () => {
    expect(DEFAULT_COLUMNS.intv).toEqual(expect.arrayContaining(["interview_attendance", "interview_reschedules", "interview_meet"]));
    expect(DEFAULT_COLUMNS.intv).not.toContain("interviewer_verdict");
    expect(DEFAULT_COLUMNS.couns).toEqual(expect.arrayContaining(["counselling_attendance", "counselling_reschedules", "counselling_meet"]));
    expect(columnLabel("interview_attendance")).toBe("Interview status");
    expect(columnLabel("counselling_attendance")).toBe("Counselling status");
    expect(columnLabel("interview_reschedules")).toBe("Interview reschedules");
    expect(columnLabel("counselling_reschedules")).toBe("Counselling reschedules");
  });
});

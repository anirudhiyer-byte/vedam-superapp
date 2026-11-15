import { describe, expect, it } from "vitest";
import {
  dateRange, fmtAdded, fmtLong, fmtPhone, fmtStamp, fmtStart, jobCode, logsParams, recipientParams, suppressionParams,
  toCommLogRow, toDetailRow, toPerformance, toStats, toStatusDetail, toSuppressionRow, type LiveJob,
} from "./live-map";

const JOB: LiveJob = {
  id: "5011eb15-74e9-4f7b-8b5d-192ff8f14aef", channel: "whatsapp", name: "Oct reminder", kind: "campaign", template: "tpl_a",
  audience: "advanced", recipient_count: 3, created_at: "2026-09-28T09:09:00Z", scheduled_at: null, status: "Completed",
  sent: 3, delivered: 2, read: 1, clicked: 0, failed: 1,
};

describe("formatting (India time, same text shapes the screens already use)", () => {
  it("start date: '28 Sep, 26 2:39 PM'", () => expect(fmtStart("2026-09-28T09:09:00Z")).toBe("28 Sep, 26 2:39 PM"));
  it("long date: '28 Sep 2026 02:39 pm'", () => expect(fmtLong("2026-09-28T09:09:00Z")).toBe("28 Sep 2026 02:39 pm"));
  it("added on + sortable stamp", () => {
    expect(fmtAdded("2026-09-30T09:14:00Z")).toBe("30/09/2026, 02:44 pm");
    expect(fmtStamp("2026-09-30T09:14:00Z")).toBe("2026-09-30 14:44");
  });
  it("midnight and noon edges", () => {
    expect(fmtStart("2026-09-27T18:30:00Z")).toBe("28 Sep, 26 12:00 AM");
    expect(fmtStart("2026-09-28T06:30:00Z")).toBe("28 Sep, 26 12:00 PM");
  });
  it("invalid / missing dates give '-' instead of crashing", () => {
    expect(fmtStart(null)).toBe("-"); expect(fmtLong("not a date")).toBe("-"); expect(fmtStamp(undefined)).toBe("");
  });
  it("phone numbers", () => {
    expect(fmtPhone("919000000001")).toBe("+91 90000 00001");
    expect(fmtPhone("+91 90000-00002")).toBe("+91 90000 00002");
    expect(fmtPhone("9000000003")).toBe("+91 90000 00003");
    expect(fmtPhone("449000000004")).toBe("+44 90000 00004");
    expect(fmtPhone("12345")).toBe("12345");
    expect(fmtPhone(null)).toBe("-");
  });
  it("job code", () => expect(jobCode(JOB.id)).toBe("Job#5011EB15"));
});

describe("row mapping", () => {
  it("normal job → CommLogRow", () => {
    expect(toCommLogRow(JOB)).toMatchObject({
      id: JOB.id, channel: "whatsapp", jobId: "Job#5011EB15", preview: "Whatsapp", previewNote: "Oct reminder", template: "tpl_a",
      status: "Completed", statusInfo: true, startDate: "28 Sep, 26 2:39 PM", listName: "advanced", segmentName: "-",
      targeted: 3, delivered: 2, read: 1, clicked: 0, automationId: "NA", campaignName: "Oct reminder", campaignType: "campaign", nature: "Bulk",
    });
  });
  it("scheduled job: delivered is empty (not 0), no read/clicked; unknown status falls back safely", () => {
    const r = toCommLogRow({ ...JOB, status: "Scheduled", sent: 0, delivered: 0, failed: 0 });
    expect(r.delivered).toBeNull(); expect(r.read).toBeUndefined(); expect(r.statusInfo).toBeUndefined();
    expect(toCommLogRow({ ...JOB, status: "Weird" as never }).status).toBe("Completed");
  });
  it("edge: no template / no audience / single recipient / unknown channel", () => {
    const r = toCommLogRow({ ...JOB, template: null, audience: null, recipient_count: 1, channel: "pigeon" });
    expect(r).toMatchObject({ template: "-", listName: "-", nature: "Single User", channel: "whatsapp" });
  });
  it("detail row: phone formatted, India region, date shape the filter understands", () => {
    const d = toDetailRow({ rid: "r1", channel: "whatsapp", contact: "919000000001", sent_at: "2026-09-28T09:09:00Z", status: "Read" }, JOB);
    expect(d).toMatchObject({ id: "r1", jobId: "5011EB15", type: "WhatsApp", to: "+91 90000 00001", region: "(Domestic)+91-India", status: "Read", template: "tpl_a" });
    expect(d.date).toMatch(/^\d{1,2} [A-Z][a-z]{2} \d{4}/);
  });
  it("stats + status detail", () => {
    expect(toStats(JOB)).toEqual({ sent: 3, delivered: 2, read: 1, failed: 1, clicked: 0, replied: 0, unsubscribed: 0, flowResponse: 0 });
    expect(toStatusDetail([{ rid: "r3", reason: "Number not on WhatsApp", at: "2026-09-28T09:09:00Z" }])).toEqual([{ id: "r3", status: "Number not on WhatsApp", date: "28 Sep 2026 02:39 pm" }]);
  });
  it("suppression rows", () => {
    expect(toSuppressionRow({ id: "s1", contact: "919000000011", channel: "WhatsApp", reason: "Unsubscribe", source: "STOP reply", at: "2026-09-30T09:14:00Z" }))
      .toEqual({ id: "s1", contact: "+91 90000 00011", channel: "WhatsApp", reason: "Unsubscribe", source: "STOP reply", addedOn: "30/09/2026, 02:44 pm", stamp: "2026-09-30 14:44" });
    expect(toSuppressionRow({ id: "s2", contact: "a@example.com", channel: "Email", reason: "Nope" as never, source: "-", at: null }).reason).toBe("Unsubscribe");
  });
});

describe("performance", () => {
  const base = { basis: { matched: 3, counted: 2, scheduled: 1, in_progress: 0 }, totals: { sent: 5, delivered: 3, read: 2, clicked: 1, failed: 1 } };
  it("short range → weekly buckets (Monday start), channels labelled", () => {
    const p = toPerformance({ ...base, by_channel: [{ channel: "whatsapp", sent: 3, delivered: 2, read: 1, clicked: 0 }, { channel: "email", sent: 2, delivered: 1, read: 1, clicked: 1 }],
      by_day: [{ day: "2026-10-01", sent: 2, delivered: 1 }, { day: "2026-10-02", sent: 1, delivered: 1 }, { day: "2026-10-08", sent: 2, delivered: 1 }] });
    expect(p.totals).toEqual({ sent: 5, delivered: 3, read: 2, clicked: 1, failed: 1 });
    expect(p.byChannel.map((c) => c.channel)).toEqual(["WhatsApp", "Email"]);
    expect(p.trend).toEqual([{ label: "Wk 28 Sep", sent: 3, delivered: 2 }, { label: "Wk 5 Oct", sent: 2, delivered: 1 }]);
    expect(p.basis).toEqual({ matched: 3, counted: 2, scheduled: 1, inProgress: 0, voice: 0 });
  });
  it("3+ months → monthly buckets; empty data → empty lists, zeros", () => {
    const p = toPerformance({ ...base, by_channel: [], by_day: [{ day: "2026-08-10", sent: 1, delivered: 1 }, { day: "2026-09-10", sent: 1, delivered: 0 }, { day: "2026-10-10", sent: 1, delivered: 1 }] });
    expect(p.trend.map((t) => t.label)).toEqual(["Aug 2026", "Sep 2026", "Oct 2026"]);
    const e = toPerformance({ basis: { matched: 0, counted: 0, scheduled: 0, in_progress: 0 }, totals: { sent: 0, delivered: 0, read: 0, clicked: 0, failed: 0 }, by_channel: [], by_day: [] });
    expect(e.trend).toEqual([]); expect(e.byChannel).toEqual([]); expect(e.totals.sent).toBe(0);
  });
});

describe("query → params", () => {
  it("date range: 'a..b', single day, open ends, nothing", () => {
    const today = "2026-11-05";
    expect(dateRange("2026-10-01..2026-10-07", today)).toEqual({ from: "2026-10-01", to: "2026-10-07" });
    expect(dateRange("2026-10-01", today)).toEqual({ from: "2026-10-01", to: "2026-10-01" });
    expect(dateRange("2026-10-01..", today)).toEqual({ from: "2026-10-01", to: today });
    expect(dateRange("..2026-10-31", today)).toEqual({ from: "2026-08-03", to: "2026-10-31" });
    expect(dateRange(undefined, today)).toEqual({});
    expect(dateRange("garbage", today)).toEqual({});
  });
  it("logs: supported filters only, sort keys mapped, unsupported sort dropped", () => {
    expect(logsParams({ search: " Job#5011 ", page: 2, pageSize: 25, sortKey: "targeted", sortDir: "asc",
      filters: { channel: "email", status: "Completed", template: "t", nature: "Bulk", campaignName: "Oct", startDate: "2026-10-01..2026-10-07", form: "All Forms" } }, "2026-11-05"))
      .toEqual({ search: "Job#5011", page: 2, size: 25, sort: "targeted", dir: "asc", channel: "email", status: "Completed", template: "t", nature: "Bulk", campaign: "Oct", from: "2026-10-01", to: "2026-10-07" });
    expect(logsParams({ sortKey: "sentBy", sortDir: "asc" }, "2026-11-05")).toEqual({});
    expect(logsParams({ filters: { channel: "sms" } }, "2026-11-05")).toEqual({});
  });
  it("recipients + suppressions", () => {
    expect(recipientParams({ sortKey: "name", filters: { status: "Read", date: "2026-10-01..2026-10-02", waba: "x" } }, "2026-11-05"))
      .toEqual({ status: "Read", from: "2026-10-01", to: "2026-10-02" });
    expect(suppressionParams({ sortKey: "stamp", sortDir: "desc", filters: { channel: "WhatsApp", reason: "Unsubscribe", addedDate: "" } }, "2026-11-05"))
      .toEqual({ channel: "WhatsApp", reason: "Unsubscribe", sort: "stamp", dir: "desc" });
  });
  it("page size above 100 is capped for the server", () => {
    expect(logsParams({ pageSize: 500 }, "2026-11-05").size).toBe(100);
  });
});

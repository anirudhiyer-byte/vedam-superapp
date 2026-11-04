import { describe, it, expect } from "vitest";
import { eventSchema, DEFAULT_ONLINE_REG, DEFAULT_OFFLINE_REG, type EventRow, type EventField } from "./events";

/** Minimal EventRow for schema tests — only the fields eventSchema() reads matter. */
function ev(partial: Partial<EventRow>): EventRow {
  return { mode: "online", registration_schema: null, ...partial } as EventRow;
}
const keys = (s: EventField[]) => s.map((f) => f.key);

describe("eventSchema", () => {
  it("online event with no custom schema → the default online fields (incl. stream + passout)", () => {
    expect(keys(eventSchema(ev({ mode: "online", registration_schema: [] })))).toEqual(keys(DEFAULT_ONLINE_REG));
    expect(keys(eventSchema(ev({ mode: "online", registration_schema: null })))).toContain("stream");
    expect(keys(eventSchema(ev({ mode: "online" })))).toContain("passout_year");
  });

  it("offline event with no custom schema → the default offline fields", () => {
    expect(keys(eventSchema(ev({ mode: "offline", registration_schema: [] })))).toEqual(keys(DEFAULT_OFFLINE_REG));
  });

  // The regression that broke MQL: a custom question used to REPLACE the defaults,
  // so stream/passout were no longer captured from the profile. They must survive.
  it("a custom question is APPENDED and never drops the profile fields", () => {
    const custom: EventField[] = [{ key: "school", label: "Name of School / Institution", type: "text", required: true }];
    const schema = eventSchema(ev({ mode: "online", registration_schema: custom }));
    expect(keys(schema)).toContain("stream");
    expect(keys(schema)).toContain("passout_year");
    expect(keys(schema)).toContain("whatsapp");
    expect(keys(schema)).toContain("school");
    // defaults come first, custom appended
    expect(keys(schema).slice(0, DEFAULT_ONLINE_REG.length)).toEqual(keys(DEFAULT_ONLINE_REG));
    expect(keys(schema).at(-1)).toBe("school");
  });

  it("a custom field reusing a default key does not duplicate it", () => {
    const custom: EventField[] = [{ key: "stream", label: "Stream", type: "text" }];
    const schema = eventSchema(ev({ mode: "online", registration_schema: custom }));
    expect(keys(schema).filter((k) => k === "stream")).toHaveLength(1);
  });
});

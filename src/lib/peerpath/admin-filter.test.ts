import { describe, expect, it } from "vitest";
import { filterAdminByCampus, parseCampus } from "./admin-filter";
import type { AdminBooking, AdminData, Feedback, SeniorPrivate } from "./types";

const senior = (id: string, campus: "Pune" | "Gurugram") => ({ id, campus, firstName: id, status: "active" }) as unknown as SeniorPrivate;
const booking = (id: string, seniorId: string) => ({ id, seniorId, status: "confirmed" }) as unknown as AdminBooking;
const fb = (rating: number) => ({ rating }) as unknown as Feedback;

function fixture(): AdminData {
  return {
    seniors: [senior("p1", "Pune"), senior("g1", "Gurugram"), senior("p2", "Pune")],
    // start_at desc, mixed campuses
    bookings: [booking("b1", "p1"), booking("b2", "g1"), booking("b3", "p2"), booking("b4", "g1"), booking("b5", "p1")],
    feedback: { b1: fb(5), b2: fb(4), b4: fb(1) },
    rules: { p1: [], g1: [], p2: [] },
    blocks: { p1: [], g1: [], p2: [] },
    settings: {
      p1: { dailyCap: 1 } as AdminData["settings"][string],
      g1: { dailyCap: 2 } as AdminData["settings"][string],
      p2: { dailyCap: 3 } as AdminData["settings"][string],
    },
  };
}

describe("parseCampus", () => {
  it("accepts the exact campus names", () => {
    expect(parseCampus("Pune")).toBe("Pune");
    expect(parseCampus("Gurugram")).toBe("Gurugram");
  });
  it("rejects lowercase and other spellings", () => {
    expect(parseCampus("pune")).toBeNull();
    expect(parseCampus("GURUGRAM")).toBeNull();
    expect(parseCampus(" Pune")).toBeNull();
  });
  it("rejects arrays", () => {
    expect(parseCampus(["Pune"])).toBeNull();
    expect(parseCampus(["Pune", "Gurugram"])).toBeNull();
  });
  it("rejects junk", () => {
    expect(parseCampus("<script>")).toBeNull();
    expect(parseCampus("Both")).toBeNull();
    expect(parseCampus(42)).toBeNull();
    expect(parseCampus({})).toBeNull();
  });
  it("rejects empty and undefined", () => {
    expect(parseCampus("")).toBeNull();
    expect(parseCampus(undefined)).toBeNull();
    expect(parseCampus(null)).toBeNull();
  });
});

describe("filterAdminByCampus", () => {
  it("returns the same object when there is no campus", () => {
    const d = fixture();
    expect(filterAdminByCampus(d, null)).toBe(d);
  });

  it("keeps only Pune", () => {
    const r = filterAdminByCampus(fixture(), "Pune");
    expect(r.seniors.map((s) => s.id)).toEqual(["p1", "p2"]);
    expect(r.bookings.map((b) => b.id)).toEqual(["b1", "b3", "b5"]);
  });

  it("keeps only Gurugram", () => {
    const r = filterAdminByCampus(fixture(), "Gurugram");
    expect(r.seniors.map((s) => s.id)).toEqual(["g1"]);
    expect(r.bookings.map((b) => b.id)).toEqual(["b2", "b4"]);
  });

  it("drops a booking whose senior is missing", () => {
    const d = fixture();
    d.bookings.push(booking("orphan", "ghost"));
    expect(filterAdminByCampus(d, "Pune").bookings.map((b) => b.id)).not.toContain("orphan");
    expect(filterAdminByCampus(d, "Gurugram").bookings.map((b) => b.id)).not.toContain("orphan");
  });

  it("feedback follows the kept bookings", () => {
    const d = fixture();
    expect(Object.keys(filterAdminByCampus(d, "Pune").feedback)).toEqual(["b1"]);
    expect(Object.keys(filterAdminByCampus(d, "Gurugram").feedback).sort()).toEqual(["b2", "b4"]);
  });

  it("rules, blocks and settings follow the kept seniors", () => {
    const r = filterAdminByCampus(fixture(), "Pune");
    expect(Object.keys(r.rules)).toEqual(["p1", "p2"]);
    expect(Object.keys(r.blocks)).toEqual(["p1", "p2"]);
    expect(Object.keys(r.settings)).toEqual(["p1", "p2"]);
    expect(r.settings.p2.dailyCap).toBe(3);
  });

  it("a campus with no seniors gives empty lists and does not crash", () => {
    const d = fixture();
    d.seniors = d.seniors.filter((s) => s.campus === "Pune");
    d.bookings = d.bookings.filter((b) => b.seniorId !== "g1");
    d.feedback = { b1: fb(5) };
    delete d.rules.g1;
    delete d.blocks.g1;
    delete d.settings.g1;
    const r = filterAdminByCampus(d, "Gurugram");
    expect(r.seniors).toEqual([]);
    expect(r.bookings).toEqual([]);
    expect(r.feedback).toEqual({});
    expect(r.rules).toEqual({});
    expect(r.blocks).toEqual({});
    expect(r.settings).toEqual({});
  });

  it("keeps the original order", () => {
    const d = fixture();
    const r = filterAdminByCampus(d, "Pune");
    const ids = r.bookings.map((b) => b.id);
    expect(ids).toEqual(d.bookings.map((b) => b.id).filter((id) => ids.includes(id)));
  });

  it("does not change the input", () => {
    const d = fixture();
    const before = JSON.stringify(d);
    filterAdminByCampus(d, "Pune");
    expect(JSON.stringify(d)).toBe(before);
  });
});

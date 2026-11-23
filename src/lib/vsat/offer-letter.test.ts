import { describe, expect, it } from "vitest";
import { CAMPUS_LETTER, SEASON, campusKey, inr, letterFileName, letterNumbers, offerDays } from "./offer-letter";
import { buildOfferLetterPdf } from "./offer-letter-pdf";

const PUNE = CAMPUS_LETTER.pune;
const GGN = CAMPUS_LETTER.gurugram;

describe("offer letter · fee numbers", () => {
  it("Pune 20% (sample letter): ₹3,70,000 in all, ₹92,500 in Year 1, ₹46,250 off each semester", () => {
    const n = letterNumbers(PUNE, { pct: 20, programmeFee: 1850000, seatBlock: 50000, days: 2 });
    expect(n.totalScholarship).toBe(370000);
    expect(n.year1Scholarship).toBe(92500);
    expect(n.payableTotal).toBe(1480000);
    expect(n.rows).toHaveLength(10);
    expect(n.rows[0]).toEqual({ label: "Seat Blocking Amount", fee: 50000, scholarship: null, payable: 50000, due: "2 days from the date of issue of Acceptance Letter" });
    expect(n.rows[1]).toMatchObject({ label: "Refundable Security Deposit", fee: 30000, scholarship: null, due: "Jul 26, 2027" });
    for (const r of n.rows.slice(2)) expect([r.fee, r.scholarship, r.payable]).toEqual([221250, 46250, 175000]);
    // the rows add up to the programme fee before and after the scholarship
    expect(n.rows.reduce((a, r) => a + r.fee, 0)).toBe(1850000);
    expect(n.rows.reduce((a, r) => a + r.payable, 0)).toBe(n.payableTotal);
  });

  it("Gurugram 40% (sample letter): ₹7,20,000 in all, ₹1,80,000 in Year 1, the letter's own semester amounts", () => {
    const n = letterNumbers(GGN, { pct: 40, programmeFee: 1800000, seatBlock: 50000, days: 5 });
    expect(n.totalScholarship).toBe(720000);
    expect(n.year1Scholarship).toBe(180000);
    expect(n.payableTotal).toBe(1080000);
    expect(n.rows[2]).toMatchObject({ label: "Semester 1", fee: 264813, scholarship: 90000, payable: 174813 });
    expect(n.rows[9]).toMatchObject({ label: "Semester 8", fee: 219313, scholarship: 90000, payable: 129313, due: "Nov 15, 2030" });
    expect(n.rows[0].due).toBe("5 days from the date of issue of Acceptance Letter");
  });

  it("odd amounts: whole rupees, the spare rupees on the first semesters, the sum is exact", () => {
    const n = letterNumbers(PUNE, { pct: 37.5, programmeFee: 1850000, seatBlock: 50000, days: 2 });
    const sch = n.rows.slice(2).map((r) => r.scholarship as number);
    expect(n.totalScholarship).toBe(693750);
    expect(sch.reduce((a, b) => a + b, 0)).toBe(693750);
    expect(sch).toEqual([86719, 86719, 86719, 86719, 86719, 86719, 86718, 86718]);
    expect(n.year1Scholarship).toBe(173438);
    expect(sch.every(Number.isInteger)).toBe(true);
  });

  it("no scholarship, too much scholarship and bad input never give odd numbers", () => {
    expect(letterNumbers(PUNE, { pct: 0, programmeFee: 1850000, seatBlock: 50000, days: 2 }).totalScholarship).toBe(0);
    const full = letterNumbers(GGN, { pct: 100, programmeFee: 1800000, seatBlock: 50000, days: 5 });
    for (const r of full.rows.slice(2)) expect(r.payable).toBeGreaterThanOrEqual(0); // never more than the semester fee
    expect(letterNumbers(PUNE, { pct: 150, programmeFee: 1850000, seatBlock: 50000, days: 2 }).pct).toBe(100);
    expect(letterNumbers(PUNE, { pct: -5, programmeFee: 1850000, seatBlock: 50000, days: 2 }).totalScholarship).toBe(0);
    expect(letterNumbers(PUNE, { pct: "20", programmeFee: "1850000", seatBlock: null, days: 1 }).rows[0]).toMatchObject({ fee: 50000, due: "1 day from the date of issue of Acceptance Letter" });
    expect(letterNumbers(PUNE, { pct: null, programmeFee: 1850000, seatBlock: 50000, days: 2 }).totalScholarship).toBe(0);
  });

  it("season data lines up with the campus rows (class of 2027)", () => {
    expect(SEASON.classOf).toBe(2027);
    expect(SEASON.feeYears).toBe("2027 - 2031");
    expect(SEASON.semesterDue[0]).toBe("Jul 26, 2027");
    expect(SEASON.semesterDue).toHaveLength(8);
    expect(PUNE.semesters).toHaveLength(8);
    expect(GGN.semesters).toHaveLength(8);
  });
});

describe("offer letter · helpers", () => {
  it("Indian grouping", () => {
    expect(inr(1850000)).toBe("18,50,000");
    expect(inr(221250)).toBe("2,21,250");
    expect(inr(92500)).toBe("92,500");
  });
  it("days the offer is valid (IST calendar days, deadline 11:59 pm IST)", () => {
    // released 23 Nov 2026 3:30 pm IST, deadline 25 Nov 2026 11:59:59 pm IST
    expect(offerDays("2026-11-23T10:00:00Z", "2026-11-25T18:29:59Z", 9)).toBe(2);
    // released 23 Nov 11:50 pm IST (18:20 UTC) still counts from 23 Nov
    expect(offerDays("2026-11-23T18:20:00Z", "2026-11-28T18:29:59Z", 9)).toBe(5);
    expect(offerDays(null, "2026-11-28T18:29:59Z", 5)).toBe(5);
    expect(offerDays("2026-11-28T18:29:59Z", "2026-11-23T10:00:00Z", 5)).toBe(5);
  });
  it("campus key and file name", () => {
    expect(campusKey("Ajeenkya DY Patil University — Pune")).toBe("pune");
    expect(campusKey("gurugram")).toBe("gurugram");
    expect(campusKey("Sushant University — Gurgaon")).toBe("gurugram");
    expect(campusKey("Mumbai")).toBeNull();
    expect(letterFileName("LABANA PRINCEKUMAR NARENDRASING")).toBe("Acceptance_Letter_LABANA_PRINCEKUMAR_NARENDRASING.pdf");
    expect(letterFileName("  Vedika  ")).toBe("Acceptance_Letter_Vedika.pdf");
    expect(letterFileName("../../etc/passwd")).toBe("Acceptance_Letter_etc_passwd.pdf");
    expect(letterFileName(null)).toBe("Acceptance_Letter.pdf");
  });
});

describe("offer letter · PDF", () => {
  it("builds a 4-page A4 PDF for both campuses, with and without a scholarship", async () => {
    for (const [campus, pct] of [["pune", 20], ["gurugram", 40], ["pune", 0]] as const) {
      const pdf = await buildOfferLetterPdf({ name: "Ravi Kumar", campus, pct, programmeFee: campus === "pune" ? 1850000 : 1800000, seatBlock: 50000, days: 2, dashboardLink: "https://one.vedam.org/apply/dashboard" });
      const s = pdf.toString("latin1");
      expect(s.startsWith("%PDF-")).toBe(true);
      expect(s).toMatch(/\/Type \/Pages[\s\S]*?\/Count 4/);
      expect(s).toContain("/URI (https://one.vedam.org/apply/dashboard)");
      expect(s).toContain("NunitoSans");
      expect(pdf.length).toBeLessThan(400_000);
    }
  }, 30_000);
});

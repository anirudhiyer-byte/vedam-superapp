/**
 * SAMPLE DATA for the PeerPath admin dashboard — staging / preview only.
 *
 * Shown only at /peerpath/talk-to-senior/admin?demo=1, only to admins, and never when VERCEL_ENV is
 * "production" (see allowDemo). Nothing here is written to any database. Every name and number is made up.
 *
 * REMOVE BEFORE PRODUCTION: delete this file and the lines marked "SAMPLE DATA" in
 * src/app/(shell)/peerpath/talk-to-senior/admin/page.tsx (tracked in the PR description).
 */
import type { Campus, Topic, Year } from "./constants";
import type { AdminBooking, AdminData, AdminInsights, AvailabilityRule, BookingStatus, Feedback, ImpactRange, SeniorPrivate } from "./types";

const H = 3_600_000;
const D = 24 * H;
const IST = 330 * 60_000;

/** Sample data is allowed outside production only. */
export const allowDemo = (vercelEnv: string | undefined) => vercelEnv !== "production";

/** Small seeded random number generator, so the sample looks the same on every load. */
function rng(seed: number) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Seed = [name: string, campus: Campus, year: Year, topics: Topic[], languages: string[], rules: [number, string, string][], cap: number, status: SeniorPrivate["status"], seenDaysAgo: number];
const SEEDS: Seed[] = [
  ["Aarav", "Pune", 2, ["VSAT prep", "Interview prep", "Campus life"], ["English", "Hindi", "Marathi"], [[1, "18:00", "21:00"], [3, "18:00", "21:00"]], 4, "active", 0],
  ["Riya", "Pune", 2, ["Curriculum", "Open source", "VSAT prep"], ["English", "Hindi"], [[2, "19:00", "21:00"], [6, "10:00", "12:00"]], 3, "active", 1],
  ["Kabir", "Pune", 2, ["Hackathons", "Internships"], ["English", "Hindi"], [[4, "20:00", "22:00"], [0, "16:00", "17:00"]], 3, "active", 2],
  ["Ishita", "Pune", 2, ["Campus life", "Hostel & mess", "Moving to a new city"], ["English", "Hindi", "Bengali"], [[1, "17:00", "19:00"], [5, "18:00", "21:00"]], 5, "active", 0],
  ["Dev", "Pune", 2, ["Placements", "Internships", "Interview prep"], ["English", "Tamil"], [[6, "11:00", "13:00"]], 2, "active", 9],
  ["Meera", "Gurugram", 1, ["Campus life", "VSAT prep", "Hostel & mess"], ["English", "Hindi", "Punjabi"], [[2, "18:00", "20:00"], [4, "18:00", "21:00"]], 4, "active", 1],
  ["Arjun", "Gurugram", 1, ["Curriculum", "Hackathons"], ["English", "Hindi"], [[3, "19:00", "22:00"]], 3, "active", 3],
  ["Sana", "Gurugram", 1, ["VSAT prep", "Moving to a new city"], ["English", "Hindi", "Telugu"], [], 2, "active", 19],
  ["Neel", "Gurugram", 1, ["Open source", "Internships"], ["English", "Gujarati"], [], 3, "pending", 4],
];

const hex = (r: () => number, n: number) => Array.from({ length: n }, () => Math.floor(r() * 16).toString(16)).join("");
const uuid = (r: () => number) => `${hex(r, 8)}-${hex(r, 4)}-4${hex(r, 3)}-a${hex(r, 3)}-${hex(r, 12)}`;
const iso = (t: number) => new Date(t).toISOString();

/** A made-up AdminData set: 9 seniors and about 4 months of chats, growing over time and evening-heavy. */
export function demoAdminData(now: number): AdminData {
  const r = rng(20261125);
  const seniors: SeniorPrivate[] = [];
  const rules: AdminData["rules"] = {};
  const settings: AdminData["settings"] = {};
  for (const [i, [firstName, campus, year, topics, languages, rs, cap, status, seen]] of SEEDS.entries()) {
    const id = uuid(r);
    seniors.push({
      id,
      firstName,
      photoUrl: null,
      campus,
      year,
      homeCity: null,
      homeState: null,
      residence: null,
      languages,
      topics,
      askMeAbout: [],
      clubs: [],
      bio: "Sample senior for the admin dashboard preview.",
      sessionTypes: ["1:1", "Group"],
      durations: [30],
      rating: null,
      ratingCount: 0,
      sessionsDone: 0,
      status,
      meetLink: i === 6 ? null : "https://meet.google.com/sample-demo",
      contactEmail: `sample+${i}@example.com`,
      createdAt: iso(now - 150 * D),
      lastActiveAt: iso(now - seen * D - 2 * H),
      token: `sample-${hex(r, 16)}`,
    });
    rules[id] = rs.map(([weekday, from, to]): AvailabilityRule => ({ weekday, from, to, type: "1:1" }));
    settings[id] = { dailyCap: 2, weeklyCap: cap, minNoticeHours: 6, paused: false };
  }
  const live = seniors.filter((s) => s.status === "active");
  const slots = [10, 11, 12.5, 14, 16, 17.5, 18, 18.5, 19, 19.5, 20, 20.5, 21, 21.5, 22];
  const bookings: AdminBooking[] = [];
  const feedback: Record<string, Feedback> = {};
  const midnight = Math.floor((now + IST) / D) * D - IST;
  for (let day = 120; day >= -6; day--) {
    const n = Math.max(0, Math.round(0.5 + (120 - day) / 80 + r() * 2.4 - 0.7));
    for (let k = 0; k < n; k++) {
      const s = live[Math.floor(Math.pow(r(), 1.3) * live.length)];
      if ((rules[s.id]?.length ?? 0) === 0 && r() < 0.85) continue;
      const start = midnight - day * D + slots[Math.floor(r() * slots.length)] * H;
      const end = start + 30 * 60_000;
      const x = r();
      let status: BookingStatus;
      if (start > now) status = x < 0.92 ? "confirmed" : "cancelled";
      else status = x < 0.72 ? "completed" : x < 0.82 ? "no_show_applicant" : x < 0.92 ? "cancelled" : x < 0.96 ? "rescheduled" : "confirmed";
      const id = uuid(r);
      const over = end < now && (status === "completed" || status === "confirmed");
      const auto: AdminBooking["autoResult"] = over ? (status === "confirmed" ? "needs_marking" : r() < 0.8 ? "completed" : "needs_marking") : null;
      bookings.push({
        id,
        seniorId: s.id,
        start: iso(start),
        end: iso(end),
        type: r() < 0.86 ? "1:1" : "Group",
        name: "Sample applicant",
        email: "sample@example.com",
        phone: null,
        question: null,
        status,
        meetUrl: null,
        movedFrom: null,
        movedTo: null,
        createdAt: iso(start - (6 + Math.pow(r(), 1.6) * 140) * H),
        meetSync: status === "confirmed" && start > now && r() < 0.08 ? "failed" : "ok",
        meetError: null,
        autoResult: auto,
        attendance: over ? { people: 2, overlapMin: Math.round(14 + r() * 22), reason: null } : null,
      });
      if (status === "completed" && r() < 0.62) {
        const bad = s.firstName === "Kabir" ? 0.45 : 0.08;
        const rating = r() < bad ? (r() < 0.5 ? 2 : 3) : r() < 0.62 ? 5 : 4;
        feedback[id] = { rating, recommend: rating >= 4 ? r() < 0.93 : r() < 0.3, promiseMade: r() < 0.025, note: null, createdAt: iso(end + 2 * H) };
      }
    }
  }
  bookings.sort((a, b) => Date.parse(b.start) - Date.parse(a.start));
  return { seniors, rules, blocks: {}, settings, bookings, feedback };
}

/** Made-up Impact numbers in the pp_admin_insights shape, per campus filter. */
export function demoInsights(): Record<"All" | Campus, AdminInsights> {
  const range = (k: number): ImpactRange => {
    const people = Math.round(58 * k);
    const booked = Math.round(31 * k);
    const applicants = Math.round(24 * k);
    const paidAfter = Math.round(applicants * 0.44);
    const paidBefore = Math.round(applicants * 0.18);
    return {
      demand: {
        attempts: Math.round(people * 1.6),
        people,
        booked: Math.round(booked * 1.1),
        people_booked: booked,
        blocked: {
          NOT_REGISTERED: { people: Math.round(9 * k), attempts: Math.round(14 * k) },
          SLOT_UNAVAILABLE: { people: Math.round(7 * k), attempts: Math.round(9 * k) },
          PAYMENT_PENDING: { people: Math.round(5 * k), attempts: Math.round(8 * k) },
          NOT_LOGGED_IN: { people: Math.round(4 * k), attempts: Math.round(4 * k) },
          EMAIL_MISSING: { people: Math.round(2 * k), attempts: Math.round(3 * k) },
          LIMIT_REACHED: { people: Math.round(1.5 * k), attempts: Math.round(2 * k) },
          INVALID: { people: Math.round(1 * k), attempts: Math.round(1 * k) },
        },
      },
      outcome: {
        applicants,
        paid_before: paidBefore,
        paid_after: paidAfter,
        not_paid: applicants - paidAfter - paidBefore,
        enrolled: Math.round(applicants * 0.2),
        enrolled_after: Math.round(applicants * 0.17),
        median_days_to_pay: paidAfter ? 3.5 : null,
        median_days_to_enroll: paidAfter ? 11.2 : null,
      },
    };
  };
  const make = (f: number): AdminInsights => ({ mode: "registered", ranges: { "7": range(0.28 * f), "30": range(1 * f), "90": range(2.4 * f) } });
  return { All: make(1), Pune: make(0.62), Gurugram: make(0.38) };
}

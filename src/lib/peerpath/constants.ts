/**
 * Option lists for filters and forms. These are the product's fixed choices,
 * not sample data: real seniors, slots and bookings come from the data layer.
 */

export const CAMPUSES = ["Pune", "Gurugram"] as const;
export type Campus = (typeof CAMPUSES)[number];

export const CAMPUS_INFO: Record<Campus, { university: string; image: string; city: string }> = {
  Pune: { university: "Ajeenkya DY Patil University", image: "/peerpath/campus-pune.webp", city: "Pune" },
  Gurugram: { university: "Sushant University", image: "/peerpath/campus-gurugram.webp", city: "Gurugram" },
};

export const TOPICS = [
  "VSAT prep",
  "Interview prep",
  "Curriculum",
  "Campus life",
  "Hackathons",
  "Open source",
  "Internships",
  "Placements",
  "Hostel & mess",
  "Moving to a new city",
] as const;
export type Topic = (typeof TOPICS)[number];

export const CLUBS = ["Competitive Coding", "ICPC", "Open Source", "Entrepreneurship", "Cultural"] as const;

export const LANGUAGES = [
  "English",
  "Hindi",
  "Marathi",
  "Bengali",
  "Gujarati",
  "Punjabi",
  "Tamil",
  "Telugu",
  "Kannada",
  "Malayalam",
  "Odia",
  "Assamese",
] as const;

export const YEARS = [1, 2, 3, 4] as const;
export type Year = (typeof YEARS)[number];

export const SESSION_TYPES = ["1:1", "Group"] as const;
export type SessionType = (typeof SESSION_TYPES)[number];

export const DURATIONS = [15, 30] as const;
export type Duration = (typeof DURATIONS)[number];

export const RESIDENCE = ["Hostel", "Day scholar"] as const;
export type Residence = (typeof RESIDENCE)[number];

export const TIME_OF_DAY = [
  { id: "morning", label: "Morning", hint: "before 12 PM", from: 0, to: 12 },
  { id: "afternoon", label: "Afternoon", hint: "12–5 PM", from: 12, to: 17 },
  { id: "evening", label: "Evening", hint: "after 5 PM", from: 17, to: 24 },
] as const;
export type TimeOfDay = (typeof TIME_OF_DAY)[number]["id"];

export const STATES = [
  "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh", "Goa", "Gujarat",
  "Haryana", "Himachal Pradesh", "Jharkhand", "Karnataka", "Kerala", "Madhya Pradesh",
  "Maharashtra", "Manipur", "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Punjab", "Rajasthan",
  "Sikkim", "Tamil Nadu", "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal",
  "Andaman and Nicobar Islands", "Chandigarh", "Dadra and Nagar Haveli and Daman and Diu",
  "Delhi", "Jammu and Kashmir", "Ladakh", "Lakshadweep", "Puducherry",
] as const;

/** Booking rules (defaults; a senior can be stricter, never looser). */
export const BOOKING_RULES = {
  timeZone: "Asia/Kolkata",
  slotStepMinutes: 30,
  bufferMinutes: 10,
  minNoticeHours: 12,
  windowDays: 14,
  lateCancelHours: 3,
  maxUpcomingPerApplicant: 2,
  defaultDailyCap: 2,
  defaultWeeklyCap: 4,
  groupCapacity: 8,
} as const;

/**
 * Meet automation rules. A chat counts as done when at least two people were in
 * the Meet together for `minOverlapMinutes`. Anything less is flagged for the
 * senior/admin to mark; a senior no-show is never set automatically.
 */
export const MEET_RULES = {
  minOverlapMinutes: 5,
  /** people in the call for less than this are ignored (a wrong click, a quick test) */
  minPresenceMinutes: 1,
  /** wait this long after a chat ends before reading attendance */
  checkAfterMinutes: 10,
  /** if Meet has no record at all this long after the end, flag it */
  noRecordFlagHours: 2,
  /** stop trying to create a calendar event after this many failures */
  maxSyncAttempts: 5,
  /** stop reading attendance after this many failed tries */
  maxCheckAttempts: 12,
} as const;

export const ADMISSIONS_URL =process.env.NEXT_PUBLIC_ADMISSIONS_URL || "https://www.vedam.org";

/** Where Talk to a Senior lives inside the superapp. */
export const TTS = "/peerpath/talk-to-senior";
export const ttsPath = {
  home: TTS,
  senior: (id: string, reschedule?: string) => `${TTS}/seniors/${id}${reschedule ? `?r=${reschedule}` : ""}`,
  book: (q: URLSearchParams) => `${TTS}/book?${q.toString()}`,
  booked: (id: string) => `${TTS}/booked/${id}`,
  feedback: (id: string) => `${TTS}/feedback/${id}`,
  guidelines: `${TTS}/guidelines`,
  my: `${TTS}/my`,
  join: `${TTS}/become-a-senior`,
  portal: (token: string) => `${TTS}/senior/${token}`,
  admin: `${TTS}/admin`,
};

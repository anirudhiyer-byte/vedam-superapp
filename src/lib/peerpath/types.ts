import type { Campus, Duration, Residence, SessionType, Topic, Year } from "@/lib/peerpath/constants";

export type SeniorStatus = "pending" | "active" | "paused";

/** A senior as applicants see them. Only first name and city/state are public. */
export type Senior = {
  id: string;
  firstName: string;
  photoUrl: string | null;
  campus: Campus;
  year: Year;
  homeCity: string | null;
  homeState: string | null;
  residence: Residence | null;
  languages: string[];
  topics: Topic[];
  askMeAbout: string[];
  clubs: string[];
  bio: string;
  sessionTypes: SessionType[];
  durations: Duration[];
  rating: number | null;
  ratingCount: number;
  sessionsDone: number;
  status: SeniorStatus;
};

export type Slot = {
  seniorId: string;
  /** ISO timestamps (UTC) */
  start: string;
  end: string;
  type: SessionType;
  duration: Duration;
  /** group sessions only */
  seatsLeft: number | null;
};

export type SeniorWithSlots = Senior & { slots: Slot[] };

/** Weekly recurring availability, set by the senior. weekday: 0 = Sunday. Times in IST, "HH:MM". */
export type AvailabilityRule = {
  weekday: number;
  from: string;
  to: string;
  type: SessionType;
};

export type DateBlock = {
  /** YYYY-MM-DD (IST) */
  from: string;
  to: string;
  reason: string | null;
};

export type SeniorSettings = {
  dailyCap: number;
  weeklyCap: number;
  minNoticeHours: number;
  paused: boolean;
};

export type BookingStatus = "confirmed" | "completed" | "cancelled" | "rescheduled" | "no_show_applicant";

/** A booking as the applicant sees it (from pp_bookings_by_ids / pp_find_bookings). */
export type Booking = {
  id: string;
  seniorId: string;
  start: string;
  end: string;
  type: SessionType;
  name: string;
  email: string;
  phone: string;
  question: string | null;
  status: BookingStatus;
  meetUrl: string | null;
  movedFrom: string | null;
  movedTo: string | null;
  createdAt: string;
  feedbackGiven: boolean;
  senior: { id: string; firstName: string; campus: Campus; year: Year; status: SeniorStatus };
};

/** A booking as the senior sees it in their portal (no applicant contact details). */
export type PortalBooking = {
  id: string;
  seniorId: string;
  start: string;
  end: string;
  type: SessionType;
  name: string;
  question: string | null;
  status: BookingStatus;
  rating: number | null;
};

/** Private senior fields, shown only to that senior and to admins. */
export type SeniorPrivate = Senior & {
  meetLink: string | null;
  contactEmail: string;
  createdAt: string;
  lastActiveAt: string | null;
  token?: string;
};

export type SeniorPortal = {
  senior: SeniorPrivate;
  rules: AvailabilityRule[];
  blocks: DateBlock[];
  settings: SeniorSettings;
  bookings: PortalBooking[];
};

/** Fields a senior edits about themselves. */
export type SeniorProfileInput = {
  firstName: string;
  campus: Campus;
  year: Year;
  homeCity: string | null;
  homeState: string | null;
  residence: Residence | null;
  languages: string[];
  topics: Topic[];
  askMeAbout: string[];
  clubs: string[];
  bio: string;
  sessionTypes: SessionType[];
  durations: Duration[];
  meetLink: string | null;
  contactEmail: string;
};

export type AdminBooking = {
  id: string;
  seniorId: string;
  start: string;
  end: string;
  type: SessionType;
  name: string;
  email: string;
  phone: string;
  question: string | null;
  status: BookingStatus;
  meetUrl: string | null;
  movedFrom: string | null;
  movedTo: string | null;
  createdAt: string;
};

export type Feedback = {
  rating: number;
  recommend: boolean;
  promiseMade: boolean;
  note: string | null;
  createdAt: string;
};

export type AdminData = {
  seniors: SeniorPrivate[];
  rules: Record<string, AvailabilityRule[]>;
  blocks: Record<string, DateBlock[]>;
  settings: Record<string, SeniorSettings>;
  bookings: AdminBooking[];
  feedback: Record<string, Feedback>;
};

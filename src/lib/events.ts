/** Events domain types + helpers, ported from vedam-events and re-fit for the superapp. */

export type FieldType =
  | "text" | "phone" | "number" | "email" | "textarea"
  | "dropdown" | "multiselect" | "checkbox";

export type EventField = {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  options?: string[];
  placeholder?: string;
};

export type ScheduleDay = { date?: string; slots?: { start?: string; end?: string }[] };

export type EventRow = {
  id: string;
  event_code: string;
  slug: string | null;
  category: string | null;
  name: string;
  host: string | null;
  blurb: string | null;
  details: string | null;
  mode: "online" | "offline";
  starts_at: string | null;
  duration_minutes: number | null;
  platform: string | null;
  join_link: string | null;
  zoom_id: string | null;
  zoom_passcode: string | null;
  venue: string | null;
  map_link: string | null;
  schedule: ScheduleDay[] | null;
  banner_url: string | null;
  whatsapp_community_url: string | null;
  max_attendees: number | null;
  reg_close_at: string | null;
  ribbon_label: string | null;
  ribbon_value: string | null;
  status: string;
  registration_schema: EventField[] | null;
  listing_extra: EventField[] | null;
  created_at: string;
};

export const DEFAULT_ONLINE_REG: EventField[] = [
  { key: "whatsapp", label: "WhatsApp number", type: "phone", required: true, placeholder: "10-digit number" },
  { key: "passout_year", label: "Class 12 passout year", type: "dropdown", required: true, options: ["2024", "2025", "2026", "2027", "2028"] },
  { key: "stream", label: "Class 12 stream", type: "dropdown", required: true, options: ["PCM", "PCB", "PCMB"] },
];

export const DEFAULT_OFFLINE_REG: EventField[] = [
  { key: "whatsapp", label: "WhatsApp number", type: "phone", required: true, placeholder: "10-digit number" },
  { key: "perm_city", label: "Permanent location (city)", type: "text", required: true },
  { key: "curr_city", label: "Current location (city)", type: "text", required: true },
  { key: "passout_year", label: "Year of passing 12th", type: "dropdown", required: true, options: ["Before 2025", "2025", "2026", "2027", "2028"] },
  { key: "stream", label: "Stream in 12th", type: "dropdown", required: true, options: ["PCM", "PCB", "PCMB"] },
];

export const isOffline = (e: Pick<EventRow, "mode">) => e.mode === "offline";

export function eventSchema(e: EventRow): EventField[] {
  if (e.registration_schema && e.registration_schema.length) return e.registration_schema;
  return isOffline(e) ? DEFAULT_OFFLINE_REG : DEFAULT_ONLINE_REG;
}

/** Accent colour per category (used when an event has no banner image). */
const CATEGORY_COLOR: Record<string, string> = {
  Workshop: "#F97D03",
  Webinar: "#8A18FF",
  Bootcamp: "#E80074",
  Meetup: "#00CFE5",
  Default: "#2B135C",
};
export const categoryColor = (c: string | null) => CATEGORY_COLOR[c || "Default"] || CATEGORY_COLOR.Default;

/* ---- IST display helpers ---- */
const IST = "Asia/Kolkata";

export function eventDateLabel(e: EventRow): string {
  if (isOffline(e) && e.schedule?.some((d) => d.date)) {
    const days = e.schedule.filter((d) => d.date).map((d) =>
      new Date(d.date + "T00:00:00+05:30").toLocaleDateString("en-IN", {
        timeZone: IST, day: "numeric", month: "short",
      })
    );
    return days.join(" · ");
  }
  if (!e.starts_at) return "Date TBA";
  return new Date(e.starts_at).toLocaleDateString("en-IN", {
    timeZone: IST, weekday: "short", day: "numeric", month: "short", year: "numeric",
  });
}

export function eventTimeLabel(e: EventRow): string {
  if (isOffline(e)) return e.venue || "Venue TBA";
  if (!e.starts_at) return e.platform || "Online";
  const t = new Date(e.starts_at).toLocaleTimeString("en-IN", {
    timeZone: IST, hour: "numeric", minute: "2-digit", hour12: true,
  });
  return `${t} IST${e.platform ? " · " + e.platform : ""}`;
}

/** True if registration is closed (past reg_close_at). */
export const regClosed = (e: EventRow) => !!e.reg_close_at && new Date(e.reg_close_at).getTime() < Date.now();

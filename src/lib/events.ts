/** Events domain types + helpers, ported from vedam-events and re-fit for the superapp. */

export type FieldType =
  | "text" | "phone" | "number" | "email" | "textarea"
  | "dropdown" | "multiselect" | "checkbox" | "date" | "time";

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
  require_signin: boolean;
  dashboard_enabled: boolean;
  featured: boolean;
  certs_enabled: boolean | null;
  podium_enabled: boolean | null;
  share_points_podium: number | null;
  share_points_participation: number | null;
  ribbon_label: string | null;
  ribbon_value: string | null;
  status: string;
  registration_schema: EventField[] | null;
  listing_extra: EventField[] | null;
  points_config: PointsConfig | null;
  zoom_meeting_id: string | null;
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

/* ---- Admin builder constants ---- */
export const FIELD_TYPES: { v: FieldType; label: string }[] = [
  { v: "text", label: "Short text" },
  { v: "textarea", label: "Long text" },
  { v: "number", label: "Number" },
  { v: "phone", label: "Phone" },
  { v: "email", label: "Email" },
  { v: "dropdown", label: "Dropdown (choose one)" },
  { v: "multiselect", label: "Checkboxes (choose many)" },
  { v: "checkbox", label: "Single checkbox (yes/no)" },
  { v: "date", label: "Date" },
  { v: "time", label: "Time" },
];

export const NEEDS_OPTIONS = (t: FieldType) => t === "dropdown" || t === "multiselect";

export const CATEGORIES = ["Workshop", "Webinar", "Bootcamp", "Meetup", "Masterclass", "Other"];

export const slugify = (s: string) =>
  String(s || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);

/** Lock keys: existing keys stay; new fields derive a unique key from their label. */
export function normalizeSchema(fields: EventField[]): EventField[] {
  const taken = new Set<string>();
  return (fields || [])
    .filter((f) => (f.label || "").trim())
    .map((f) => {
      let key = (f.key || "").trim() || slugify(f.label) || "field";
      const base = key; let n = 2;
      while (taken.has(key)) key = `${base}_${n++}`;
      taken.add(key);
      return { ...f, key, options: NEEDS_OPTIONS(f.type) ? (f.options || []).map((o) => o.trim()).filter(Boolean) : [] };
    });
}


/* ---- Points / gamification ---- */
export type PointAction = "register" | "attend" | "attend_75" | "share_linkedin";
export type PointsConfig = Partial<Record<PointAction, number>>;

export const POINT_ACTIONS: { key: PointAction; label: string; short: string }[] = [
  { key: "register", label: "Registering", short: "Register" },
  { key: "attend", label: "Attending", short: "Attend" },
  { key: "attend_75", label: "Staying for 75% of it", short: "Stay 75%" },
  { key: "share_linkedin", label: "Sharing on LinkedIn", short: "Share on LinkedIn" },
];

export const ACTION_LABEL: Record<string, string> = {
  register: "Registered", attend: "Attended", attend_75: "Stayed for 75%", share_linkedin: "Shared on LinkedIn",
};

/** Non-zero point rewards for an event, in display order. */
export function pointsLine(cfg: PointsConfig | null): { short: string; pts: number }[] {
  if (!cfg) return [];
  return POINT_ACTIONS.map((a) => ({ short: a.short, pts: Number(cfg[a.key] || 0) })).filter((x) => x.pts > 0);
}
export const pointsTotalPossible = (cfg: PointsConfig | null) =>
  pointsLine(cfg).reduce((s, x) => s + x.pts, 0);


/* ---- Certificates + LinkedIn sharing ---- */
export type CertKind = "participation" | "winner" | "completion";

export function linkedInShareUrl(certUrl: string): string {
  return `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(certUrl)}`;
}

/** Default, editable LinkedIn post text for a certificate. */
export function defaultShareText(eventName: string | null | undefined, kind: CertKind = "participation"): string {
  const ev = eventName || "a Vedam program";
  if (kind === "winner") {
    return `Thrilled to share that I won ${ev} at Vedam School of Technology! 🏆 Grateful for the experience and everything I learned. #Vedam #Winner #Learning`;
  }
  return `Excited to share that I participated in ${ev} with Vedam School of Technology! 🎓 A great learning experience. #Vedam #Learning #Growth`;
}


/** Day + short month for the card date-block (IST). */
export function eventDayMonth(e: EventRow): { day: string; month: string } {
  if (!e.starts_at) return { day: "—", month: "" };
  const d = new Date(e.starts_at);
  return {
    day: d.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit" }),
    month: d.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", month: "short" }).toUpperCase(),
  };
}

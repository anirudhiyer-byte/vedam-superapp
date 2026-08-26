/**
 * First-touch UTM capture. Stores the very first landing's UTM + referrer +
 * path in localStorage and never overwrites it, so attribution reflects where
 * the student originally came from. Read at signup and written to the profile.
 */
export type Utm = {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  referrer?: string;
  landing_path?: string;
};

const KEY = "vedam_utm";

export function captureUtm() {
  if (typeof window === "undefined") return;
  try {
    if (localStorage.getItem(KEY)) return; // first touch wins
    const p = new URLSearchParams(window.location.search);
    const data: Utm = {
      utm_source: p.get("utm_source") ?? undefined,
      utm_medium: p.get("utm_medium") ?? undefined,
      utm_campaign: p.get("utm_campaign") ?? undefined,
      referrer: document.referrer || undefined,
      landing_path: window.location.pathname || undefined,
    };
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // localStorage unavailable — skip silently
  }
}

export function readUtm(): Utm {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(KEY) || "{}") as Utm;
  } catch {
    return {};
  }
}

/**
 * First-touch UTM capture. Locks in the FIRST visit that actually carries UTM
 * params, so attribution reflects the real ad/source. A prior UTM-less visit
 * no longer blocks a later UTM visit from being recorded.
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
    const existing = readUtm();
    if (existing.utm_source) return; // real first-touch already locked in

    const p = new URLSearchParams(window.location.search);
    const src = p.get("utm_source") ?? undefined;
    const med = p.get("utm_medium") ?? undefined;
    const camp = p.get("utm_campaign") ?? undefined;

    // Nothing new to record and we already stored referrer/path — keep it.
    if (!src && !med && !camp && localStorage.getItem(KEY)) return;

    const data: Utm = {
      utm_source: src,
      utm_medium: med,
      utm_campaign: camp,
      referrer: existing.referrer || document.referrer || undefined,
      landing_path: existing.landing_path || window.location.pathname || undefined,
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

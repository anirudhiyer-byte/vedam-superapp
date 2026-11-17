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

const SEARCH = /(^|\.)(google|bing|yahoo|duckduckgo|ecosia|yandex|baidu|brave|ask)\./i;
const SOCIAL = /(^|\.)(facebook|fb|instagram|twitter|linkedin|youtube|youtu|reddit|pinterest|telegram|snapchat|tiktok|threads)\./i;
const SELF = /(^|\.)(vedam\.org|vercel\.app)$/i;

function refHost(referrer?: string): string {
  if (!referrer) return "";
  try { return new URL(referrer).hostname.replace(/^www\./, ""); } catch { return ""; }
}

/**
 * The source/medium/campaign to record for a lead. A real UTM always wins; otherwise
 * the first-touch referrer is classified so direct / organic / social / referral
 * traffic is never blank — so people who land on the VSAT / Vedam One page directly or
 * organically can still be segmented in dashboards. Pure (no storage/DOM access).
 */
export function utmForLead(u: Utm): { utm_source: string; utm_medium: string; utm_campaign?: string } {
  if (u.utm_source) return { utm_source: u.utm_source, utm_medium: u.utm_medium ?? "", utm_campaign: u.utm_campaign };
  const h = refHost(u.referrer);
  if (!h || SELF.test(h)) return { utm_source: "direct", utm_medium: "none" };
  const se = h.match(SEARCH); if (se) return { utm_source: se[2].toLowerCase(), utm_medium: "organic" };
  const so = h.match(SOCIAL); if (so) return { utm_source: so[2].toLowerCase(), utm_medium: "social" };
  return { utm_source: h, utm_medium: "referral" };
}

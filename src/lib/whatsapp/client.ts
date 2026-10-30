/** TrustSignal WhatsApp client (server-only). Base: https://wpapi.trustsignal.io/api
 *  api_key is a query param. Variables: sample.header + sample.bodyvar[] (in order). */
const DEFAULT_BASE = process.env.TRUSTSIGNAL_BASE_URL || "https://wpapi.trustsignal.io/api";
const key = () => process.env.TRUSTSIGNAL_API_KEY || "";
const sender = () => process.env.TRUSTSIGNAL_SENDER || "";

type Result = { ok: boolean; status: number; url: string; data: unknown };
export type WaSample = { header?: string; bodyvar?: string[]; button?: string[] };
export type SenderInfo = { number: string; label?: string };

/** Map of waba_id -> sender number (+ optional label), from env TRUSTSIGNAL_SENDERS (JSON).
 *  Value may be a plain number string or { number, label }. */
function sendersMap(): Record<string, SenderInfo> {
  const raw = (process.env.TRUSTSIGNAL_SENDERS || "").trim();
  if (!raw) return {};
  try {
    const o = JSON.parse(raw) as Record<string, string | SenderInfo>;
    const out: Record<string, SenderInfo> = {};
    for (const [k, v] of Object.entries(o)) out[k] = typeof v === "string" ? { number: v } : v;
    return out;
  } catch { return {}; }
}

/** Resolve which sender (WhatsApp number) a template's WABA should send from.
 *  Lookup order:
 *   1) a simple per-WABA var  TRUSTSIGNAL_SENDER_<wabaId> = "<number>"
 *   2) the optional JSON map  TRUSTSIGNAL_SENDERS
 *   3) the default single     TRUSTSIGNAL_SENDER
 */
export function senderInfoForWaba(wabaId?: string | null): SenderInfo {
  if (wabaId) {
    const perWaba = (process.env[`TRUSTSIGNAL_SENDER_${wabaId}`] || "").trim();
    if (perWaba) return { number: perWaba };
    const m = sendersMap();
    if (m[wabaId]) return m[wabaId];
  }
  return { number: sender() };
}
export function senderForWaba(wabaId?: string | null): string {
  return senderInfoForWaba(wabaId).number || sender();
}

async function call(url: string, init?: RequestInit): Promise<Result> {
  let res: Response;
  try { res = await fetch(url, init); }
  catch (e) { return { ok: false, status: 0, url, data: { error: String(e) } }; }
  const text = await res.text();
  let data: unknown; try { data = JSON.parse(text); } catch { data = { raw: text }; }
  return { ok: res.ok, status: res.status, url, data };
}

export async function waSendSingle(opts: {
  to: string; templateId: string; messageType?: string; sender?: string; wabaId?: string | null; sample?: WaSample; baseUrl?: string; path?: string;
}): Promise<Result> {
  const base = (opts.baseUrl || DEFAULT_BASE).replace(/\/$/, "");
  const path = opts.path || "/v1/whatsapp/single";
  const url = `${base}${path}?api_key=${encodeURIComponent(key())}`;
  const body: Record<string, unknown> = {
    message_type: opts.messageType || "text",
    // explicit sender wins; otherwise resolve from the template's WABA; finally the default sender
    sender: opts.sender || senderForWaba(opts.wabaId),
    to: opts.to,
    template_id: opts.templateId,
  };
  if (opts.sample && (opts.sample.header || opts.sample.bodyvar?.length || opts.sample.button?.length)) body.sample = opts.sample;
  return call(url, { method: "POST", headers: { "Content-Type": "application/json", accept: "*/*" }, body: JSON.stringify(body) });
}

export async function waCreateTemplate(payload: Record<string, unknown>, baseUrl?: string): Promise<Result> {
  const base = (baseUrl || DEFAULT_BASE).replace(/\/$/, "");
  const url = `${base}/v1/template?api_key=${encodeURIComponent(key())}`;
  const body = { waba_id: process.env.TRUSTSIGNAL_WABA_ID || "", shortlink: "1", ...payload };
  return call(url, { method: "POST", headers: { "Content-Type": "application/json", accept: "*/*" }, body: JSON.stringify(body) });
}

// short-lived cache so repeated opens don't re-hit TrustSignal (templates rarely change)
let _tplCache: { at: number; data: Result } | null = null;
const TPL_TTL_MS = 5 * 60_000;

/** List ALL approved+pending templates across every WABA on the account.
 *  Requests a large page size (one round-trip when honoured); if TrustSignal
 *  caps the page, remaining pages are fetched in parallel. Cached for TTL_MS. */
export async function waListTemplates(baseUrl?: string): Promise<Result> {
  if (_tplCache && Date.now() - _tplCache.at < TPL_TTL_MS) return _tplCache.data;
  const base = (baseUrl || DEFAULT_BASE).replace(/\/$/, "");
  const LIMIT = 1000; // ask for everything at once; API may cap (we adapt below)
  const pageUrl = (p: number) => `${base}/v1/template?api_key=${encodeURIComponent(key())}&page=${p}&limit=${LIMIT}`;
  const first = await call(pageUrl(1), { method: "GET" });
  const d0 = first.data as { templates?: unknown[]; totalrecords?: number } | undefined;
  if (!first.ok || !Array.isArray(d0?.templates)) return first; // don't cache failures
  const pageSize = d0!.templates!.length || LIMIT; // actual page size the API returned
  const total = Number(d0?.totalrecords ?? pageSize);
  const pages = Math.min(Math.ceil(total / Math.max(pageSize, 1)), 12); // safety cap
  const all: unknown[] = [...d0!.templates!];
  if (pages >= 2) {
    // fetch the remaining pages in parallel (sequential was slow)
    const rest = await Promise.all(
      Array.from({ length: pages - 1 }, (_, i) => call(pageUrl(i + 2), { method: "GET" })),
    );
    for (const r of rest) {
      const dd = r.data as { templates?: unknown[] } | undefined;
      if (r.ok && Array.isArray(dd?.templates)) all.push(...dd.templates);
    }
  }
  const out: Result = { ok: true, status: 200, url: first.url, data: { ...d0, templates: all, page: 1, limit: all.length, totalrecords: total } };
  _tplCache = { at: Date.now(), data: out };
  return out;
}

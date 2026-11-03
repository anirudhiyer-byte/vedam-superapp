/** TrustSignal WhatsApp client (server-only). Base: https://wpapi.trustsignal.io/api
 *  api_key is a query param. Variables: sample.header + sample.bodyvar[] (in order). */
const DEFAULT_BASE = process.env.TRUSTSIGNAL_BASE_URL || "https://wpapi.trustsignal.io/api";
const key = () => process.env.TRUSTSIGNAL_API_KEY || "";
const sender = () => process.env.TRUSTSIGNAL_SENDER || "";

type Result = { ok: boolean; status: number; url: string; data: unknown };
export type WaSample = { header?: string; bodyvar?: string[]; button?: string[] };

// never echo the API key back to the browser in the reported url
const maskKey = (u: string) => u.replace(/([?&]api_key=)[^&]*/i, "$1***");

async function call(url: string, init?: RequestInit): Promise<Result> {
  let res: Response;
  try { res = await fetch(url, init); }
  catch (e) { return { ok: false, status: 0, url: maskKey(url), data: { error: String(e) } }; }
  const text = await res.text();
  let data: unknown; try { data = JSON.parse(text); } catch { data = { raw: text }; }
  return { ok: res.ok, status: res.status, url: maskKey(url), data };
}

export async function waSendSingle(opts: {
  to: string; templateId: string; messageType?: string; sender?: string; sample?: WaSample; baseUrl?: string; path?: string;
}): Promise<Result> {
  const base = (opts.baseUrl || DEFAULT_BASE).replace(/\/$/, "");
  const path = opts.path || "/v1/whatsapp/single";
  const url = `${base}${path}?api_key=${encodeURIComponent(key())}`;
  const body: Record<string, unknown> = {
    message_type: opts.messageType || "text",
    sender: opts.sender || sender(),
    to: opts.to,
    template_id: opts.templateId,
  };
  if (opts.sample && (opts.sample.header || opts.sample.bodyvar?.length || opts.sample.button?.length)) body.sample = opts.sample;
  return call(url, { method: "POST", headers: { "Content-Type": "application/json", accept: "*/*" }, body: JSON.stringify(body) });
}

export async function waCreateTemplate(payload: Record<string, unknown>, baseUrl?: string): Promise<Result> {
  const base = (baseUrl || DEFAULT_BASE).replace(/\/$/, "");
  const url = `${base}/v1/template?api_key=${encodeURIComponent(key())}`;
  // TrustSignal's create endpoint now validates the camelCase key `wabaId` (snake_case `waba_id`
  // is ignored → 1014 INVALID_WABA "missing or invalid"). Send both so either contract works.
  const wabaId = (process.env.TRUSTSIGNAL_WABA_ID || "").trim();
  const body = { waba_id: wabaId, wabaId, shortlink: "1", ...payload };
  return call(url, { method: "POST", headers: { "Content-Type": "application/json", accept: "*/*" }, body: JSON.stringify(body) });
}

export async function waListTemplates(baseUrl?: string): Promise<Result> {
  const base = (baseUrl || DEFAULT_BASE).replace(/\/$/, "");
  const url = `${base}/v1/template?api_key=${encodeURIComponent(key())}&page=1&limit=100`;
  return call(url, { method: "GET" });
}

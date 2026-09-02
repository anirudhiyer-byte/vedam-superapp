/** TrustSignal / Sigmo WhatsApp client (server-only). api_key is a query param. */
const BASE = "https://sigmo.ai/api";
const key = () => process.env.TRUSTSIGNAL_API_KEY || "";
const sender = () => process.env.TRUSTSIGNAL_SENDER || "";

type Result = { ok: boolean; status: number; data: unknown };

async function parse(res: Response): Promise<Result> {
  const text = await res.text();
  let data: unknown;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  return { ok: res.ok, status: res.status, data };
}

/** Send a single WhatsApp message using an approved template. */
export async function waSendSingle(opts: { to: string; templateId: string; messageType?: string; sender?: string }): Promise<Result> {
  const url = `${BASE}/v1/whatsapp/single?api_key=${encodeURIComponent(key())}`;
  const body = {
    message_type: opts.messageType || "text",
    sender: opts.sender || sender(),
    to: opts.to,
    template_id: opts.templateId,
  };
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return parse(res);
}

/** Fetch all WhatsApp templates (to see names/ids/approval status). */
export async function waListTemplates(): Promise<Result> {
  const url = `${BASE}/v1/template?api_key=${encodeURIComponent(key())}&page=1&limit=100`;
  const res = await fetch(url, { method: "GET" });
  return parse(res);
}

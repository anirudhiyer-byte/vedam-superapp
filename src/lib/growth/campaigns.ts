// Pure helpers for the Growth → Campaigns page (a copy of the Vedam CRM "Campaigns" screen).
// No UI and no network here, so they can be unit-tested.

export type CampaignForm = {
  name: string; campaign_start: string; campaign_end: string; exam_date: string; last_date_to_apply: string;
  application_target: string; budget: string; planned_l2p: string; planned_cpp: string; metadata: string;
};

export type PayloadResult = { ok: true; payload: Record<string, unknown> } | { ok: false; error: string };

/** Number with thousands separators, like the CRM (toLocaleString, en-US). Empty / invalid → "0". */
export const fmtNum = (n: number | string | null | undefined): string => {
  const x = Number(n ?? 0);
  return (Number.isFinite(x) ? x : 0).toLocaleString("en-US");
};

/**
 * Form values → the object sent to growth_campaign_save.
 * Same rules as the CRM: target and budget default to 0; planned L2P / CPP and last date are empty → null;
 * custom fields must be valid JSON. The database checks everything again (this is only for fast feedback).
 */
export function buildCampaignPayload(f: CampaignForm, id?: string): PayloadResult {
  const t = (v: string | null | undefined) => (v ?? "").trim();
  let metadata: unknown = {};
  const raw = t(f.metadata);
  if (raw) {
    try { metadata = JSON.parse(raw); } catch { return { ok: false, error: "Custom fields JSON is invalid" }; }
  }
  if (metadata === null || typeof metadata !== "object" || Array.isArray(metadata)) {
    return { ok: false, error: 'Custom fields must be a JSON object, like {"filters": {}}' };
  }
  const opt = (v: string) => (t(v) === "" ? null : t(v));
  const payload: Record<string, unknown> = {
    name: t(f.name),
    campaign_start: t(f.campaign_start),
    campaign_end: t(f.campaign_end),
    exam_date: t(f.exam_date),
    last_date_to_apply: opt(f.last_date_to_apply),
    application_target: t(f.application_target) || "0",
    budget: t(f.budget) || "0",
    planned_l2p: opt(f.planned_l2p),
    planned_cpp: opt(f.planned_cpp),
    metadata,
  };
  if (id) payload.id = id;
  return { ok: true, payload };
}

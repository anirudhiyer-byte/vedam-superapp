/**
 * Wheebox exam orchestration — pure, server-only helpers shared by the exam API
 * routes (launch / callback / pull-result). The network + DB glue lives in the
 * routes; everything here is pure so it can be unit-tested without egress.
 *
 * Student visibility rule (migration 0040): the MOCK result is shown to the
 * student; the MAIN VSAT raw result is admin-only — the student only ever sees a
 * VPS score, which is set later (at the Cleared / Not-Cleared stage), never here.
 */

/** A Wheebox response is a loose JSON object; pull a launch URL out of it defensively. */
export function extractLaunchUrl(resp: unknown): string | null {
  if (!resp || typeof resp !== "object") return null;
  const o = resp as Record<string, unknown>;
  // Known/likely keys across Wheebox endpoints, then any https string value.
  for (const k of ["url", "testLink", "link", "testUrl", "loginUrl", "launchUrl", "redirectUrl"]) {
    const v = o[k];
    if (typeof v === "string" && /^https?:\/\//i.test(v)) return v;
  }
  // Some responses nest under data / result.
  for (const k of ["data", "result", "response"]) {
    const nested = extractLaunchUrl(o[k]);
    if (nested) return nested;
  }
  for (const v of Object.values(o)) {
    if (typeof v === "string" && /^https?:\/\/\S+$/i.test(v)) return v;
  }
  return null;
}

/** A client-request token to pair with authenticate() → verifyTokenUrl(), if the link needs a login. */
export function extractAuthToken(resp: unknown): string | null {
  if (!resp || typeof resp !== "object") return null;
  const o = resp as Record<string, unknown>;
  for (const k of ["clientRequestToken", "token", "authToken", "requestToken"]) {
    const v = o[k];
    if (typeof v === "string" && v.length > 0 && v.length < 512) return v;
  }
  return null;
}

/** True when a register/assign response looks successful (or the candidate already existed). */
export function isWheeboxOk(resp: unknown): boolean {
  if (!resp || typeof resp !== "object") return false;
  const o = resp as Record<string, unknown>;
  const status = String(o.status ?? o.Status ?? "").toLowerCase();
  const msg = String(o.message ?? o.msg ?? o.error ?? "").toLowerCase();
  if (status === "error" || status === "fail" || status === "failure") {
    // "already registered / exists" is a soft-OK for an idempotent register.
    return /already|exist|duplicate|registered/.test(msg);
  }
  if (/already|exist|duplicate/.test(msg)) return true;
  if (status === "success" || status === "ok" || status === "true" || status === "200") return true;
  // No explicit status but also no error marker → treat as ok (defensive).
  return !("status" in o) || status === "";
}

export type ParsedResult = {
  overall: string | null;
  obtainedMarks: number | null;
  maxMarks: number | null;
  percentile: number | null;
  sections: Record<string, unknown>;
};

const num = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
};

const pick = (o: Record<string, unknown>, keys: string[]): unknown => {
  const lower: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) lower[k.toLowerCase()] = v;
  for (const k of keys) { const v = lower[k.toLowerCase()]; if (v !== undefined && v !== null && v !== "") return v; }
  return undefined;
};

/** Case-insensitive lookup of a nested object block (e.g. OVERALL / SECTIONWISE). */
function block(root: Record<string, unknown>, names: string[]): unknown {
  const lower: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(root)) lower[k.toLowerCase()] = v;
  for (const n of names) { const v = lower[n.toLowerCase()]; if (v !== undefined) return v; }
  return undefined;
}

/**
 * Normalise a Wheebox result payload into our ledger shape. The result callback
 * (Wheebox API doc §6) delivers an `OVERALL` object and a `SECTIONWISE` block with
 * Wheebox's own key names (maximumMark / obtainMark / markObtainInSection …); the
 * pull API returns similar shapes. We alias all of them and keep the full payload
 * as `raw` at the call site. Percentile is usually absent — VPS is computed from
 * our own cohort rank, not from Wheebox.
 */
export function parseWheeboxResult(payload: unknown): ParsedResult {
  const root = (payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {}) as Record<string, unknown>;
  const ovRaw = block(root, ["OVERALL", "overall", "overallResult", "overall_result", "data", "result"]);
  const overallObj = (ovRaw && typeof ovRaw === "object" && !Array.isArray(ovRaw) ? ovRaw : root) as Record<string, unknown>;

  const overall = ((): string | null => {
    const v = pick(overallObj, ["result", "overallResult", "passFail", "pass_fail", "grade", "status"]);
    return v === undefined || v === null || v === "" ? null : String(v);
  })();
  const obtainedMarks = num(pick(overallObj, ["obtainMark", "obtainMarks", "obtainedMarks", "obtained_marks", "marks", "score", "obtained", "totalMarksObtained"]));
  const maxMarks = num(pick(overallObj, ["maximumMark", "maximumMarks", "maxMarks", "max_marks", "totalMarks", "total_marks", "outOf"]));
  const percentile = num(pick(overallObj, ["percentile", "percentage", "percent"]));

  // SECTIONWISE: either an array of section objects, or the odd
  // ["sectionName", <name>, "values", {…}] form. Collect every object element.
  const sections: Record<string, unknown> = {};
  const secRaw = block(root, ["SECTIONWISE", "sectionwise", "sectionWise", "sections", "section", "sectional"]);
  if (Array.isArray(secRaw)) {
    for (const s of secRaw) {
      if (s && typeof s === "object" && !Array.isArray(s)) {
        const so = s as Record<string, unknown>;
        const name = String(pick(so, ["sectionName", "name", "section", "title", "streamInSection"]) ?? "");
        if (name) sections[name] = pick(so, ["markObtainInSection", "marks", "score", "obtainedMarks", "percentile"]) ?? so;
      }
    }
  } else if (secRaw && typeof secRaw === "object") {
    Object.assign(sections, secRaw as Record<string, unknown>);
  }

  return { overall, obtainedMarks, maxMarks, percentile, sections };
}

/** The compact, student-safe shape we store in application_manager.mock_result. */
export function studentMockResult(p: ParsedResult): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (p.obtainedMarks !== null) out["Score"] = p.maxMarks !== null ? `${p.obtainedMarks} / ${p.maxMarks}` : p.obtainedMarks;
  if (p.percentile !== null) out["Percentile"] = p.percentile;
  if (p.overall) out["Result"] = p.overall;
  if (Object.keys(p.sections).length) out["Sections"] = p.sections;
  return out;
}

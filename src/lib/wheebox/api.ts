/**
 * Wheebox API client (server-only).
 *
 * Every request uses the three static creds (company code, access token in the
 * `accessToken` header, private key for AES). Path segments (loginId, testNo, OSR,
 * domain/test name, dateOfExam) and the `val` JSON body are AES-encrypted to hex
 * (see ./crypto). Built straight from the Wheebox API doc (1 Aug 2022).
 *
 * The URL/payload BUILDERS are pure and unit-tested. The call wrappers add the
 * header + fetch + parse; they only run server-side and only reach Wheebox from a
 * deployed environment (the dev sandbox can't egress to wheebox.com).
 */
import { wheeboxEncrypt, wheeboxDecrypt, wheeboxEncryptJson, wheeboxCreds } from "./crypto";

export type Creds = { base: string; companyCode: string; accessToken: string; privateKey: string };

/** "YYYY-MM-DD HH:MM:SS" in IST — the format Wheebox expects for assign start/end. */
export function toWheeboxDate(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const p = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).formatToParts(d).reduce<Record<string, string>>((a, x) => { a[x.type] = x.value; return a; }, {});
  const hh = p.hour === "24" ? "00" : p.hour;
  return `${p.year}-${p.month}-${p.day} ${hh}:${p.minute}:${p.second}`;
}

const enc = (s: string, key: string) => wheeboxEncrypt(s, key);

// ── pure URL / payload builders (unit-tested) ──────────────────────────────

export function buildRegisterUrl(c: Creds, val: Record<string, unknown>): string {
  const q = encodeURIComponent(wheeboxEncryptJson(val, c.privateKey));
  return `${c.base}/wheeboxAPI_v2/registration/${c.companyCode}?val=${q}`;
}

export function buildAssignUrl(c: Creds, loginId: string, assignments: Record<string, { startDate: string; endDate: string }>): string {
  const q = encodeURIComponent(wheeboxEncryptJson(assignments, c.privateKey));
  return `${c.base}/wheeboxAPI_v2/assignTest/${c.companyCode}/${enc(loginId, c.privateKey)}?val=${q}`;
}

export function buildTestLinkUrl(c: Creds, testNo: string, loginId: string, osr: string): string {
  return `${c.base}/wheeboxAPI_v2/testlink/${c.companyCode}/${enc(testNo, c.privateKey)}/${enc(loginId, c.privateKey)}/${enc(osr, c.privateKey)}`;
}

export function buildAuthenticateUrl(c: Creds, loginId: string, clientRequestToken: string): string {
  return `${c.base}/wheeboxAPI_v2/authenticate/${c.companyCode}/${enc(loginId, c.privateKey)}/${encodeURIComponent(clientRequestToken)}`;
}

/** The browser URL that actually logs the candidate in (valid 5 minutes). */
export function verifyTokenUrl(c: Creds, token: string): string {
  return `${c.base}/LOGIN-2/verifyWBToken.obj?compCode=${c.companyCode}&token=${encodeURIComponent(token)}`;
}

export function buildResultUrl(c: Creds, p: { domainName: string; testName: string; loginId: string; osr: string; dateOfExam: string }): string {
  const e = (s: string) => enc(s, c.privateKey);
  return `${c.base}/wheeboxApi/result/${c.companyCode}/${e(p.domainName)}/${e(p.testName)}/${e(p.loginId)}/${e(p.osr)}/${e(p.dateOfExam)}`;
}

// ── call wrappers (server-side; reach Wheebox only when deployed) ───────────

async function postJson(url: string, accessToken: string): Promise<unknown> {
  const res = await fetch(url, { method: "POST", headers: { accessToken, "Content-Type": "application/json" } });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { status: "error", raw: text, httpStatus: res.status }; }
}

export type RegisterInput = {
  loginId: string; firstName: string; lastName?: string; emailId?: string; contactNo?: string;
  state?: string; city?: string; country?: string; gender?: string; regNO?: string; assignTests?: number[];
};

/** Register (and optionally assign tests in the same call). */
export async function registerCandidate(input: RegisterInput, creds?: Creds): Promise<Record<string, unknown>> {
  const c = creds ?? wheeboxCreds();
  if (!c) throw new Error("WHEEBOX_NOT_CONFIGURED");
  const val: Record<string, unknown> = { country: "India", ...input };
  return (await postJson(buildRegisterUrl(c, val), c.accessToken)) as Record<string, unknown>;
}

/** Assign one or more tests (each with a start/end window) to a registered candidate. */
export async function assignTest(loginId: string, assignments: Record<string, { startDate: string; endDate: string }>, creds?: Creds): Promise<Record<string, unknown>> {
  const c = creds ?? wheeboxCreds();
  if (!c) throw new Error("WHEEBOX_NOT_CONFIGURED");
  return (await postJson(buildAssignUrl(c, loginId, assignments), c.accessToken)) as Record<string, unknown>;
}

/** Fetch the launch link for an assigned test. Returns { url, startDate, endDate, status }. */
export async function getTestLink(testNo: string, loginId: string, osr: string, creds?: Creds): Promise<Record<string, unknown>> {
  const c = creds ?? wheeboxCreds();
  if (!c) throw new Error("WHEEBOX_NOT_CONFIGURED");
  return (await postJson(buildTestLinkUrl(c, testNo, loginId, osr), c.accessToken)) as Record<string, unknown>;
}

/** Generate a login token; pair with verifyTokenUrl() to log the candidate in. */
export async function authenticate(loginId: string, clientRequestToken: string, creds?: Creds): Promise<Record<string, unknown>> {
  const c = creds ?? wheeboxCreds();
  if (!c) throw new Error("WHEEBOX_NOT_CONFIGURED");
  return (await postJson(buildAuthenticateUrl(c, loginId, clientRequestToken), c.accessToken)) as Record<string, unknown>;
}

/** Pull a result (encrypted hex response -> decrypted JSON). */
export async function fetchResult(p: { domainName: string; testName: string; loginId: string; osr: string; dateOfExam: string }, creds?: Creds): Promise<unknown> {
  const c = creds ?? wheeboxCreds();
  if (!c) throw new Error("WHEEBOX_NOT_CONFIGURED");
  const res = await fetch(buildResultUrl(c, p), { method: "POST", headers: { accessToken: c.accessToken } });
  const text = (await res.text()).trim();
  if (!text) return { status: "error", raw: "" };
  // Success responses are AES-hex; error responses are plain JSON.
  if (/^[0-9a-f]+$/i.test(text)) {
    try { return JSON.parse(wheeboxDecrypt(text, c.privateKey)); } catch { return { status: "error", raw: text }; }
  }
  try { return JSON.parse(text); } catch { return { status: "error", raw: text }; }
}

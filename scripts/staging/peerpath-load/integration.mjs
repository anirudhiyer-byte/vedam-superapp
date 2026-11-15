// STAGING ONLY · PeerPath end-to-end + break-it checks against a deployed preview.
//
// Pre-steps (staging DB): create-test-users.sql, then simulate-vsat-payment.sql for
// pp-load-0010@example.invalid (the one "paid" user). The GitHub workflow
// .github/workflows/peerpath-staging-tests.yml does all of this, then cleans up. Manual run:
//
//   BASE_URL=<vercel preview url> BYPASS=<vercel bypass token> \
//   STAGING_SUPABASE_URL=https://kyhakenhbgcissmaacws.supabase.co ANON_KEY=<public anon key> \
//   SERVICE_ROLE_KEY=<staging service role, env only> TOKENS_FILE=/tmp/pp-load-tokens.json \
//   SENIOR_ID=<PPLoad id> node scripts/staging/peerpath-load/integration.mjs
//
// Every key comes from the environment and is never printed. Restores the eligibility
// flag to its original value at the end, even on failure. Exit code 1 if any check fails.
import { readFileSync } from "node:fs";

const env = (k) => {
  const v = process.env[k];
  if (!v) { console.error(`Missing ${k}`); process.exit(1); }
  return v;
};
const BASE = env("BASE_URL").replace(/\/$/, "");
const SB = env("STAGING_SUPABASE_URL").replace(/\/$/, "");
if (!SB.includes("kyhakenhbgcissmaacws")) { console.error("Refusing: not the staging project."); process.exit(1); }
const ANON = env("ANON_KEY");
const SERVICE = env("SERVICE_ROLE_KEY");
const BYPASS = process.env.BYPASS ?? "";
const SENIOR = env("SENIOR_ID");
const tokens = JSON.parse(readFileSync(env("TOKENS_FILE"), "utf8"));
const tok = (n) => tokens.find((t) => t.n === n);

const results = [];
const ok = (name, pass, detail = "") => { results.push({ name, pass }); console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`); };

const slot = (day, hh, mm = 0) => {
  const now = new Date();
  const istMidnightUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - 5.5 * 3600e3;
  return new Date(istMidnightUtc + day * 86400e3 + (hh * 60 + mm) * 60e3).toISOString().replace(/\.\d{3}Z$/, "Z");
};
const body = (start, extra = {}) => ({ seniorId: SENIOR, start, type: "1:1", duration: 30, ...extra });

async function route(path, payload, { token, origin = BASE, contentType = "application/json", raw } = {}) {
  const headers = { "content-type": contentType, "x-vercel-protection-bypass": BYPASS };
  if (origin) headers.origin = origin;
  if (token) headers.authorization = `Bearer ${token}`;
  const r = await fetch(`${BASE}${path}`, { method: "POST", headers, body: raw ?? JSON.stringify(payload) });
  let j = null; try { j = await r.json(); } catch { /* not json */ }
  return { status: r.status, j };
}
async function rpc(fn, args, bearer) {
  const r = await fetch(`${SB}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: ANON, "content-type": "application/json", ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
    body: JSON.stringify(args),
  });
  let j = null; try { j = await r.json(); } catch { /* not json */ }
  return { status: r.status, j };
}
async function rest(method, path, { bearer, apikey = ANON, payload } = {}) {
  const r = await fetch(`${SB}/rest/v1/${path}`, {
    method,
    headers: { apikey, authorization: `Bearer ${bearer ?? apikey}`, "content-type": "application/json", prefer: "return=representation" },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  let j = null; try { j = await r.json(); } catch { /* not json */ }
  return { status: r.status, j };
}
const svc = (method, path, payload) => rest(method, path, { apikey: SERVICE, bearer: SERVICE, payload });
const setFlag = (value) => svc("PATCH", "app_flags?key=eq.peerpath_eligibility", { value, updated_by: "integration test", updated_at: new Date().toISOString() });

const u1 = tok(1), u2 = tok(2), u3 = tok(3), u4 = tok(4), paid = tok(10), noapp = tok(9001);
const flagBefore = (await svc("GET", "app_flags?key=eq.peerpath_eligibility&select=value")).j?.[0]?.value ?? "registered";

try {
  await setFlag("registered");

  // ── login / CSRF ──
  let r = await route("/api/peerpath/book", body(slot(2, 10)), {});
  ok("no login -> NOT_LOGGED_IN (401)", r.status === 401 && r.j?.code === "NOT_LOGGED_IN", `${r.status} ${r.j?.code}`);
  r = await route("/api/peerpath/book", body(slot(2, 10)), { origin: null });
  ok("cookie-style request without Origin -> 403", r.status === 403, `${r.status}`);
  r = await route("/api/peerpath/book", body(slot(2, 10)), { origin: "https://evil.example" });
  ok("cross-site Origin -> 403", r.status === 403, `${r.status}`);

  // ── case 3: not registered ──
  r = await route("/api/peerpath/book", body(slot(2, 10)), { token: noapp.token });
  let rows = (await svc("GET", `pp_bookings?applicant_user_id=eq.${noapp.uid}&select=id`)).j ?? [];
  ok("case 3: not registered -> NOT_REGISTERED, no row", r.j?.code === "NOT_REGISTERED" && rows.length === 0, `${r.j?.code} rows=${rows.length}`);
  const direct = await rpc("pp_book", { p: body(slot(2, 10)) }, noapp.token);
  ok("same answer via direct API with the copied token", direct.j?.code === "NOT_REGISTERED", `${direct.status} ${direct.j?.code}`);

  // ── login -> book -> DB check (mode registered) ──
  const A = slot(2, 10);
  r = await route("/api/peerpath/book", body(A, { email: "attacker@example.invalid", phone: "+919999999999", payment_stage_1: "payment_approved" }), { token: u1.token });
  const idA = r.j?.id;
  const rowA = idA ? (await svc("GET", `pp_bookings?id=eq.${idA}&select=applicant_user_id,applicant_email,applicant_phone,status`)).j?.[0] : null;
  ok("registered user books -> OK", r.j?.code === "OK" && !!idA, `${r.j?.code}`);
  // contact = the login's VERIFIED email (required) + verified phone (optional; load users log in by
  // email only, so no phone is stored). The email/phone sent in the request are dropped.
  ok("DB row belongs to the login, contact = verified login email, no phone (sent email/phone ignored)",
    rowA?.applicant_user_id === u1.uid && rowA?.applicant_email === "pp-load-0001@example.invalid" && rowA?.applicant_phone === null,
    JSON.stringify(rowA));

  // ── autofill: the booking page shows pp_my_contact; it must equal what was stored ──
  // (the booking pages themselves are admin-only while PEERPATH_LIVE = false, so the
  //  page's data source is checked over HTTP instead of the rendered HTML)
  const shown = await rpc("pp_my_contact", {}, u1.token);
  ok("autofill (pp_my_contact) = stored booking contact, complete without a phone",
    shown.j?.email === rowA?.applicant_email && shown.j?.phone === rowA?.applicant_phone && shown.j?.complete === true,
    JSON.stringify(shown.j));
  const shownAnon = await rpc("pp_my_contact", {});
  ok("autofill needs a login (anon key -> refused or empty)", shownAnon.status >= 400 || shownAnon.j === null, `${shownAnon.status}`);

  // ── double-click / rapid repeat ──
  const again = await route("/api/peerpath/book", body(A), { token: u1.token });
  const burst = await Promise.all(Array.from({ length: 5 }, () => route("/api/peerpath/book", body(A), { token: u1.token })));
  rows = (await svc("GET", `pp_bookings?applicant_user_id=eq.${u1.uid}&start_at=eq.${encodeURIComponent(A)}&status=eq.confirmed&select=id`)).j ?? [];
  ok("double-click + 5 parallel repeats -> same id, ONE row",
    again.j?.id === idA && burst.every((b) => b.j?.id === idA) && rows.length === 1, `rows=${rows.length}`);

  // ── slot taken (a step fails) ──
  r = await route("/api/peerpath/book", body(A), { token: u4.token });
  ok("someone else's taken slot -> SLOT_UNAVAILABLE", r.j?.code === "SLOT_UNAVAILABLE", `${r.j?.code}`);

  // ── BOLA ──
  let v = await rpc("pp_booking_by_id", { p_id: idA }, u2.token);
  ok("another user cannot view the booking", v.j === null, `${v.status} ${JSON.stringify(v.j)?.slice(0, 60)}`);
  r = await route("/api/peerpath/cancel", { id: idA }, { token: u2.token });
  ok("another user cannot cancel the booking", r.j?.error === "not_found", `${r.j?.error}`);
  v = await rpc("pp_my_bookings", {}, u2.token);
  ok("another user's 'my bookings' doesn't include it", Array.isArray(v.j) && !v.j.some((b) => b.id === idA));

  // ── anon key / internal functions / protected tables ──
  v = await rpc("pp_book", { p: body(slot(2, 12)) });
  ok("anon key cannot call pp_book", v.status === 401 || v.status === 403 || v.j?.code === "42501", `${v.status}`);
  v = await rpc("pp_vsat_eligible", { p_uid: u1.uid });
  ok("anon key cannot call pp_vsat_eligible", v.status >= 400, `${v.status}`);
  v = await rpc("pp_vsat_eligible", { p_uid: u1.uid }, u1.token);
  ok("logged-in user cannot call pp_vsat_eligible", v.status >= 400, `${v.status}`);
  v = await rest("PATCH", "app_flags?key=eq.peerpath_eligibility", { bearer: u1.token, payload: { value: "off" } });
  ok("logged-in user cannot change app_flags", v.status >= 400, `${v.status}`);
  v = await rest("POST", "vsat_payments", { bearer: u1.token, payload: { lead_id: u1.uid, paid_at: new Date().toISOString(), payment_ref: "self", provider: "cashfree" } });
  ok("logged-in user cannot write vsat_payments", v.status >= 400, `${v.status}`);
  v = await rest("GET", "vsat_payments?select=lead_id", { bearer: u1.token });
  ok("logged-in user cannot read vsat_payments", v.status >= 400, `${v.status}`);
  v = await rpc("pp_book", { p: body(slot(2, 13), { payment_stage_1: "payment_approved" }) }, u1.token);
  ok("payment field sent straight to the API -> INVALID", v.j?.code === "INVALID", `${v.j?.code}`);

  // ── bad input at the route ──
  r = await route("/api/peerpath/book", null, { token: u1.token, raw: "{" });
  ok("malformed JSON -> 400", r.status === 400);
  r = await route("/api/peerpath/book", null, { token: u1.token, raw: JSON.stringify({ pad: "y".repeat(9000) }) });
  ok("oversized body -> 400", r.status === 400);
  r = await route("/api/peerpath/book", null, { token: u1.token, raw: "a=b", contentType: "application/x-www-form-urlencoded" });
  ok("wrong content type -> 415", r.status === 415);

  // ── mode paid: case 2 and case 1 ──
  await setFlag("paid");
  r = await route("/api/peerpath/book", body(slot(3, 10)), { token: u2.token });
  rows = (await svc("GET", `pp_bookings?applicant_user_id=eq.${u2.uid}&select=id`)).j ?? [];
  ok("case 2: registered, unpaid (mode paid) -> PAYMENT_PENDING, no row", r.j?.code === "PAYMENT_PENDING" && rows.length === 0, `${r.j?.code} rows=${rows.length}`);
  r = await route("/api/peerpath/book", body(slot(3, 11)), { token: paid.token });
  ok("case 1: registered + paid -> OK", r.j?.code === "OK", `${r.j?.code}`);
  await setFlag("off");
  r = await route("/api/peerpath/book", body(slot(3, 12)), { token: paid.token });
  ok("flag off -> BOOKING_CLOSED", r.j?.code === "BOOKING_CLOSED", `${r.j?.code}`);
  await setFlag("registered");

  // ── per-user rate limit ──
  let last;
  for (let i = 0; i < 21; i++) last = await rpc("pp_book", { p: {} }, u3.token);
  ok("21 rapid attempts -> RATE_LIMITED", last.j?.code === "RATE_LIMITED", `${last.j?.code}`);

  // ── own cancel + logging ──
  r = await route("/api/peerpath/cancel", { id: idA }, { token: u1.token });
  const st = (await svc("GET", `pp_bookings?id=eq.${idA}&select=status`)).j?.[0]?.status;
  ok("owner can cancel own booking", r.j?.ok === true && st === "cancelled", `${JSON.stringify(r.j)} ${st}`);
  const logs = (await svc("GET", `pp_book_attempts?user_id=eq.${u3.uid}&select=code`)).j ?? [];
  ok("every attempt logged (incl. blocked)", logs.length >= 21, `${logs.length} rows`);

  // ── /apply honours ?next= (only a page on this site) ──
  const page = async (path) => {
    const res = await fetch(`${BASE}${path}`, { headers: { "x-vercel-protection-bypass": BYPASS }, redirect: "manual" });
    return { status: res.status, html: await res.text(), headers: res.headers };
  };
  let pg = await page(`/apply?next=${encodeURIComponent("/peerpath/talk-to-senior/book?senior=pp-int-check")}`);
  ok("/apply?next=<booking page> -> return link passed to the form",
    pg.status === 200 && /\\?"next\\?":\\?"\/peerpath\/talk-to-senior\/book\?senior=pp-int-check/.test(pg.html), `${pg.status}`);
  pg = await page(`/apply?next=${encodeURIComponent("//evil.example/x")}`);
  ok("/apply?next=//evil.example -> ignored (next = null)", pg.status === 200 && /\\?"next\\?":null/.test(pg.html), `${pg.status}`);
  pg = await page(`/apply?next=${encodeURIComponent("javascript:alert(1)")}`);
  ok("/apply?next=javascript:... -> ignored (next = null)", pg.status === 200 && /\\?"next\\?":null/.test(pg.html), `${pg.status}`);

  // ── no public source maps ──
  const chunk = pg.html.match(/\/_next\/static\/chunks\/[A-Za-z0-9_\-./]+?\.js/)?.[0];
  if (chunk) {
    const js = await fetch(`${BASE}${chunk}`, { headers: { "x-vercel-protection-bypass": BYPASS } });
    const map = await fetch(`${BASE}${chunk}.map`, { headers: { "x-vercel-protection-bypass": BYPASS } });
    ok("client JS has no public source map (.map -> 404, no sourceMappingURL)",
      map.status === 404 && !/sourceMappingURL=/.test(await js.text()), `${chunk}.map -> ${map.status}`);
  } else ok("client JS has no public source map", false, "no chunk URL found on /apply");

  // ── CORS: other sites cannot read PeerPath API answers ──
  const pre = await fetch(`${BASE}/api/peerpath/book`, { method: "OPTIONS", headers: { origin: "https://evil.example", "access-control-request-method": "POST", "x-vercel-protection-bypass": BYPASS } });
  const cross = await fetch(`${BASE}/api/peerpath/book`, { method: "POST", headers: { origin: "https://evil.example", "content-type": "application/json", authorization: `Bearer ${u4.token}`, "x-vercel-protection-bypass": BYPASS }, body: "{}" });
  const acao = [pre.headers.get("access-control-allow-origin"), cross.headers.get("access-control-allow-origin")];
  ok("CORS: no Access-Control-Allow-Origin for another site (preflight + POST)", acao.every((h) => !h), JSON.stringify(acao));
  const sec = await page("/peerpath/talk-to-senior");
  console.log(`INFO  security headers on /peerpath/talk-to-senior: csp=${sec.headers.get("content-security-policy") ? "yes" : "no"} x-frame-options=${sec.headers.get("x-frame-options") ?? "no"} hsts=${sec.headers.get("strict-transport-security") ? "yes" : "no"}`);

  // ── per-IP limit at the route (runs LAST: it blocks this machine's IP for an hour) ──
  let ipRes;
  for (let i = 0; i < 70; i++) {
    ipRes = await route("/api/peerpath/book", {}, { token: tok(5 + (i % 4)).token });
    if (ipRes.status === 429) break;
  }
  ok("rapid repeats from one IP -> 429 RATE_LIMITED at the route (60/hour)", ipRes.status === 429 && ipRes.j?.code === "RATE_LIMITED", `${ipRes.status} ${ipRes.j?.code}`);
  const ipLogs = (await svc("GET", "pp_book_attempts?source=eq.route&code=eq.RATE_LIMITED&select=id&order=id.desc&limit=1")).j ?? [];
  ok("route IP block is logged (source=route, no user)", ipLogs.length === 1, `${ipLogs.length}`);
} finally {
  await setFlag(flagBefore);
  const after = (await svc("GET", "app_flags?key=eq.peerpath_eligibility&select=value")).j?.[0]?.value;
  console.log(`\nflag restored to: ${after}`);
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);

// STAGING ONLY · PeerPath booking load test (k6).
//
// RAMPED: 0 → 100 → 500 → 1,000 virtual users, holds at 1,000, then ramps down. Each VU is a
// different pp-load-* test user (own token) that keeps trying to book the PPLoad senior with
// a 3–8 s pause (a person, not a script). Reports p50/p95/p99 overall AND per load stage
// (tag load=ramp100|ramp500|peak), error rate, dropped requests (no answer / timeout) and how
// many of each result code came back (OK, SLOT_UNAVAILABLE, LIMIT_REACHED, RATE_LIMITED…).
// One senior on purpose: everyone booking the same senior is the worst case (all bookings for
// a senior are serialised by a per-senior lock).
//
// Two modes:
//   MODE=route  → POST <BASE_URL>/api/peerpath/book   (Vercel preview; per-IP limit applies:
//                 from one load machine most requests will be RATE_LIMITED — that IS the test)
//   MODE=db     → POST <SUPABASE_URL>/rest/v1/rpc/pp_book with each user's token
//                 (measures the database path at 1,000 concurrent users)
//
//   k6 run -e MODE=db -e SUPABASE_URL=… -e ANON_KEY=… -e TOKENS_FILE=/tmp/pp-load-tokens.json \
//          -e SENIOR_ID=<PPLoad id> scripts/staging/peerpath-load/k6-book.js
//   k6 run -e MODE=route -e BASE_URL=<preview url> -e BYPASS=<vercel bypass token> … (same TOKENS_FILE/SENIOR_ID)
// All keys come from -e / environment variables; nothing is hard-coded or printed.
import http from "k6/http";
import exec from "k6/execution";
import { check, sleep } from "k6";
import { Counter } from "k6/metrics";
import { SharedArray } from "k6/data";

const MODE = __ENV.MODE || "db";
const PEAK = Number(__ENV.VUS || 1000);
const tokens = new SharedArray("tokens", () => JSON.parse(open(__ENV.TOKENS_FILE)));
const codes = new Counter("pp_result_codes");
const dropped = new Counter("pp_dropped_requests"); // no HTTP answer at all (timeout / connection error)

export const options = {
  scenarios: {
    ramp_to_peak: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "30s", target: Math.round(PEAK * 0.1) },
        { duration: "60s", target: Math.round(PEAK * 0.5) },
        { duration: "60s", target: PEAK },
        { duration: "90s", target: PEAK },
        { duration: "30s", target: 0 },
      ],
      gracefulRampDown: "30s",
    },
  },
  summaryTrendStats: ["avg", "min", "med", "p(90)", "p(95)", "p(99)", "max"],
  thresholds: {
    // transport-level failures only (timeouts, 5xx); 429 is an expected answer here
    "http_req_failed{expected:yes}": ["rate<0.01"],
    // per-stage latency, so the summary shows where it starts to climb (limits are loose on purpose)
    "http_req_duration{load:ramp100}": ["p(95)<10000"],
    "http_req_duration{load:ramp500}": ["p(95)<10000"],
    "http_req_duration{load:peak}": ["p(95)<10000"],
    pp_dropped_requests: ["count<10"],
  },
};

const stage = () => {
  const v = exec.instance.vusActive;
  return v <= PEAK * 0.1 ? "ramp100" : v <= PEAK * 0.5 ? "ramp500" : "peak";
};

// valid start times for the PPLoad senior: day 1..13 ahead (IST), 08:00–22:00 on the half hour
function randomSlot() {
  const day = 1 + Math.floor(Math.random() * 13);
  const halfHours = 16 + Math.floor(Math.random() * 28); // 08:00 .. 21:30
  const istMidnightUtc = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()) - 5.5 * 3600e3;
  const t = new Date(istMidnightUtc + day * 86400e3 + halfHours * 1800e3);
  return t.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export default function bookOnce() {
  const me = tokens[(__VU - 1) % tokens.length];
  const body = { seniorId: __ENV.SENIOR_ID, start: randomSlot(), type: "1:1", duration: 30 };
  const tags = { expected: "yes", load: stage() };
  let res;
  if (MODE === "route") {
    res = http.post(`${__ENV.BASE_URL}/api/peerpath/book`, JSON.stringify(body), {
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${me.token}`, "x-vercel-protection-bypass": __ENV.BYPASS || "" },
      tags,
      timeout: "15s",
      responseCallback: http.expectedStatuses(200, 429),
    });
  } else {
    res = http.post(`${__ENV.SUPABASE_URL}/rest/v1/rpc/pp_book`, JSON.stringify({ p: body }), {
      headers: { "Content-Type": "application/json", apikey: __ENV.ANON_KEY, Authorization: `Bearer ${me.token}` },
      tags,
      timeout: "15s",
      responseCallback: http.expectedStatuses(200),
    });
  }
  let code = `HTTP_${res.status}`;
  try {
    const j = res.json();
    if (j && typeof j.code === "string") code = j.code;
  } catch {
    /* not JSON */
  }
  if (res.status === 0) dropped.add(1, { load: tags.load });
  codes.add(1, { code, load: tags.load });
  check(res, {
    "answered (no timeout)": (r) => r.status !== 0,
    "no server error": (r) => r.status < 500,
    "known result code": () => !code.startsWith("HTTP_"),
  });
  sleep(3 + Math.random() * 5);
}

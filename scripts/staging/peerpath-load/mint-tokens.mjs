// STAGING ONLY · make short-lived login tokens for the pp-load-* test users.
//
//   STAGING_SUPABASE_URL=https://kyhakenhbgcissmaacws.supabase.co \
//   STAGING_JWT_SECRET=<staging JWT secret, from env only> \
//   USERS=1000 node scripts/staging/peerpath-load/mint-tokens.mjs > /tmp/pp-load-tokens.json
//
// Tokens are signed for role "authenticated" with the deterministic test-user ids that
// create-test-users.sql uses (md5('pp-load-<n>') shaped as a uuid). They expire in 2 hours.
// The secret is read from the environment and never printed. The output file holds live
// tokens for test accounts only — keep it out of git (write it to /tmp) and delete it after.
import { createHash, createHmac } from "node:crypto";

const STAGING_REF = "kyhakenhbgcissmaacws";
const url = process.env.STAGING_SUPABASE_URL ?? "";
const secret = process.env.STAGING_JWT_SECRET ?? "";
const users = Number(process.env.USERS ?? 1000);

if (!url.includes(STAGING_REF)) {
  console.error(`Refusing: STAGING_SUPABASE_URL must be the staging project (${STAGING_REF}).`);
  process.exit(1);
}
if (secret.length < 32) {
  console.error("Missing STAGING_JWT_SECRET (set it as an environment variable).");
  process.exit(1);
}
if (!Number.isInteger(users) || users < 1 || users > 5000) {
  console.error("USERS must be 1..5000");
  process.exit(1);
}

export const loadUserId = (n) => {
  const h = createHash("md5").update(`pp-load-${n}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

const b64url = (v) => Buffer.from(typeof v === "string" ? v : JSON.stringify(v)).toString("base64url");
const now = Math.floor(Date.now() / 1000);
const header = b64url({ alg: "HS256", typ: "JWT" });

const out = [];
const ids = [...Array.from({ length: users }, (_, i) => i + 1), 9001, 9002, 9003, 9004, 9005]; // 9001+ = not registered
for (const n of ids) {
  const sub = loadUserId(n);
  const payload = b64url({
    iss: `${url.replace(/\/$/, "")}/auth/v1`,
    sub,
    aud: "authenticated",
    role: "authenticated",
    email: `pp-load-${n > 9000 ? n : String(n).padStart(4, "0")}@example.invalid`,
    iat: now,
    exp: now + 2 * 3600,
  });
  const sig = createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  out.push({ n, uid: sub, token: `${header}.${payload}.${sig}` });
}
process.stdout.write(JSON.stringify(out));

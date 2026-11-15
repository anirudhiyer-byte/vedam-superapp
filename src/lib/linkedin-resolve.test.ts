// Unit tests for lnkd.in short-link support (phone shares) and URL canonicalization.
// Run: node --experimental-strip-types --test src/lib/linkedin-resolve.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error TS5097 — node's strip-types runner needs the .ts extension
import { isLnkdInShortUrl, canonicalLinkedInPostUrl, resolveLnkdIn } from "./linkedin-url.ts";

const POST = "https://www.linkedin.com/posts/ram-sharma_codesprint-activity-7123456789012345678-AbCd";

// ---- fake fetch: maps URL -> response, records every URL fetched ----
type Fake = { status: number; location?: string; body?: string; delayMs?: number; throws?: boolean };
function fakeFetch(map: Record<string, Fake>) {
  const seen: string[] = [];
  const fn = async (input: string, init?: { signal?: AbortSignal }) => {
    seen.push(input);
    const f = map[input];
    if (!f) throw new Error("unexpected fetch: " + input);
    if (f.throws) throw new Error("network down");
    if (f.delayMs) {
      await new Promise((res, rej) => {
        const t = setTimeout(res, f.delayMs);
        init?.signal?.addEventListener("abort", () => { clearTimeout(t); rej(new Error("aborted")); });
      });
    }
    const headers = new Headers();
    if (f.location) headers.set("location", f.location);
    return new Response(f.status >= 300 && f.status < 400 ? null : (f.body ?? ""), { status: f.status, headers });
  };
  return { fn, seen };
}

// ---------------- isLnkdInShortUrl ----------------
test("recognises real lnkd.in short links", () => {
  for (const u of ["https://lnkd.in/gXyZ12aB", "https://lnkd.in/d-Ab_12c/", "  https://lnkd.in/eAbCdEf  ", "https://lnkd.in/gAbc123?trk=x"])
    assert.equal(isLnkdInShortUrl(u), true, u);
});

test("rejects lnkd.in look-alikes and tricks", () => {
  for (const u of [
    "http://lnkd.in/abc1234", "https://lnkd.in.evil.com/abc1234", "https://evil-lnkd.in/abc1234",
    "https://lnkd.in@evil.com/abc1234", "https://lnkd.in:8443/abc1234", "https://www.lnkd.in/abc1234",
    "https://lnkd.in/", "https://lnkd.in/ab", "https://lnkd.in/abc/def", "https://lnkd.in/abc%2F..%2Fx",
    "lnkd.in/abc1234", "", "https://lnkd.in/" + "a".repeat(60),
  ]) assert.equal(isLnkdInShortUrl(u), false, u);
});

// ---------------- canonicalLinkedInPostUrl ----------------
test("canonical form strips query, hash, trailing slash and normalises host", () => {
  const same = [
    POST, POST + "/", POST + "?utm_source=share&utm_medium=member_android", POST + "/?rcm=x#c",
    POST.replace("www.", ""), "HTTPS://WWW.LINKEDIN.COM/posts/ram-sharma_codesprint-activity-7123456789012345678-AbCd",
  ];
  for (const u of same) assert.equal(canonicalLinkedInPostUrl(u), POST, u);
  assert.equal(canonicalLinkedInPostUrl("https://www.linkedin.com/feed/update/urn:li:activity:7123/?x=1"),
    "https://www.linkedin.com/feed/update/urn:li:activity:7123");
});

test("canonical returns null for anything that is not a valid post URL", () => {
  for (const u of ["https://example.com/?ref=linkedin.com/x", "https://lnkd.in/abc1234", "https://www.linkedin.com/in/ram", ""])
    assert.equal(canonicalLinkedInPostUrl(u), null, u);
});

// ---------------- resolveLnkdIn ----------------
test("follows a lnkd.in redirect to a real post and returns the canonical URL", async () => {
  const { fn, seen } = fakeFetch({ "https://lnkd.in/gAbc123": { status: 301, location: POST + "?utm_source=share" } });
  assert.deepEqual(await resolveLnkdIn("https://lnkd.in/gAbc123?trk=x", fn), { ok: true, url: POST });
  assert.deepEqual(seen, ["https://lnkd.in/gAbc123"]); // query from user input is never sent
});

test("follows a short chain lnkd.in -> lnkd.in -> post", async () => {
  const { fn } = fakeFetch({
    "https://lnkd.in/gAbc123": { status: 302, location: "https://lnkd.in/gDef456" },
    "https://lnkd.in/gDef456": { status: 301, location: POST },
  });
  assert.deepEqual(await resolveLnkdIn("https://lnkd.in/gAbc123", fn), { ok: true, url: POST });
});

test("stops (never fetches) when a redirect leaves LinkedIn — no SSRF", async () => {
  const { fn, seen } = fakeFetch({ "https://lnkd.in/gAbc123": { status: 301, location: "http://169.254.169.254/latest/meta-data" } });
  assert.deepEqual(await resolveLnkdIn("https://lnkd.in/gAbc123", fn), { ok: false, reason: "not_a_post" });
  assert.deepEqual(seen, ["https://lnkd.in/gAbc123"]);
});

test("rejects a redirect to linkedin.com that is not a post (profile)", async () => {
  const { fn } = fakeFetch({ "https://lnkd.in/gAbc123": { status: 301, location: "https://www.linkedin.com/in/ram" } });
  assert.deepEqual(await resolveLnkdIn("https://lnkd.in/gAbc123", fn), { ok: false, reason: "not_a_post" });
});

test("gives up after too many hops (loop)", async () => {
  const { fn } = fakeFetch({
    "https://lnkd.in/gAaaa11": { status: 302, location: "https://lnkd.in/gBbbb22" },
    "https://lnkd.in/gBbbb22": { status: 302, location: "https://lnkd.in/gAaaa11" },
  });
  assert.deepEqual(await resolveLnkdIn("https://lnkd.in/gAaaa11", fn), { ok: false, reason: "unavailable" });
});

test("times out instead of hanging", async () => {
  const { fn } = fakeFetch({ "https://lnkd.in/gAbc123": { status: 301, location: POST, delayMs: 2000 } });
  assert.deepEqual(await resolveLnkdIn("https://lnkd.in/gAbc123", fn, { timeoutMs: 50 }), { ok: false, reason: "unavailable" });
});

test("network error / LinkedIn blocking (999) -> unavailable", async () => {
  assert.deepEqual(await resolveLnkdIn("https://lnkd.in/gAbc123", fakeFetch({ "https://lnkd.in/gAbc123": { status: 0, throws: true } }).fn), { ok: false, reason: "unavailable" });
  assert.deepEqual(await resolveLnkdIn("https://lnkd.in/gAbc123", fakeFetch({ "https://lnkd.in/gAbc123": { status: 999 } }).fn), { ok: false, reason: "unavailable" });
});

test("interstitial HTML page: uses the single post link it contains", async () => {
  const body = `<html><a href="${POST}?trk=x">Continue</a></html>`;
  const { fn } = fakeFetch({ "https://lnkd.in/gAbc123": { status: 200, body } });
  assert.deepEqual(await resolveLnkdIn("https://lnkd.in/gAbc123", fn), { ok: true, url: POST });
});

test("interstitial HTML with no post link (external site) -> not_a_post", async () => {
  const { fn } = fakeFetch({ "https://lnkd.in/gAbc123": { status: 200, body: `<a href="https://evil.com/x">go</a>` } });
  assert.deepEqual(await resolveLnkdIn("https://lnkd.in/gAbc123", fn), { ok: false, reason: "not_a_post" });
});

test("invalid input is rejected without any fetch", async () => {
  const { fn, seen } = fakeFetch({});
  assert.deepEqual(await resolveLnkdIn("https://evil.com/abc1234", fn), { ok: false, reason: "invalid" });
  assert.equal(seen.length, 0);
});

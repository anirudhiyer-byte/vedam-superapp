// Unit tests for the LinkedIn post URL validator (SEC-08 / CS-02).
// Run: node --experimental-strip-types --test src/lib/linkedin-url.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
// Node's --experimental-strip-types needs the explicit .ts extension; tsc (allowImportingTsExtensions off) does not.
// @ts-expect-error TS5097 — intentional for the node test runner
import { isValidLinkedInPostUrl } from "./linkedin-url.ts";

const valid = [
  "https://www.linkedin.com/posts/ram-sharma_codesprint-activity-7123456789012345678-AbCd",
  "https://linkedin.com/posts/ram-sharma_codesprint-activity-7123456789012345678-AbCd",
  "https://www.linkedin.com/posts/ram-sharma_codesprint-activity-7123456789012345678-AbCd/",
  "https://www.linkedin.com/posts/ram-sharma_codesprint-activity-7123456789012345678-AbCd?utm_source=share&utm_medium=member_desktop",
  "https://www.linkedin.com/feed/update/urn:li:activity:7123456789012345678/",
  "https://www.linkedin.com/feed/update/urn:li:share:7123456789012345678",
  "https://www.linkedin.com/feed/update/urn:li:ugcPost:7123456789012345678",
  "HTTPS://WWW.LINKEDIN.COM/posts/ram-sharma_x-activity-1",
  "  https://www.linkedin.com/posts/ram-sharma_x-activity-1  ",
];

const invalid: Array<[string, string]> = [
  ["https://example.com/?ref=linkedin.com/x", "linkedin.com only in the query string (the original bug)"],
  ["https://www.google.com/search?q=linkedin.com/posts", "linkedin.com only in the query string"],
  ["https://linkedin.com.example.com/posts/x", "lookalike host (suffix)"],
  ["https://example-linkedin.com/posts/x", "lookalike host (prefix)"],
  ["https://linkedin.com@example.com/posts/x", "userinfo trick, real host is example.com"],
  ["https://www.linkedin.com:8443/posts/x", "non-default port"],
  ["https://www.linkedin.com./posts/x", "trailing-dot host"],
  ["https://evil.linkedin.com/posts/x", "unexpected subdomain"],
  ["http://www.linkedin.com/posts/x", "not https"],
  ["https://www.linkedin.com/in/ram-sharma", "profile page, not a post"],
  ["https://www.linkedin.com/company/vedam-school-of-technology", "company page, not a post"],
  ["https://www.linkedin.com/posts/", "post path with no slug"],
  ["https://www.linkedin.com/feed/update/urn:li:activity:abc", "non-numeric activity id"],
  ["https://lnkd.in/abc123", "short link (destination unknown)"],
  ["linkedin.com/posts/x", "no scheme"],
  ["javascript:alert(1)//linkedin.com/posts/x", "javascript: scheme"],
  ["", "empty"],
  ["https://www.linkedin.com/posts/" + "a".repeat(600), "too long"],
];

test("accepts real LinkedIn post URLs", () => {
  for (const u of valid) assert.equal(isValidLinkedInPostUrl(u), true, `should accept: ${u}`);
});

test("rejects anything whose host is not exactly linkedin.com / www.linkedin.com, or that is not a post", () => {
  for (const [u, why] of invalid) assert.equal(isValidLinkedInPostUrl(u), false, `should reject (${why}): ${u}`);
});

test("rejects non-string input safely", () => {
  assert.equal(isValidLinkedInPostUrl(undefined as unknown as string), false);
  assert.equal(isValidLinkedInPostUrl(null as unknown as string), false);
});

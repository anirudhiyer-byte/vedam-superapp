/**
 * Security headers for the admin pages only (used by next.config.mjs → headers()).
 * - X-Frame-Options SAMEORIGIN + CSP frame-ancestors 'self': no other site may put an admin page in a frame
 *   (clickjacking). Same-site frames keep working.
 * - X-Content-Type-Options nosniff: the browser must not guess file types.
 * Nothing global: other routes (public site, /growth, APIs) are unchanged. Tested in src/lib/security-headers.test.ts.
 */

/** @type {{ key: string; value: string }[]} */
export const ADMIN_SECURITY_HEADERS = [
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
];

/** @returns {{ source: string; headers: { key: string; value: string }[] }[]} */
export const securityHeaderRoutes = () => [{ source: "/admin/:path*", headers: ADMIN_SECURITY_HEADERS }];

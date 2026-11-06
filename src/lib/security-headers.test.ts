/** Security headers (next.config.mjs → security-headers.mjs): only admin pages, exactly these three. */
import { describe, expect, it } from "vitest";
import { ADMIN_SECURITY_HEADERS, securityHeaderRoutes } from "../../security-headers.mjs";

describe("admin security headers", () => {
  it("exactly three headers with these values", () => {
    expect(ADMIN_SECURITY_HEADERS).toEqual([
      { key: "X-Frame-Options", value: "SAMEORIGIN" },
      { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
      { key: "X-Content-Type-Options", value: "nosniff" },
    ]);
  });
  it("one rule only, for /admin/:path* (no global CSP, nothing on other routes)", () => {
    const routes = securityHeaderRoutes();
    expect(routes).toEqual([{ source: "/admin/:path*", headers: ADMIN_SECURITY_HEADERS }]);
    expect(routes.some((r) => r.source === "/:path*" || r.source === "/(.*)")).toBe(false);
  });
  it("the CSP only limits who may frame the page (no script / style rules that could break pages)", () => {
    const csp = ADMIN_SECURITY_HEADERS.find((h) => h.key === "Content-Security-Policy")!.value;
    expect(csp.split(";").map((d) => d.trim().split(" ")[0])).toEqual(["frame-ancestors"]);
  });
});

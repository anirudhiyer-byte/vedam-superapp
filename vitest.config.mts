import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Unit tests only (pure logic + route handlers with a fake Supabase).
// DB tests live in supabase/tests/*.sql and run against the staging DB.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    include: ["src/**/*.test.ts"],
    // these two use Node's built-in runner (node:test); `pnpm test` runs them with `test:node`
    exclude: ["src/lib/linkedin-url.test.ts", "src/lib/linkedin-resolve.test.ts", "node_modules/**"],
    environment: "node",
  },
});

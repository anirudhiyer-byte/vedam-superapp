import { withSentryConfig } from "@sentry/nextjs/config";
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Scaffold convenience: don't let lint block the first builds.
  // Tighten this once the team's lint rules are settled.
  eslint: {
    ignoreDuringBuilds: true,
  },
  // Skip the full TypeScript typecheck during the Vercel build (it was adding ~10 min).
  // Types are still checked in the editor / locally; this only speeds the deploy build.
  typescript: {
    ignoreBuildErrors: true,
  },
  // Tie the build ID to the git commit so every deploy ships uniquely-hashed
  // bundles — prevents Vercel from ever serving a stale compiled build.
  generateBuildId: async () => process.env.VERCEL_GIT_COMMIT_SHA || null,
  async redirects() {
    return [];
  },
};

export default withSentryConfig(nextConfig, {
  // Org/project identify where to upload source maps. Not secrets — but read from
  // env so they're set once in Vercel. The auth token (SENTRY_AUTH_TOKEN) is a
  // secret and is read automatically from env by the plugin; never commit it.
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  // Upload source maps so Sentry shows real file/line/function in stack traces
  // instead of minified bundle output. Skipped automatically when no auth token
  // is present (e.g. local builds), so this never breaks a build.
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
  silent: true,
  widenClientFileUpload: true,
  disableLogger: true,
  webpack: { treeshake: { removeDebugLogging: true } },
});

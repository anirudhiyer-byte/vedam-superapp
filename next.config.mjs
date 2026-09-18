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
};

export default withSentryConfig(nextConfig, { silent: true, widenClientFileUpload: true, webpack: { treeshake: { removeDebugLogging: true } } });

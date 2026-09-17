import { withSentryConfig } from "@sentry/nextjs/config";
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Scaffold convenience: don't let lint block the first builds.
  // Tighten this once the team's lint rules are settled.
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default withSentryConfig(nextConfig, { silent: true, widenClientFileUpload: true, webpack: { treeshake: { removeDebugLogging: true } } });

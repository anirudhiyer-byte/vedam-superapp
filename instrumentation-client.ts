import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,               // 10% perf traces — tune later
  replaysSessionSampleRate: 0,         // no session replay (privacy + cost)
  replaysOnErrorSampleRate: 0.1,       // capture replay only on errors
  enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,
});
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;

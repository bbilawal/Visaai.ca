import * as Sentry from '@sentry/nestjs';

/**
 * Error tracking (audit P0 #2). No-op unless SENTRY_DSN is set, so dev/test and
 * un-configured deploys are unaffected. PII is never sent — this platform holds
 * passports/tax IDs, so `sendDefaultPii` stays false and request bodies are not
 * attached.
 */
export function initSentry(): boolean {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return false;
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'development',
    // Errors only by default; turn tracesSampleRate up when APM is wanted.
    tracesSampleRate: 0,
    sendDefaultPii: false,
  });
  return true;
}

export { Sentry };

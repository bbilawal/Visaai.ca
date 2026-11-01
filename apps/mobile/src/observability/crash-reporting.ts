import * as Sentry from '@sentry/react-native';
import { env } from '@/config/env';

/**
 * Crash and error reporting.
 *
 * Mirrors the API's Sentry setup (apps/api/src/observability/sentry.ts): the
 * same vendor, the same "no-op unless a DSN is configured" contract, and the
 * same refusal to send PII. Without this, a crash on a user's phone is
 * completely invisible to us — there is no server-side log for a JS exception
 * that killed the app before any request went out.
 *
 * PRIVACY IS THE HARD PART HERE, not the wiring. This app holds passport scans,
 * immigration answers, and consultant conversations. A default Sentry setup
 * would ship request bodies, breadcrumb URLs containing application ids, user
 * emails, and — worst — screenshots. Every one of those is disabled below, and
 * `beforeSend` strips what the SDK collects anyway.
 */
const DSN = process.env.EXPO_PUBLIC_SENTRY_DSN ?? '';

/** Query/path fragments that must never leave the device inside a URL. */
const ID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi;
const EMAIL_PATTERN = /[^\s/@]+@[^\s/@]+\.[^\s/@]+/g;

/** Replace ids and emails in any free-text field with stable placeholders. */
export function scrub(value: string): string {
  return value.replace(ID_PATTERN, '<id>').replace(EMAIL_PATTERN, '<email>');
}

/**
 * Strip anything identifying from an event before it is transmitted. Exported
 * so the redaction rules are unit-testable without initialising the SDK.
 */
export function sanitizeEvent(event: Sentry.ErrorEvent): Sentry.ErrorEvent | null {
  // The SDK attaches the device user when it can; we only ever want an opaque id.
  if (event.user) {
    event.user = event.user.id ? { id: event.user.id } : {};
  }

  if (event.request) {
    if (event.request.url) event.request.url = scrub(event.request.url);
    // A request body from this app can contain an entire immigration form.
    delete event.request.data;
    delete event.request.cookies;
    if (event.request.headers) delete event.request.headers;
  }

  event.breadcrumbs = event.breadcrumbs?.map((crumb) => {
    const next = { ...crumb };
    if (next.message) next.message = scrub(next.message);
    if (next.data?.url && typeof next.data.url === 'string') {
      next.data = { ...next.data, url: scrub(next.data.url) };
    }
    // Console/UI breadcrumbs can capture typed text verbatim.
    if (next.category === 'console' || next.category === 'ui.input') return { ...next, data: undefined, message: undefined };
    return next;
  });

  if (event.message) event.message = scrub(event.message);
  event.exception?.values?.forEach((value) => {
    if (value.value) value.value = scrub(value.value);
  });

  return event;
}

/**
 * Initialise crash reporting. No-op when EXPO_PUBLIC_SENTRY_DSN is unset, so
 * development and CI never emit events. Returns whether it was enabled.
 */
export function initCrashReporting(): boolean {
  if (!DSN) return false;

  Sentry.init({
    dsn: DSN,
    environment: env.appEnv,
    // Never attach the IP address, email, or username the SDK can infer.
    sendDefaultPii: false,
    // Screenshots and view hierarchies would capture passport scans outright.
    attachScreenshot: false,
    attachViewHierarchy: false,
    // Performance tracing off: the spans would carry request URLs containing
    // application ids, and we have server-side APM for latency anyway.
    tracesSampleRate: 0,
    enableAutoSessionTracking: true,
    // Typed text must not become a breadcrumb.
    enableCaptureFailedRequests: false,
    beforeSend: (event) => sanitizeEvent(event),
    beforeBreadcrumb: (crumb) => {
      if (crumb.category === 'console' || crumb.category === 'ui.input') return null;
      return crumb;
    },
  });

  return true;
}

/**
 * Associate crashes with an account without leaking who it is: the Supabase
 * user id only — no email, no name.
 */
export function identifyForCrashReporting(userId: string | null): void {
  if (!DSN) return;
  Sentry.setUser(userId ? { id: userId } : null);
}

/** Report a handled error that the user was shown a failure state for. */
export function reportHandledError(error: unknown, context?: Record<string, string>): void {
  if (!DSN) return;
  Sentry.captureException(error, context ? { tags: context } : undefined);
}

import * as Crypto from 'expo-crypto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { env } from '@/config/env';
import { api } from '@/api/client';

/**
 * Mobile analytics SDK — the RN counterpart of apps/web/lib/analytics/client.ts,
 * posting the same event envelope to the same ingest route (POST /analytics/collect,
 * @AllowAnonymous). Keeping the wire format identical means the existing KPI
 * engine, funnels and dashboards work for mobile with no server change.
 *
 * PII policy (inherited from web): `props` may contain ids, enums and paths
 * only — never names, emails, free text, document contents, or anything from an
 * immigration form. Immigration data is exactly the category that must not leak
 * into an analytics pipeline.
 *
 * Fire-and-forget: never throws, never awaited by UI code, never blocks a screen.
 */
const ANON_ID_KEY = 'visaai.anonymousId';

export interface ClientEvent {
  event_id: string;
  name: string;
  occurred_at: string;
  anonymous_id: string | null;
  session_id: string | null;
  props: Record<string, string | number | boolean | null>;
}

let anonymousId: string | null = null;
let sessionId: string | null = null;
let identifiedUserId: string | null = null;
let queue: ClientEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

const MAX_QUEUE = 50;
const FLUSH_DELAY_MS = 2000;

/**
 * A stable per-install id so pre-signup activity can be joined to the account
 * after registration. Not a device fingerprint: it is app-scoped, regenerated
 * on reinstall, and lives in plain AsyncStorage because it identifies nothing
 * on its own.
 */
export async function loadAnonymousId(): Promise<string> {
  if (anonymousId) return anonymousId;
  const stored = await AsyncStorage.getItem(ANON_ID_KEY);
  if (stored) {
    anonymousId = stored;
    return stored;
  }
  const created = Crypto.randomUUID();
  anonymousId = created;
  await AsyncStorage.setItem(ANON_ID_KEY, created);
  return created;
}

function event(name: string, props: ClientEvent['props'] = {}): ClientEvent {
  return {
    event_id: Crypto.randomUUID(),
    name,
    occurred_at: new Date().toISOString(),
    anonymous_id: anonymousId,
    session_id: sessionId,
    props,
  };
}

async function post(events: ClientEvent[]): Promise<void> {
  if (!events.length) return;
  try {
    // `auth: 'optional'` — a signed-in user's events carry their token so the
    // server can attribute them; a guest's do not. Retries are off: a dropped
    // analytics batch is preferable to competing with real traffic on a flaky
    // cellular link.
    await api.post('/analytics/collect', { events }, { auth: 'optional', retries: 0 });
  } catch {
    // Swallowed by design — analytics must never surface an error to the user.
  }
}

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flush();
  }, FLUSH_DELAY_MS);
}

/** Send everything buffered right now (called on background/foreground swaps). */
export async function flush(): Promise<void> {
  if (!queue.length) return;
  const batch = queue;
  queue = [];
  await post(batch);
}

export const analytics = {
  track(name: string, props: ClientEvent['props'] = {}): void {
    if (!env.analyticsEnabled) return;
    queue.push(event(name, props));
    // Bound memory if the device has been offline for a long stretch: drop the
    // OLDEST events, because recent behaviour is the more useful signal.
    if (queue.length > MAX_QUEUE) queue = queue.slice(-MAX_QUEUE);
    scheduleFlush();
  },

  /** Screen view. `path` must be a route pattern, never an id-bearing URL. */
  screen(path: string): void {
    analytics.track('screen.viewed', { path });
  },

  startSession(): void {
    if (!env.analyticsEnabled) return;
    sessionId = Crypto.randomUUID();
    analytics.track('session.started', { platform: 'mobile', app_env: env.appEnv });
  },

  endSession(): void {
    if (!env.analyticsEnabled || !sessionId) return;
    analytics.track('session.ended');
    sessionId = null;
    void flush();
  },

  identify(userId: string): void {
    if (!env.analyticsEnabled || identifiedUserId === userId) return;
    identifiedUserId = userId;
    analytics.track('user.identified');
  },

  /** Test seam. */
  __reset(): void {
    queue = [];
    sessionId = null;
    identifiedUserId = null;
    anonymousId = null;
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = null;
  },

  __queueSize(): number {
    return queue.length;
  },
};

/**
 * Canonical event names. A frozen list beats free-form strings: a typo in a
 * screen becomes a silently-missing funnel step months later, and the KPI
 * engine keys off exact names.
 */
export const EVENTS = {
  onboardingStarted: 'onboarding.started',
  onboardingCompleted: 'onboarding.completed',
  authSignedUp: 'auth.signed_up',
  authSignedIn: 'auth.signed_in',
  authFailed: 'auth.failed',
  authBiometricUnlock: 'auth.biometric_unlock',
  eligibilityStarted: 'eligibility.started',
  eligibilityCompleted: 'eligibility.completed',
  applicationCreated: 'application.created',
  applicationStageCompleted: 'application.stage_completed',
  applicationSubmitted: 'application.submitted',
  documentUploadStarted: 'document.upload_started',
  documentUploadSucceeded: 'document.upload_succeeded',
  documentUploadFailed: 'document.upload_failed',
  bookingCreated: 'booking.created',
  bookingCancelled: 'booking.cancelled',
  paymentCheckoutStarted: 'payment.checkout_started',
  paymentReturned: 'payment.returned',
  messageSent: 'message.sent',
  pushRegistered: 'push.registered',
  pushOpened: 'push.opened',
  requestFailed: 'request.failed',
} as const;

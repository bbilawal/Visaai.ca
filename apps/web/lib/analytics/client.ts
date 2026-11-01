/**
 * Browser analytics SDK. Fire-and-forget wrapper around POST /analytics/collect
 * (see apps/api/src/modules/analytics). Never throws and never awaits from call
 * sites — a broken analytics call must not break the UX.
 *
 * PII policy: `props` may only contain ids, enums, and paths — never names,
 * emails, free-text, or other personally identifiable information.
 */
import { getAnonymousId } from './anonymous-id';
import { EventBuffer, type ClientEvent } from './flush';

const ENABLED = process.env.NEXT_PUBLIC_ANALYTICS_ENABLED !== 'false';
const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
const buffer = new EventBuffer(Number(process.env.NEXT_PUBLIC_ANALYTICS_MAX ?? 50));
let sessionId: string | null = null;
let identifiedUserId: string | null = null;

function evt(name: string, props: ClientEvent['props'] = {}): ClientEvent {
  return {
    event_id: crypto.randomUUID(),
    name,
    occurred_at: new Date().toISOString(),
    anonymous_id: getAnonymousId(),
    session_id: sessionId,
    props,
  };
}

async function post(events: ClientEvent[], token?: string): Promise<void> {
  if (!events.length) return;
  try {
    const body = JSON.stringify({ events });
    if (typeof navigator !== 'undefined' && navigator.sendBeacon && !token) {
      navigator.sendBeacon(`${API}/analytics/collect`, new Blob([body], { type: 'application/json' }));
      return;
    }
    if (typeof fetch === 'undefined') return;
    await fetch(`${API}/analytics/collect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body,
      keepalive: true,
    });
  } catch {
    // fail silent — analytics must never break UX
  }
}

export const analytics = {
  track(name: string, props: ClientEvent['props'] = {}, token?: string): void {
    if (!ENABLED) return;
    buffer.add(evt(name, props));
    void post(buffer.drain(), token);
  },
  page(path: string, token?: string): void {
    analytics.track('page.viewed', { path }, token);
  },
  startSession(): void {
    if (!ENABLED) return;
    sessionId = crypto.randomUUID();
    analytics.track('session.started');
  },
  endSession(): void {
    if (!ENABLED || !sessionId) return;
    buffer.add(evt('session.ended'));
    void post(buffer.drain());
    sessionId = null;
  },
  identify(userId: string, token?: string): void {
    if (!ENABLED || identifiedUserId === userId) return;
    identifiedUserId = userId;
    analytics.track('user.identified', {}, token);
  },
};

if (typeof window !== 'undefined' && ENABLED) {
  window.addEventListener('beforeunload', () => analytics.endSession());
}

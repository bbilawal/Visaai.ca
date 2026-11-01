import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Webhook signing, verification and retry policy. Pure.
 *
 * Signature scheme (documented in VISAAIDocs/partner-api/webhook-standard.md):
 *
 *   V-Signature: t=1730000000,v1=<hex>,v1=<hex>
 *   v1 = HMAC-SHA256( "<t>.<raw body>", secret )
 *
 * Two properties matter and both come from signing the TIMESTAMP TOGETHER WITH
 * the body:
 *   - an attacker cannot replay a captured payload outside the tolerance
 *     window, because the timestamp is inside the signed material
 *   - an attacker cannot move a valid signature onto a different body
 *
 * Multiple `v1` values appear during secret rotation: the payload is signed
 * with both the current and the previous secret so a partner can roll their
 * verifier without dropping events.
 */

export const SIGNATURE_VERSION = 'v1';
/** How far a timestamp may be from our clock. 5 minutes, matching Stripe. */
export const DEFAULT_TOLERANCE_SECONDS = 300;

/** The signed material. Exported so tests assert the exact string. */
export function signedPayload(timestampSeconds: number, body: string): string {
  return `${timestampSeconds}.${body}`;
}

export function computeSignature(
  body: string,
  secret: string,
  timestampSeconds: number,
): string {
  return createHmac('sha256', secret)
    .update(signedPayload(timestampSeconds, body))
    .digest('hex');
}

/**
 * Build the header value. `secrets` is current-first; during a rotation
 * window it also contains the previous secret.
 */
export function buildSignatureHeader(
  body: string,
  secrets: readonly string[],
  timestampSeconds: number,
): string {
  const parts = [`t=${timestampSeconds}`];
  for (const secret of secrets) {
    parts.push(
      `${SIGNATURE_VERSION}=${computeSignature(body, secret, timestampSeconds)}`,
    );
  }
  return parts.join(',');
}

export interface ParsedSignatureHeader {
  timestamp: number;
  signatures: string[];
}

/** Parse `t=...,v1=...` — tolerant of ordering and whitespace, nothing else. */
export function parseSignatureHeader(
  header: string,
): ParsedSignatureHeader | null {
  let timestamp: number | null = null;
  const signatures: string[] = [];
  for (const chunk of header.split(',')) {
    const [rawKey, rawValue] = chunk.split('=');
    if (rawValue === undefined) return null;
    const key = rawKey.trim();
    const value = rawValue.trim();
    if (key === 't') {
      if (!/^\d+$/.test(value)) return null;
      timestamp = Number(value);
    } else if (key === SIGNATURE_VERSION) {
      if (!/^[0-9a-f]+$/i.test(value)) return null;
      signatures.push(value.toLowerCase());
    }
    // Unknown keys are ignored so a future v2 does not break a v1 verifier.
  }
  if (timestamp === null || signatures.length === 0) return null;
  return { timestamp, signatures };
}

function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export type SignatureFailure =
  | 'malformed_header'
  | 'timestamp_outside_tolerance'
  | 'no_matching_signature';

export interface VerificationResult {
  valid: boolean;
  reason: SignatureFailure | null;
}

/**
 * Verify a received webhook. This is the reference implementation the SDK and
 * the docs both mirror — if it changes, they change.
 *
 * `nowSeconds` is injected so a partner's clock skew is their problem and our
 * tests are deterministic.
 */
export function verifySignature(
  body: string,
  header: string,
  secrets: readonly string[],
  nowSeconds: number,
  toleranceSeconds: number = DEFAULT_TOLERANCE_SECONDS,
): VerificationResult {
  const parsed = parseSignatureHeader(header);
  if (!parsed) return { valid: false, reason: 'malformed_header' };

  // Reject BOTH directions of skew. Allowing a far-future timestamp would let
  // an attacker mint a payload that stays replayable indefinitely.
  if (Math.abs(nowSeconds - parsed.timestamp) > toleranceSeconds) {
    return { valid: false, reason: 'timestamp_outside_tolerance' };
  }

  for (const secret of secrets) {
    const expected = computeSignature(body, secret, parsed.timestamp);
    for (const candidate of parsed.signatures) {
      if (constantTimeEquals(expected, candidate)) {
        return { valid: true, reason: null };
      }
    }
  }
  return { valid: false, reason: 'no_matching_signature' };
}

// ---- Retry policy ------------------------------------------------------

/**
 * Exponential backoff with full jitter, capped. Eight attempts spans roughly
 * 24 hours — long enough to ride out a partner's deploy, short enough that a
 * dead endpoint is declared dead the same day.
 *
 * Jitter is not decoration: without it, every delivery that failed during one
 * outage retries at the same instant and re-creates the outage.
 */
export const MAX_DELIVERY_ATTEMPTS = 8;
const BASE_DELAY_SECONDS = 10;
const MAX_DELAY_SECONDS = 6 * 3600;

/**
 * Delay before attempt number `attempt` (1-based: attempt 1 has already
 * failed when this is called). `random` is injected for deterministic tests.
 */
export function backoffSeconds(
  attempt: number,
  random: () => number = Math.random,
): number {
  const exponential = Math.min(
    MAX_DELAY_SECONDS,
    BASE_DELAY_SECONDS * 2 ** Math.max(0, attempt - 1),
  );
  // Full jitter over [exponential/2, exponential] — keeps a floor so a
  // hammered endpoint still gets breathing room.
  const half = exponential / 2;
  return Math.round(half + random() * half);
}

export interface DeliveryOutcome {
  statusCode: number | null;
  /** Transport-level failure (DNS, TLS, timeout, connection refused). */
  networkError: boolean;
}

export type DeliveryDecision =
  | { next: 'delivered' }
  | { next: 'retry'; delaySeconds: number }
  | { next: 'dead'; reason: string };

/**
 * What to do after one delivery attempt.
 *
 * 2xx is success. 410 Gone is a permanent, explicit "stop sending" and is not
 * retried — honouring it is the difference between a webhook system and a
 * denial-of-service. Other 4xx ARE retried: a 401 or 404 is usually a partner
 * mid-deploy, and giving up on the first one loses real events. They simply
 * run out of attempts like everything else.
 */
export function decideNextDelivery(
  outcome: DeliveryOutcome,
  attemptsSoFar: number,
  random: () => number = Math.random,
): DeliveryDecision {
  const status = outcome.statusCode;
  if (
    !outcome.networkError &&
    status !== null &&
    status >= 200 &&
    status < 300
  ) {
    return { next: 'delivered' };
  }
  if (status === 410) {
    return { next: 'dead', reason: 'endpoint returned 410 Gone' };
  }
  if (attemptsSoFar >= MAX_DELIVERY_ATTEMPTS) {
    return {
      next: 'dead',
      reason: `exhausted ${MAX_DELIVERY_ATTEMPTS} attempts`,
    };
  }
  return { next: 'retry', delaySeconds: backoffSeconds(attemptsSoFar, random) };
}

/**
 * Auto-disable threshold. An endpoint that has failed this many CONSECUTIVE
 * deliveries is disabled and the partner is told. Consecutive, not total:
 * a busy integration will accumulate failures forever otherwise.
 */
export const AUTO_DISABLE_AFTER_CONSECUTIVE_FAILURES = 20;

export function shouldAutoDisable(consecutiveFailures: number): boolean {
  return consecutiveFailures >= AUTO_DISABLE_AFTER_CONSECUTIVE_FAILURES;
}

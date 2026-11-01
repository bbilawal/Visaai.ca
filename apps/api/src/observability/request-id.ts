import { randomUUID } from 'node:crypto';

/**
 * OPS-004: request correlation for the WHOLE API, not just the partner surface.
 *
 * This logic already existed inside `partner-governance.ts` and was applied by
 * the partner response interceptor, so partner traffic had `X-Request-Id` while
 * every user-facing request had nothing — log lines from one request could not
 * be tied together. That matters more than usual while `SENTRY_DSN` is unset
 * (BLK-3), because structured logs are then the only production diagnostic
 * surface.
 *
 * It lives here now and `partner-governance` re-exports it, so there is one
 * implementation rather than two that can drift.
 *
 * A caller-supplied value is length-capped and character-filtered before it
 * ever reaches a log line or a response header: an unvalidated echo is a log
 * injection and a header-splitting vector.
 */
const MAX_REQUEST_ID_LENGTH = 64;
const REQUEST_ID_SAFE = /^[A-Za-z0-9._:-]+$/;

export function resolveRequestId(supplied: unknown): string {
  if (typeof supplied === 'string') {
    const trimmed = supplied.trim();
    if (
      trimmed.length > 0 &&
      trimmed.length <= MAX_REQUEST_ID_LENGTH &&
      REQUEST_ID_SAFE.test(trimmed)
    ) {
      return trimmed;
    }
  }
  return `req_${randomUUID().replace(/-/g, '')}`;
}

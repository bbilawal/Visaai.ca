import { createHash } from 'node:crypto';

/**
 * API governance primitives: request identity, idempotency hashing, cursor
 * pagination, versioning and deprecation. Pure functions shared by the
 * interceptors and the controllers, so the rules are stated once.
 */

// ---- Versioning --------------------------------------------------------

export const CURRENT_API_VERSION = 'v1';
export const SUPPORTED_API_VERSIONS = ['v1'] as const;
export type ApiVersion = (typeof SUPPORTED_API_VERSIONS)[number];

export function isSupportedVersion(value: string): value is ApiVersion {
  return (SUPPORTED_API_VERSIONS as readonly string[]).includes(value);
}

/**
 * A deprecated version keeps working until its sunset date, and every response
 * says so in headers a machine can act on (RFC 8594 `Sunset`, RFC 9745-style
 * `Deprecation`). Empty today — v1 is current — but the mechanism ships with
 * v1 rather than being retrofitted when v2 arrives, which is the only time it
 * is cheap to add.
 */
export interface DeprecationNotice {
  version: string;
  /** RFC 1123 date the version was marked deprecated. */
  deprecatedAt: string;
  /** RFC 1123 date after which it stops responding. */
  sunsetAt: string;
  successor: string;
  docUrl: string;
}

export const DEPRECATED_VERSIONS: Record<string, DeprecationNotice> = {};

export function deprecationHeaders(
  version: string,
): Record<string, string> | null {
  const notice = DEPRECATED_VERSIONS[version];
  if (!notice) return null;
  return {
    Deprecation: notice.deprecatedAt,
    Sunset: notice.sunsetAt,
    Link: `<${notice.docUrl}>; rel="deprecation"; type="text/html"`,
  };
}

// ---- Request identity --------------------------------------------------

/**
 * Every partner request gets an id. If the caller supplied one we keep it
 * (distributed tracing across their system and ours), otherwise we mint one.
 *
 * A caller-supplied value is length-capped and character-filtered before it
 * ever reaches a log line or a response header: an unvalidated echo is a log
 * injection and a header-splitting vector.
 */
// OPS-004: the single implementation now lives in observability/request-id so
// the whole API shares it, not just partner routes. Re-exported here so every
// existing `from './partner-governance'` import keeps working.
export { resolveRequestId } from '../../observability/request-id';

// ---- Idempotency -------------------------------------------------------

export const IDEMPOTENCY_TTL_HOURS = 24;
const MAX_IDEMPOTENCY_KEY_LENGTH = 255;

export function isValidIdempotencyKey(key: string): boolean {
  return (
    key.length > 0 &&
    key.length <= MAX_IDEMPOTENCY_KEY_LENGTH &&
    /^[A-Za-z0-9._:-]+$/.test(key)
  );
}

/**
 * Fingerprint of the request an idempotency key was first used for. Method and
 * path are included, not just the body: reusing a key on a different route is
 * a client bug we must catch, and two routes can legitimately take the same
 * body.
 */
export function idempotencyRequestHash(
  method: string,
  routeTemplate: string,
  body: unknown,
): string {
  return createHash('sha256')
    .update(`${method.toUpperCase()} ${routeTemplate}\n${canonicalJson(body)}`)
    .digest('hex');
}

/** Deterministic JSON — key order must not change the fingerprint. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canon(value));
}

function canon(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canon);
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) out[key] = canon(obj[key]);
  return out;
}

export function idempotencyExpiry(now: Date): string {
  return new Date(
    now.getTime() + IDEMPOTENCY_TTL_HOURS * 3_600_000,
  ).toISOString();
}

// ---- Pagination --------------------------------------------------------

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

export interface PageRequest {
  limit: number;
  cursor: string | null;
}

/**
 * Cursor pagination, not offset. Offset pagination silently skips or repeats
 * rows when the underlying set changes between pages, which for an audit-bound
 * API means a partner can miss an application and never know.
 *
 * The cursor is an opaque base64 of `<iso timestamp>|<uuid>` — the sort key
 * plus a tiebreaker, so two rows created in the same millisecond still order
 * deterministically.
 */
export function encodeCursor(createdAt: string, id: string): string {
  return Buffer.from(`${createdAt}|${id}`, 'utf8').toString('base64url');
}

export interface DecodedCursor {
  createdAt: string;
  id: string;
}

export function decodeCursor(cursor: string): DecodedCursor | null {
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    const sep = raw.indexOf('|');
    if (sep <= 0) return null;
    const createdAt = raw.slice(0, sep);
    const id = raw.slice(sep + 1);
    if (Number.isNaN(Date.parse(createdAt))) return null;
    if (!id) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

/** Clamp an untrusted `limit`. A partner asking for 10000 gets MAX_PAGE_SIZE. */
export function clampLimit(raw: unknown): number {
  const n = typeof raw === 'string' ? Number(raw) : Number(raw ?? NaN);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_PAGE_SIZE;
  return Math.min(MAX_PAGE_SIZE, Math.floor(n));
}

/**
 * Build a page from `limit + 1` fetched rows: the extra row is how we know
 * whether there is a next page without a second COUNT query.
 */
export function buildPage<T extends { id: string; created_at: string }>(
  rows: T[],
  limit: number,
): { data: T[]; has_more: boolean; next_cursor: string | null } {
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  const last = data[data.length - 1];
  return {
    data,
    has_more: hasMore,
    next_cursor:
      hasMore && last ? encodeCursor(last.created_at, last.id) : null,
  };
}

// ---- Request limits ----------------------------------------------------

/** 1 MiB. Partner endpoints exchange JSON, never file contents. */
export const MAX_REQUEST_BYTES = 1_048_576;
/** Upstream timeout for one partner request. */
export const REQUEST_TIMEOUT_MS = 15_000;

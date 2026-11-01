/**
 * Reading scalars out of an untyped PostgREST row.
 *
 * `SupabaseClient` resolves to `SupabaseClient<any>` in this codebase
 * (DEBT-001 / RT-026 — see shared/supabase/supabase.service.ts for why the
 * generated types are committed but not yet bound), so every `.select()`
 * returns `Record<string, unknown>` at best. The obvious way to read a column
 * is `String(row.foo)`.
 *
 * `String(row.foo)` is wrong in two directions and both reach users here.
 *
 *   - On null or undefined it produces the literal strings `"null"` and
 *     `"undefined"`. Those go into `kb_review_queue.title`, into log lines and
 *     into citation fields, so a missing authority renders as
 *     "Source not verified: undefined".
 *   - On an object — which is what a PostgREST embedded join returns for a
 *     related table — it produces `"[object Object]"`, silently, forever.
 *
 * These helpers make the null case explicit and the object case loud, so a
 * shape change surfaces as a visible marker in one field rather than as
 * plausible-looking text in a review ticket nobody re-reads.
 */

/** A scalar column as text. Null/undefined become `fallback` (default `''`). */
export function asText(value: unknown, fallback = ''): string {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string') return value;
  if (
    typeof value === 'number' ||
    typeof value === 'bigint' ||
    typeof value === 'boolean'
  ) {
    return String(value);
  }
  if (value instanceof Date) return value.toISOString();
  // An object here means the query shape changed — an embedded join where a
  // scalar was expected. Say so rather than emitting "[object Object]".
  return '[unexpected object]';
}

/** A nullable column: null/undefined stay null rather than becoming a string. */
export function asTextOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return asText(value);
}

/** A numeric column, or `fallback` when absent or unparseable. */
export function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

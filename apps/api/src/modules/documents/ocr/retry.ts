/**
 * Shared retry + timeout helper for OCR provider calls. Each provider wraps its
 * remote call with this so retry/timeout behavior is uniform and auditable.
 *
 * Dry run 2026-10-14 (prod): 6 of 10 documents uploaded ~6s apart failed with
 * HTTP 429 from Azure. Retries used to fire back-to-back, so every one landed
 * in the same throttle window. They now back off — honouring the service's
 * Retry-After when it sends one — and an error that will fail the same way on
 * every attempt (a 4xx other than 408/429) is not retried at all.
 */

/** An HTTP failure from an OCR vendor, carrying what the retry policy needs. */
export class OcrHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'OcrHttpError';
  }
}

/** A failure that is a property of the document/request, not of the moment. */
export class NonRetryableOcrError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NonRetryableOcrError';
  }
}

export function isRetryableStatus(status: number): boolean {
  return (
    status === 408 ||
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504
  );
}

/** Network errors and timeouts are transient; so are 408/429/5xx. */
export function isRetryableError(err: unknown): boolean {
  if (err instanceof NonRetryableOcrError) return false;
  if (err instanceof OcrHttpError) return isRetryableStatus(err.status);
  return true;
}

/** Longest single wait we will honour from a Retry-After header. */
export const MAX_RETRY_DELAY_MS = 30_000;

/**
 * Retry-After as milliseconds. Azure sends `retry-after-ms` /
 * `x-ms-retry-after-ms` on throttling, and the standard `retry-after` in
 * seconds or as an HTTP date.
 */
export function parseRetryAfterMs(
  headers: Pick<Headers, 'get'> | undefined | null,
  now: number = Date.now(),
): number | undefined {
  if (!headers || typeof headers.get !== 'function') return undefined;
  for (const name of ['retry-after-ms', 'x-ms-retry-after-ms']) {
    const v = headers.get(name);
    if (v != null && /^\d+(\.\d+)?$/.test(v.trim())) {
      return Math.round(Number(v));
    }
  }
  const ra = headers.get('retry-after');
  if (ra == null) return undefined;
  const s = ra.trim();
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(Number(s) * 1000);
  const at = Date.parse(s);
  if (!Number.isNaN(at)) return Math.max(0, at - now);
  return undefined;
}

export const defaultSleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

export interface RetryTimeoutOptions {
  attempts?: number;
  timeoutMs?: number;
  /** First backoff step when the service gives no Retry-After (default 1s). */
  baseDelayMs?: number;
  /** Cap on any single wait (default 30s). */
  maxDelayMs?: number;
  /** Called once per attempt for audit logging. */
  onAttempt?: (attempt: number) => void;
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable for tests; returns [0, 1). */
  random?: () => number;
}

export function retryDelayMs(
  attempt: number,
  err: unknown,
  opts: Pick<RetryTimeoutOptions, 'baseDelayMs' | 'maxDelayMs' | 'random'>,
): number {
  const max = opts.maxDelayMs ?? MAX_RETRY_DELAY_MS;
  const random = opts.random ?? Math.random;
  if (err instanceof OcrHttpError && err.retryAfterMs !== undefined) {
    return Math.min(max, err.retryAfterMs);
  }
  const base = (opts.baseDelayMs ?? 1000) * 2 ** (attempt - 1);
  return Math.min(max, Math.round(base * (1 + 0.25 * random())));
}

export async function withRetryTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  opts: RetryTimeoutOptions = {},
): Promise<T> {
  const attempts = opts.attempts ?? 3;
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const sleep = opts.sleep ?? defaultSleep;

  for (let attempt = 1; ; attempt++) {
    opts.onAttempt?.(attempt);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fn(controller.signal);
    } catch (err) {
      if (attempt >= attempts || !isRetryableError(err)) {
        throw err instanceof Error ? err : new Error('OCR call failed');
      }
      clearTimeout(timer);
      await sleep(retryDelayMs(attempt, err, opts));
    } finally {
      clearTimeout(timer);
    }
  }
}

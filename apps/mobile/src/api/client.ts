import { env } from '@/config/env';
import { ApiError, kindForStatus, type ApiErrorEnvelope } from './errors';
import type { Validator } from './validate';

/**
 * The one HTTP client. Every screen goes through `api.*`, which gives us a
 * single place for: bearer-token injection, timeouts, bounded retry with
 * jittered backoff, uniform error typing, and redacted logging.
 *
 * Mirrors apps/web/lib/api/client.ts (same base URL env var, same
 * `Authorization: Bearer <supabase access token>` contract enforced by
 * JwtGuard) and adds the parts a mobile network needs: cellular flakiness
 * retry, request cancellation, and offline classification.
 */
export type TokenProvider = () => Promise<string | null>;

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  /** Override the default auth behaviour (default: attach when available). */
  auth?: 'required' | 'optional' | 'none';
  query?: Record<string, string | number | boolean | undefined | null>;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Extra attempts after the first. Non-idempotent verbs default to 0. */
  retries?: number;
  headers?: Record<string, string>;
  /**
   * Runtime shape check applied to a 2xx body. Without this the generic `T` is
   * an unverified assertion — see src/api/validate.ts for why that mattered.
   */
  validate?: Validator<unknown>;
}

const IDEMPOTENT = new Set(['GET', 'HEAD']);
const MAX_BACKOFF_MS = 8000;

let tokenProvider: TokenProvider = async () => null;

/** Wired once at startup (src/auth/session.tsx) to avoid an import cycle. */
export function setTokenProvider(provider: TokenProvider): void {
  tokenProvider = provider;
}

type UnauthorizedHandler = () => void;
let onUnauthorized: UnauthorizedHandler = () => {};

/** Called when the API rejects a token that supabase-js still believes in. */
export function setUnauthorizedHandler(handler: UnauthorizedHandler): void {
  onUnauthorized = handler;
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const base = `${env.apiUrl}${path.startsWith('/') ? path : `/${path}`}`;
  if (!query) return base;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null) params.append(k, String(v));
  }
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

function backoffMs(attempt: number, retryAfterHeader?: string | null): number {
  // Honour Retry-After from the throttler (apps/api uses @nestjs/throttler).
  if (retryAfterHeader) {
    const secs = Number(retryAfterHeader);
    if (Number.isFinite(secs) && secs > 0) return Math.min(secs * 1000, MAX_BACKOFF_MS);
  }
  const exp = Math.min(500 * 2 ** attempt, MAX_BACKOFF_MS);
  // Full jitter — a cell tower reconnect wakes every client at once, and
  // unjittered backoff would make them stampede the API in lockstep.
  return Math.random() * exp;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    // addEventListener never fires on an already-aborted signal, so without
    // this a cancel landing just before a backoff still waited the full 8s.
    return Promise.reject(
      new ApiError({ kind: 'cancelled', status: 0, message: 'Request cancelled' }),
    );
  }
  return new Promise((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new ApiError({ kind: 'cancelled', status: 0, message: 'Request cancelled' }));
    };
    const timer = setTimeout(() => {
      // Detach on the normal path too: a polling screen that reuses one
      // controller accumulated a dead listener per retry.
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function parseBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function classifyThrown(
  e: unknown,
  timedOut: boolean,
  path: string,
  cancelled = false,
): ApiError {
  if (e instanceof ApiError) return e;
  // A deliberate abort is not a transport failure. Reporting it as one showed
  // "Couldn't reach VisaAI" for an ordinary screen unmount, and pushed
  // cancelled work into the offline retry path.
  if (cancelled) {
    return new ApiError({ kind: 'cancelled', status: 0, message: 'Request cancelled', path });
  }
  if (timedOut) {
    return new ApiError({ kind: 'timeout', status: 0, message: 'Request timed out', path });
  }
  // React Native surfaces every transport failure as `TypeError: Network request failed`.
  const message = e instanceof Error ? e.message : String(e);
  return new ApiError({ kind: 'network', status: 0, message, path });
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const authMode = options.auth ?? 'optional';
  const maxRetries = options.retries ?? (IDEMPOTENT.has(method) ? 2 : 0);
  const url = buildUrl(path, options.query);

  let attempt = 0;
  while (true) {
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, options.timeoutMs ?? env.requestTimeoutMs);
    const onOuterAbort = (): void => controller.abort();
    options.signal?.addEventListener('abort', onOuterAbort, { once: true });

    try {
      const token = authMode === 'none' ? null : await tokenProvider();
      if (authMode === 'required' && !token) {
        throw new ApiError({
          kind: 'unauthorized',
          status: 401,
          message: 'No active session',
          path,
        });
      }

      const res = await fetch(url, {
        method,
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...options.headers,
        },
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      });

      if (res.ok) {
        const body = await parseBody(res);
        return (options.validate ? options.validate(body, path) : body) as T;
      }

      const body = (await parseBody(res)) as ApiErrorEnvelope | undefined;
      const kind = kindForStatus(res.status, body);
      const error = new ApiError({
        kind,
        status: res.status,
        message: body?.message ?? `${method} ${path} → ${res.status}`,
        details: body?.details,
        path,
      });

      if (kind === 'unauthorized') onUnauthorized();

      if (error.retryable && attempt < maxRetries) {
        await sleep(backoffMs(attempt, res.headers.get('retry-after')), options.signal);
        attempt += 1;
        continue;
      }
      throw error;
    } catch (e) {
      const error = classifyThrown(e, timedOut, path, options.signal?.aborted === true);
      // An explicit caller-side cancel must not be retried or reported.
      if (options.signal?.aborted) throw error;
      if (error.retryable && attempt < maxRetries) {
        await sleep(backoffMs(attempt), options.signal);
        attempt += 1;
        continue;
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', onOuterAbort);
    }
  }
}

export const api = {
  get: <T>(path: string, options?: Omit<RequestOptions, 'method' | 'body'>): Promise<T> =>
    request<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method'>): Promise<T> =>
    request<T>(path, { ...options, method: 'POST', body }),
  patch: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method'>): Promise<T> =>
    request<T>(path, { ...options, method: 'PATCH', body }),
  put: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method'>): Promise<T> =>
    request<T>(path, { ...options, method: 'PUT', body }),
  delete: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method'>): Promise<T> =>
    request<T>(path, { ...options, method: 'DELETE', body }),
};

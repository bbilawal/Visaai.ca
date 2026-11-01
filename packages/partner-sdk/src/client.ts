import type {
  PartnerApiProduct,
  PartnerPage,
  PartnerTokenResponse,
  PartnerUsageSnapshot,
  PartnerWebhookDelivery,
  PartnerWebhookEndpoint,
} from '@visaai/types';
import { VisaAiApiError, VisaAiConnectionError } from './errors';

export interface VisaAiClientOptions {
  /** API key (`vak_live_…` / `vak_test_…`) or OAuth access token (`vat_…`). */
  apiKey?: string;
  /** Base URL. Defaults to production. */
  baseUrl?: string;
  /** Per-request timeout in ms. Default 30s. */
  timeoutMs?: number;
  /** Retry attempts for transient failures. Default 3, set 0 to disable. */
  maxRetries?: number;
  /** Injectable for tests. Defaults to global fetch. */
  fetch?: typeof fetch;
  /** Injectable sleep, so retry tests do not actually wait. */
  sleep?: (ms: number) => Promise<void>;
}

interface RequestOptions {
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  idempotencyKey?: string;
  /** Overrides the client default; used to disable retries per call. */
  maxRetries?: number;
}

const DEFAULT_BASE_URL = 'https://api.visaai.example';
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 3;

/**
 * Client for the VisaAI Partner API.
 *
 * Retry policy: transient failures (429, 5xx, network) are retried with
 * exponential backoff, honouring `Retry-After` when the server sends one. A
 * 4xx is never retried — a 403 for a missing scope will be a 403 next time
 * too, and retrying it only burns the partner's quota.
 *
 * Every mutating call accepts an idempotency key. It is not sent by default:
 * generating one silently would make retries safe in a way the caller did not
 * ask for and cannot reason about.
 */
export class VisaAiClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private apiKey: string | undefined;

  constructor(options: VisaAiClientOptions = {}) {
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.sleep =
      options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  }

  /** Swap the credential in place, e.g. after refreshing an OAuth token. */
  setCredential(credential: string): void {
    this.apiKey = credential;
  }

  // ---- OAuth --------------------------------------------------------------

  /**
   * Exchange client credentials for an access token and start using it.
   *
   * Sent unauthenticated by design: this is how a client with no token gets
   * one.
   */
  async authenticateWithClientCredentials(
    clientId: string,
    clientSecret: string,
    scope?: string,
  ): Promise<PartnerTokenResponse> {
    const token = await this.request<PartnerTokenResponse>(
      'POST',
      '/partner/oauth/token',
      {
        body: {
          grant_type: 'client_credentials',
          client_id: clientId,
          client_secret: clientSecret,
          ...(scope ? { scope } : {}),
        },
      },
      false,
    );
    this.apiKey = token.access_token;
    return token;
  }

  async revokeToken(
    clientId: string,
    clientSecret: string,
    token: string,
  ): Promise<void> {
    await this.request(
      'POST',
      '/partner/oauth/revoke',
      { body: { client_id: clientId, client_secret: clientSecret, token } },
      false,
    );
  }

  // ---- identity, catalog, usage --------------------------------------------

  me(): Promise<Record<string, unknown>> {
    return this.request('GET', '/v1/me');
  }

  catalog(): Promise<{
    available: PartnerApiProduct[];
    all: PartnerApiProduct[];
  }> {
    return this.request('GET', '/v1/catalog');
  }

  usage(): Promise<PartnerUsageSnapshot> {
    return this.request('GET', '/v1/usage');
  }

  // ---- webhooks -------------------------------------------------------------

  eventTypes(): Promise<{ data: string[] }> {
    return this.request('GET', '/v1/webhooks/events');
  }

  listWebhooks(): Promise<PartnerWebhookEndpoint[]> {
    return this.request('GET', '/v1/webhooks');
  }

  createWebhook(
    input: { url: string; events: string[]; description?: string },
    idempotencyKey?: string,
  ): Promise<{ endpoint: PartnerWebhookEndpoint; secret: string }> {
    return this.request('POST', '/v1/webhooks', { body: input, idempotencyKey });
  }

  verifyWebhookEndpoint(id: string): Promise<PartnerWebhookEndpoint> {
    return this.request('POST', `/v1/webhooks/${id}/verify`);
  }

  updateWebhookEvents(id: string, events: string[]): Promise<PartnerWebhookEndpoint> {
    return this.request('POST', `/v1/webhooks/${id}`, { body: { events } });
  }

  rotateWebhookSecret(
    id: string,
  ): Promise<{ secret: string; previousValidUntil: string }> {
    return this.request('POST', `/v1/webhooks/${id}/rotate-secret`);
  }

  deleteWebhook(id: string): Promise<{ deleted: true }> {
    return this.request('DELETE', `/v1/webhooks/${id}`);
  }

  listDeliveries(
    id: string,
    options: { limit?: number; cursor?: string } = {},
  ): Promise<PartnerPage<PartnerWebhookDelivery>> {
    return this.request('GET', `/v1/webhooks/${id}/deliveries`, {
      query: { limit: options.limit, cursor: options.cursor },
    });
  }

  replayDelivery(id: string, deliveryId: string): Promise<PartnerWebhookDelivery> {
    return this.request(
      'POST',
      `/v1/webhooks/${id}/deliveries/${deliveryId}/replay`,
    );
  }

  // ---- immigration resources -------------------------------------------------

  listApplications(userId?: string): Promise<Record<string, unknown>[]> {
    return this.request('GET', '/v1/applications', { query: { user_id: userId } });
  }

  getApplication(id: string): Promise<Record<string, unknown>> {
    return this.request('GET', `/v1/applications/${id}`);
  }

  createApplication(
    input: {
      user_id?: string;
      country?: string;
      visa_type?: string;
      framework_id?: string;
    },
    idempotencyKey?: string,
  ): Promise<Record<string, unknown>> {
    return this.request('POST', '/v1/applications', { body: input, idempotencyKey });
  }

  listDocuments(applicationId: string): Promise<Record<string, unknown>[]> {
    return this.request('GET', `/v1/applications/${applicationId}/documents`);
  }

  listConsents(
    options: { limit?: number; cursor?: string } = {},
  ): Promise<PartnerPage<Record<string, unknown>>> {
    return this.request('GET', '/v1/consents', {
      query: { limit: options.limit, cursor: options.cursor },
    });
  }

  // ---- sandbox ---------------------------------------------------------------

  sandboxPersonas(): Promise<{ data: Record<string, unknown>[] }> {
    return this.request('GET', '/v1/sandbox/personas');
  }

  resetSandbox(): Promise<{ deleted: number }> {
    return this.request('POST', '/v1/sandbox/reset');
  }

  // ---- pagination -------------------------------------------------------------

  /**
   * Walk every page of a cursor-paginated endpoint.
   *
   * A generator rather than an array: a partner with 50,000 consents should
   * not have to hold all of them in memory to look at the first one.
   */
  async *paginate<T>(
    fetchPage: (cursor?: string) => Promise<PartnerPage<T>>,
  ): AsyncGenerator<T, void, undefined> {
    let cursor: string | undefined;
    for (;;) {
      const page = await fetchPage(cursor);
      for (const item of page.data) yield item;
      if (!page.has_more || !page.next_cursor) return;
      cursor = page.next_cursor;
    }
  }

  // ---- transport ----------------------------------------------------------------

  private async request<T>(
    method: string,
    path: string,
    options: RequestOptions = {},
    authenticated = true,
  ): Promise<T> {
    const url = new URL(this.baseUrl + path);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    const headers: Record<string, string> = {
      Accept: 'application/json',
      'User-Agent': 'visaai-partner-sdk/0.1.0',
    };
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    if (authenticated) {
      if (!this.apiKey) {
        throw new Error(
          'No credential configured. Pass `apiKey` or call authenticateWithClientCredentials().',
        );
      }
      headers.Authorization = `Bearer ${this.apiKey}`;
    }
    if (options.idempotencyKey) {
      headers['Idempotency-Key'] = options.idempotencyKey;
    }

    const attempts = (options.maxRetries ?? this.maxRetries) + 1;
    let lastError: unknown;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const response = await this.send(url.toString(), method, headers, options.body);
        const requestId = response.headers.get('X-Request-Id') ?? '';
        const text = await response.text();
        const parsed = text ? safeJson(text) : undefined;

        if (response.ok) return parsed as T;

        const error = new VisaAiApiError(response.status, parsed, requestId);
        if (!error.isRetryable || attempt === attempts) throw error;
        lastError = error;
        await this.sleep(this.backoffMs(attempt, error.retryAfter));
        continue;
      } catch (err) {
        if (err instanceof VisaAiApiError) {
          if (!err.isRetryable || attempt === attempts) throw err;
          lastError = err;
          await this.sleep(this.backoffMs(attempt, err.retryAfter));
          continue;
        }
        // Network / abort. Retryable, up to the budget.
        lastError = err;
        if (attempt === attempts) throw new VisaAiConnectionError(err);
        await this.sleep(this.backoffMs(attempt, null));
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new VisaAiConnectionError(lastError);
  }

  private async send(
    url: string,
    method: string,
    headers: Record<string, string>,
    body: unknown,
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * `Retry-After` wins when the server sent one — it knows when the window
   * resets and we are only guessing. Otherwise exponential with jitter.
   */
  private backoffMs(attempt: number, retryAfterSeconds: number | null): number {
    if (retryAfterSeconds !== null && retryAfterSeconds >= 0) {
      return retryAfterSeconds * 1000;
    }
    const base = Math.min(30_000, 500 * 2 ** (attempt - 1));
    return Math.round(base / 2 + Math.random() * (base / 2));
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

import { VisaAiClient } from './client';
import { VisaAiApiError, VisaAiConnectionError } from './errors';

interface StubResponse {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
  networkError?: boolean;
}

/** Minimal fetch stub — no network, no timers. */
function stubFetch(responses: StubResponse[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) throw new Error('unexpected extra request');
    if (next.networkError) throw new Error('ECONNRESET');
    return {
      ok: next.status >= 200 && next.status < 300,
      status: next.status,
      headers: {
        get: (name: string) => next.headers?.[name] ?? null,
      },
      text: async () => (next.body === undefined ? '' : JSON.stringify(next.body)),
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

function client(responses: StubResponse[], overrides = {}) {
  const { impl, calls } = stubFetch(responses);
  return {
    calls,
    sdk: new VisaAiClient({
      apiKey: 'vak_test_0011223344556677_secretsecretsecretsecretsecret1',
      baseUrl: 'https://api.test',
      fetch: impl,
      sleep: async () => undefined,
      ...overrides,
    }),
  };
}

describe('VisaAiClient — requests', () => {
  it('sends the credential as a bearer token', async () => {
    const { sdk, calls } = client([{ status: 200, body: { client_id: 'c1' } }]);
    await sdk.me();
    expect(
      (calls[0].init.headers as Record<string, string>).Authorization,
    ).toMatch(/^Bearer vak_test_/);
  });

  it('builds the URL from the base and path', async () => {
    const { sdk, calls } = client([{ status: 200, body: {} }]);
    await sdk.me();
    expect(calls[0].url).toBe('https://api.test/v1/me');
  });

  it('appends query parameters and skips undefined ones', async () => {
    const { sdk, calls } = client([{ status: 200, body: [] }]);
    await sdk.listApplications('user-1');
    expect(calls[0].url).toBe('https://api.test/v1/applications?user_id=user-1');

    const second = client([{ status: 200, body: [] }]);
    await second.sdk.listApplications();
    expect(second.calls[0].url).toBe('https://api.test/v1/applications');
  });

  it('sends the idempotency key only when given one', async () => {
    const { sdk, calls } = client([{ status: 200, body: {} }]);
    await sdk.createApplication({ user_id: 'u1' }, 'order-1');
    expect(
      (calls[0].init.headers as Record<string, string>)['Idempotency-Key'],
    ).toBe('order-1');

    const second = client([{ status: 200, body: {} }]);
    await second.sdk.createApplication({ user_id: 'u1' });
    expect(
      (second.calls[0].init.headers as Record<string, string>)['Idempotency-Key'],
    ).toBeUndefined();
  });

  it('refuses to send an authenticated request with no credential', async () => {
    const sdk = new VisaAiClient({ baseUrl: 'https://api.test' });
    await expect(sdk.me()).rejects.toThrow(/No credential configured/);
  });

  it('sends the token request unauthenticated', async () => {
    const { impl, calls } = stubFetch([
      { status: 200, body: { access_token: 'vat_x', expires_in: 3600 } },
    ]);
    const sdk = new VisaAiClient({ baseUrl: 'https://api.test', fetch: impl });
    await sdk.authenticateWithClientCredentials('c1', 's1');
    expect(
      (calls[0].init.headers as Record<string, string>).Authorization,
    ).toBeUndefined();
  });

  it('adopts the token it just obtained', async () => {
    const { impl, calls } = stubFetch([
      { status: 200, body: { access_token: 'vat_x', expires_in: 3600 } },
      { status: 200, body: {} },
    ]);
    const sdk = new VisaAiClient({ baseUrl: 'https://api.test', fetch: impl });
    await sdk.authenticateWithClientCredentials('c1', 's1');
    await sdk.me();
    expect((calls[1].init.headers as Record<string, string>).Authorization).toBe(
      'Bearer vat_x',
    );
  });
});

describe('VisaAiClient — errors', () => {
  it('throws a typed error carrying the request id', async () => {
    const { sdk } = client([
      {
        status: 403,
        headers: { 'X-Request-Id': 'req_123' },
        body: {
          error: {
            type: 'permission_error',
            code: 'insufficient_scope',
            message: 'needs applications:read',
            request_id: 'req_123',
          },
        },
      },
    ]);
    await expect(sdk.me()).rejects.toMatchObject({
      status: 403,
      code: 'insufficient_scope',
      requestId: 'req_123',
      type: 'permission_error',
    });
  });

  // maxRetries: 0 — a 502 is retryable, and this test is about the error
  // shape, not the retry loop.
  it('surfaces the request id even when the body is not our envelope', async () => {
    const { sdk } = client(
      [{ status: 502, headers: { 'X-Request-Id': 'req_9' }, body: 'gateway' }],
      { maxRetries: 0 },
    );
    await expect(sdk.me()).rejects.toMatchObject({ requestId: 'req_9' });
  });

  it('classifies retryability', () => {
    const transient = new VisaAiApiError(503, undefined, 'r');
    const permanent = new VisaAiApiError(403, undefined, 'r');
    expect(transient.isRetryable).toBe(true);
    expect(permanent.isRetryable).toBe(false);
  });

  it('wraps a network failure', async () => {
    const { sdk } = client([{ status: 0, networkError: true }], { maxRetries: 0 });
    await expect(sdk.me()).rejects.toBeInstanceOf(VisaAiConnectionError);
  });
});

describe('VisaAiClient — retries', () => {
  it('retries a 503 and returns the eventual success', async () => {
    const { sdk, calls } = client([
      { status: 503, body: {} },
      { status: 200, body: { client_id: 'c1' } },
    ]);
    await expect(sdk.me()).resolves.toEqual({ client_id: 'c1' });
    expect(calls).toHaveLength(2);
  });

  it('retries a 429', async () => {
    const { sdk, calls } = client([
      {
        status: 429,
        body: {
          error: {
            type: 'rate_limit_error',
            code: 'rate_limit_exceeded',
            message: 'slow down',
            request_id: 'r',
            retry_after: 1,
          },
        },
      },
      { status: 200, body: {} },
    ]);
    await sdk.me();
    expect(calls).toHaveLength(2);
  });

  it('retries a network failure', async () => {
    const { sdk, calls } = client([
      { status: 0, networkError: true },
      { status: 200, body: {} },
    ]);
    await sdk.me();
    expect(calls).toHaveLength(2);
  });

  // Retrying a 403 cannot help and burns the partner's quota.
  it('does not retry a 4xx', async () => {
    const { sdk, calls } = client([{ status: 403, body: {} }]);
    await expect(sdk.me()).rejects.toBeInstanceOf(VisaAiApiError);
    expect(calls).toHaveLength(1);
  });

  it('gives up after the retry budget', async () => {
    const { sdk, calls } = client(
      [
        { status: 503, body: {} },
        { status: 503, body: {} },
        { status: 503, body: {} },
      ],
      { maxRetries: 2 },
    );
    await expect(sdk.me()).rejects.toMatchObject({ status: 503 });
    expect(calls).toHaveLength(3);
  });

  it('honours retries: 0', async () => {
    const { sdk, calls } = client([{ status: 503, body: {} }], { maxRetries: 0 });
    await expect(sdk.me()).rejects.toMatchObject({ status: 503 });
    expect(calls).toHaveLength(1);
  });

  // The server knows when its window resets; we are only guessing.
  it('waits the interval the server asked for', async () => {
    const waits: number[] = [];
    const { impl } = stubFetch([
      {
        status: 429,
        body: {
          error: {
            type: 'rate_limit_error',
            code: 'rate_limit_exceeded',
            message: 'x',
            request_id: 'r',
            retry_after: 7,
          },
        },
      },
      { status: 200, body: {} },
    ]);
    const sdk = new VisaAiClient({
      apiKey: 'k',
      baseUrl: 'https://api.test',
      fetch: impl,
      sleep: async (ms) => {
        waits.push(ms);
      },
    });
    await sdk.me();
    expect(waits).toEqual([7000]);
  });
});

describe('VisaAiClient — pagination', () => {
  it('walks every page', async () => {
    const pages = [
      { data: [{ id: 1 }, { id: 2 }], has_more: true, next_cursor: 'c1' },
      { data: [{ id: 3 }], has_more: false, next_cursor: null },
    ];
    const sdk = new VisaAiClient({ apiKey: 'k', baseUrl: 'https://api.test' });
    const seen: unknown[] = [];
    let call = 0;
    for await (const item of sdk.paginate(async () => pages[call++] as never)) {
      seen.push(item);
    }
    expect(seen).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
  });

  it('stops when has_more is false even if a cursor is present', async () => {
    const sdk = new VisaAiClient({ apiKey: 'k', baseUrl: 'https://api.test' });
    let calls = 0;
    const items: unknown[] = [];
    for await (const item of sdk.paginate(async () => {
      calls += 1;
      return { data: [{ id: calls }], has_more: false, next_cursor: 'still-here' };
    })) {
      items.push(item);
    }
    expect(calls).toBe(1);
    expect(items).toHaveLength(1);
  });

  it('handles an empty first page', async () => {
    const sdk = new VisaAiClient({ apiKey: 'k', baseUrl: 'https://api.test' });
    const items: unknown[] = [];
    for await (const item of sdk.paginate(async () => ({
      data: [],
      has_more: false,
      next_cursor: null,
    }))) {
      items.push(item);
    }
    expect(items).toEqual([]);
  });
});

import { api, request, setTokenProvider, setUnauthorizedHandler } from './client';
import { ApiError, isApiError } from './errors';

/**
 * Network-layer contract tests. These cover the behaviours that are invisible
 * until a user is on a bad connection: retry, backoff, cancellation, timeout,
 * and the auth-header rules.
 */
function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  } as unknown as Response;
}

type FetchImpl = (url: string, init: RequestInit) => Promise<Response>;

/** Swap globalThis.fetch for a typed stub and hand back the jest.Mock. */
function stubFetch(impl: FetchImpl): jest.Mock<Promise<Response>, [string, RequestInit]> {
  const mock = jest.fn(impl);
  (globalThis as { fetch: unknown }).fetch = mock;
  return mock as unknown as jest.Mock<Promise<Response>, [string, RequestInit]>;
}

function lastInit(mock: jest.Mock<Promise<Response>, [string, RequestInit]>): RequestInit {
  const call = mock.mock.calls[0];
  if (!call) throw new Error('fetch was not called');
  return call[1];
}

const realFetch = globalThis.fetch;

describe('api client', () => {
  beforeEach(() => {
    setTokenProvider(async () => 'test-token');
    setUnauthorizedHandler(() => {});
    jest.useRealTimers();
  });

  afterEach(() => {
    (globalThis as { fetch: unknown }).fetch = realFetch;
    jest.restoreAllMocks();
  });

  it('attaches the bearer token and parses JSON', async () => {
    const fetchMock = stubFetch(async () => jsonResponse(200, { ok: true }));

    const result = await api.get<{ ok: boolean }>('/me');

    expect(result).toEqual({ ok: true });
    const headers = lastInit(fetchMock).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer test-token');
  });

  it('omits the Authorization header when auth is "none"', async () => {
    const fetchMock = stubFetch(async () => jsonResponse(200, {}));

    await request('/public', { auth: 'none' });

    const headers = lastInit(fetchMock).headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });

  it('fails fast with unauthorized when auth is required and there is no token', async () => {
    setTokenProvider(async () => null);
    const fetchMock = stubFetch(async () => jsonResponse(200, {}));

    await expect(request('/me', { auth: 'required' })).rejects.toMatchObject({
      kind: 'unauthorized',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps the API error envelope onto a typed ApiError', async () => {
    stubFetch(async () =>
      jsonResponse(400, {
        statusCode: 400,
        error: 'BAD_REQUEST',
        message: 'scheduledEnd must be after scheduledStart',
        details: { fieldErrors: {} },
      }),
    );

    const error = await api.get('/consultations').catch((e: unknown) => e);

    expect(isApiError(error)).toBe(true);
    expect((error as ApiError).kind).toBe('validation');
    expect((error as ApiError).message).toBe('scheduledEnd must be after scheduledStart');
    expect((error as ApiError).details).toEqual({ fieldErrors: {} });
  });

  it('detects the mfa_required step-up signal inside a 403', async () => {
    stubFetch(async () =>
      jsonResponse(403, { statusCode: 403, error: 'FORBIDDEN', message: 'mfa_required' }),
    );

    const error = (await api.get('/admin/x').catch((e: unknown) => e)) as ApiError;
    expect(error.kind).toBe('mfa_required');
  });

  it('invokes the unauthorized handler on a 401', async () => {
    const onUnauthorized = jest.fn();
    setUnauthorizedHandler(onUnauthorized);
    stubFetch(async () =>
      jsonResponse(401, { statusCode: 401, error: 'UNAUTHORIZED', message: 'jwt expired' }),
    );

    await api.get('/me').catch(() => undefined);
    expect(onUnauthorized).toHaveBeenCalled();
  });

  it('retries a 500 on a GET and succeeds on a later attempt', async () => {
    let calls = 0;
    stubFetch(async () => {
      calls += 1;
      return calls < 3 ? jsonResponse(500, { message: 'boom' }) : jsonResponse(200, { ok: 1 });
    });

    const result = await api.get<{ ok: number }>('/progress/x');
    expect(result).toEqual({ ok: 1 });
    expect(calls).toBe(3);
  });

  it('does NOT retry a POST by default — a duplicated mutation is worse than an error', async () => {
    let calls = 0;
    stubFetch(async () => {
      calls += 1;
      return jsonResponse(500, { message: 'boom' });
    });

    await api.post('/consultations', {}).catch(() => undefined);
    expect(calls).toBe(1);
  });

  it('does not retry a non-retryable 4xx', async () => {
    let calls = 0;
    stubFetch(async () => {
      calls += 1;
      return jsonResponse(404, { message: 'nope' });
    });

    await api.get('/documents/x').catch(() => undefined);
    expect(calls).toBe(1);
  });

  it('classifies a transport failure as a network error', async () => {
    stubFetch(async () => {
      throw new TypeError('Network request failed');
    });

    const error = (await api.get('/me', { retries: 0 }).catch((e: unknown) => e)) as ApiError;
    expect(error.kind).toBe('network');
    expect(error.retryable).toBe(true);
  });

  it('honours an external abort signal without retrying', async () => {
    const controller = new AbortController();
    let calls = 0;
    stubFetch(async () => {
      calls += 1;
      controller.abort();
      throw new Error('Aborted');
    });

    await request('/me', { signal: controller.signal }).catch(() => undefined);
    expect(calls).toBe(1);
  });

  it('times out a hanging request', async () => {
    stubFetch(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );

    const error = (await request('/me', { timeoutMs: 20, retries: 0 }).catch(
      (e: unknown) => e,
    )) as ApiError;
    expect(error.kind).toBe('timeout');
  });

  it('serialises query params and drops undefined values', async () => {
    const fetchMock = stubFetch(async () => jsonResponse(200, {}));

    await api.get('/notifications', { query: { limit: 20, cursor: undefined, unread: true } });

    const url = fetchMock.mock.calls[0]![0];
    expect(url).toContain('limit=20');
    expect(url).toContain('unread=true');
    expect(url).not.toContain('cursor');
  });

  it('returns undefined for an empty 204-style body', async () => {
    stubFetch(async () =>
      jsonResponse(200, undefined),
    );
    await expect(api.post('/notifications/read-all')).resolves.toBeUndefined();
  });

  it('produces a user-safe message for a 5xx instead of leaking server text', async () => {
    stubFetch(async () =>
      jsonResponse(500, { message: 'ECONNREFUSED postgres://user:pw@db:5432' }),
    );

    const error = (await api.get('/me', { retries: 0 }).catch((e: unknown) => e)) as ApiError;
    expect(error.userMessage).toBe('Something went wrong on our side. Please try again.');
    expect(error.userMessage).not.toContain('postgres');
  });
});

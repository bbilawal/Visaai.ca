import {
  isRetryableError,
  NonRetryableOcrError,
  OcrHttpError,
  parseRetryAfterMs,
  withRetryTimeout,
} from './retry';

/**
 * Dry run 2026-10-14 (prod): 6 of 10 documents uploaded ~6s apart failed with
 * `azure-di analyze request failed (HTTP 429 Too Many Requests)`. The retry
 * helper re-fired immediately, so every retry landed inside the same throttle
 * window. Retries must back off (honouring Retry-After) and must not retry an
 * error that will fail the same way every time.
 */
function headers(h: Record<string, string>) {
  return new Map(Object.entries(h)) as unknown as Headers;
}

describe('parseRetryAfterMs', () => {
  it('reads retry-after-ms first', () => {
    expect(
      parseRetryAfterMs(
        headers({ 'retry-after-ms': '1500', 'retry-after': '9' }),
      ),
    ).toBe(1500);
  });
  it('reads x-ms-retry-after-ms', () => {
    expect(parseRetryAfterMs(headers({ 'x-ms-retry-after-ms': '700' }))).toBe(
      700,
    );
  });
  it('reads retry-after in seconds', () => {
    expect(parseRetryAfterMs(headers({ 'retry-after': '3' }))).toBe(3000);
  });
  it('reads retry-after as an HTTP date', () => {
    const now = Date.parse('2026-10-14T10:00:00Z');
    expect(
      parseRetryAfterMs(
        headers({ 'retry-after': 'Wed, 14 Oct 2026 10:00:05 GMT' }),
        now,
      ),
    ).toBe(5000);
  });
  it('returns undefined when absent or garbage', () => {
    expect(parseRetryAfterMs(headers({}))).toBeUndefined();
    expect(
      parseRetryAfterMs(headers({ 'retry-after': 'soon' })),
    ).toBeUndefined();
    expect(parseRetryAfterMs(undefined)).toBeUndefined();
  });
});

describe('isRetryableError', () => {
  it.each([408, 429, 500, 502, 503, 504])('retries HTTP %i', (s) => {
    expect(isRetryableError(new OcrHttpError('x', s))).toBe(true);
  });
  it.each([400, 401, 403, 404, 413, 415])('does not retry HTTP %i', (s) => {
    expect(isRetryableError(new OcrHttpError('x', s))).toBe(false);
  });
  it('does not retry an explicitly non-retryable error', () => {
    expect(isRetryableError(new NonRetryableOcrError('bad file'))).toBe(false);
  });
  it('retries a plain network/timeout error', () => {
    expect(isRetryableError(new Error('fetch failed'))).toBe(true);
  });
});

describe('withRetryTimeout', () => {
  it('waits the Retry-After before retrying a 429 (capped)', async () => {
    const sleep = jest.fn(() => Promise.resolve());
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new OcrHttpError('429', 429, 2000))
      .mockRejectedValueOnce(new OcrHttpError('429', 429, 999_000))
      .mockResolvedValueOnce('ok');

    await expect(
      withRetryTimeout(fn, { attempts: 3, sleep, random: () => 0 }),
    ).resolves.toBe('ok');

    expect(sleep).toHaveBeenNthCalledWith(1, 2000);
    expect(sleep).toHaveBeenNthCalledWith(2, 30_000); // capped
  });

  it('backs off exponentially with jitter when there is no Retry-After', async () => {
    const sleep = jest.fn(() => Promise.resolve());
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new OcrHttpError('503', 503))
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce('ok');

    await withRetryTimeout(fn, {
      attempts: 3,
      baseDelayMs: 1000,
      sleep,
      random: () => 1,
    });

    // base * 2^(n-1), plus up to 25% jitter
    expect(sleep).toHaveBeenNthCalledWith(1, 1250);
    expect(sleep).toHaveBeenNthCalledWith(2, 2500);
  });

  it('fails fast on a non-retryable status', async () => {
    const sleep = jest.fn(() => Promise.resolve());
    const fn = jest.fn().mockRejectedValue(new OcrHttpError('403', 403));

    await expect(withRetryTimeout(fn, { attempts: 3, sleep })).rejects.toThrow(
      '403',
    );
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('rethrows the last error with its class intact', async () => {
    const fn = jest.fn().mockRejectedValue(new OcrHttpError('429', 429));
    const err = await withRetryTimeout(fn, {
      attempts: 2,
      sleep: () => Promise.resolve(),
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OcrHttpError);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

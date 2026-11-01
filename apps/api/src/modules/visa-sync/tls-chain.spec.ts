import { isChainError } from './tls-chain';
import {
  DEFAULT_FETCH_POLICY,
  fetchSource,
  type FetchPolicy,
} from './source-fetcher';

/** `example.gov` does not resolve; the SSRF guard would reject it first. */
const policy: FetchPolicy = {
  ...DEFAULT_FETCH_POLICY,
  allowPrivateAddresses: true,
};

/**
 * These lock down the SHAPE of the chain-completion fix, not the network.
 *
 * The behaviour that matters is proven against the real host and recorded in
 * the ledger: aima.gov.pt returns `unavailable` before the fix and HTTP 200
 * after it, from the VPS, while untrusted-root, expired and wrong-hostname
 * certificates all still fail. What CANNOT be left to a manual run is the
 * guarantee that the recovery path never fires where it must not — so that is
 * what is tested here.
 */

describe('isChainError', () => {
  it('recognises the OpenSSL codes that mean the chain was incomplete', () => {
    for (const code of [
      'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
      'UNABLE_TO_GET_ISSUER_CERT',
      'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
      'SELF_SIGNED_CERT_IN_CHAIN',
    ]) {
      expect(isChainError(Object.assign(new Error('tls'), { code }))).toBe(
        true,
      );
    }
  });

  it('looks through the cause chain, because fetch buries the real error', () => {
    // undici reports `TypeError: fetch failed` and hides the TLS code one level
    // down. Matching only the top-level error would never fire at all.
    const buried = new TypeError('fetch failed');
    (buried as any).cause = Object.assign(
      new Error('unable to verify the first certificate'),
      {
        code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
      },
    );
    expect(isChainError(buried)).toBe(true);
  });

  it('does NOT treat an expired or self-signed leaf as a chain problem', () => {
    // The distinction the whole fix rests on. An expired certificate and a
    // hostname mismatch are the server telling the truth about a real problem;
    // completing a chain would not help and must not be attempted.
    for (const code of [
      'CERT_HAS_EXPIRED',
      'ERR_TLS_CERT_ALTNAME_INVALID',
      'DEPTH_ZERO_SELF_SIGNED_CERT',
      'ECONNRESET',
      'ENOTFOUND',
    ]) {
      expect(isChainError(Object.assign(new Error('tls'), { code }))).toBe(
        false,
      );
    }
  });

  it('terminates on a self-referential cause chain', () => {
    const a: any = new Error('a');
    const b: any = new Error('b');
    a.cause = b;
    b.cause = a;
    expect(isChainError(a)).toBe(false);
  });

  it('is false for non-errors', () => {
    expect(isChainError(null)).toBe(false);
    expect(isChainError('unable to verify')).toBe(false);
  });
});

describe('fetchSource chain recovery', () => {
  it('never attempts recovery when the caller injected a fetch', async () => {
    // A test or a self-hosted mirror supplies its own fetchImpl. If recovery
    // fired there it would make a REAL outbound TLS connection from inside a
    // unit test, which is exactly the surprise this guard exists to prevent.
    let calls = 0;
    const impl = (async () => {
      calls++;
      throw Object.assign(new TypeError('fetch failed'), {
        cause: Object.assign(
          new Error('unable to verify the first certificate'),
          {
            code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
          },
        ),
      });
    }) as unknown as typeof fetch;

    const res = await fetchSource('https://example.gov/page', policy, {
      fetchImpl: impl,
    });
    expect(calls).toBe(1);
    expect(res.status).toBe('unavailable');
  });

  it('reports an incomplete chain as such, not as a generic network error', async () => {
    // "network error" sent a real investigation down the wrong path for two
    // days: it reads as "their site is down or blocking us" when the actual
    // fault is a missing intermediate. The reason string has to say so.
    const impl = (async () => {
      throw Object.assign(new TypeError('fetch failed'), {
        cause: Object.assign(
          new Error('unable to verify the first certificate'),
          {
            code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
          },
        ),
      });
    }) as unknown as typeof fetch;

    const res = await fetchSource('https://example.gov/page', policy, {
      fetchImpl: impl,
    });
    expect(res.status).toBe('unavailable');
    expect((res as any).reason).toMatch(/incomplete certificate chain/);
  });

  it('leaves an ordinary network error described as an ordinary network error', async () => {
    const impl = (async () => {
      throw Object.assign(new Error('connect ECONNREFUSED'), {
        code: 'ECONNREFUSED',
      });
    }) as unknown as typeof fetch;

    const res = await fetchSource('https://example.gov/page', policy, {
      fetchImpl: impl,
    });
    expect((res as any).reason).toBe('connect ECONNREFUSED');
    expect((res as any).reason).not.toMatch(/certificate/);
  });
});

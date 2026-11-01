import {
  DEFAULT_FETCH_POLICY,
  fetchSource,
  isPrivateAddress,
  type FetchPolicy,
} from './source-fetcher';

/** A fetch that never touches the network. Records what it was asked for. */
function fakeFetch(handler: (url: string) => Response | Promise<Response>): {
  impl: typeof fetch;
  calls: string[];
} {
  const calls: string[] = [];
  const impl = async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    calls.push(url);
    return handler(url);
  };
  return { impl, calls };
}

const html = (body: string, init: ResponseInit = {}) =>
  new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/html' },
    ...init,
  });

describe('isPrivateAddress', () => {
  it('rejects the cloud metadata address', () => {
    // The single most valuable SSRF target on a VPS.
    expect(isPrivateAddress('169.254.169.254')).toBe(true);
  });

  it('rejects loopback, RFC1918 and CGNAT', () => {
    for (const ip of [
      '127.0.0.1',
      '10.0.0.5',
      '172.16.4.1',
      '172.31.255.255',
      '192.168.1.1',
      '100.64.0.1',
      '0.0.0.0',
    ]) {
      expect(isPrivateAddress(ip)).toBe(true);
    }
  });

  it('rejects IPv6 loopback, link-local and unique-local', () => {
    for (const ip of ['::1', 'fe80::1', 'fc00::1', 'fd12:3456::1', '::']) {
      expect(isPrivateAddress(ip)).toBe(true);
    }
  });

  it('rejects an IPv4-mapped IPv6 pointing at metadata', () => {
    // ::ffff:169.254.169.254 is the metadata service wearing a v6 hat.
    expect(isPrivateAddress('::ffff:169.254.169.254')).toBe(true);
  });

  it('accepts real public addresses', () => {
    expect(isPrivateAddress('8.8.8.8')).toBe(false);
    expect(isPrivateAddress('2606:4700::1111')).toBe(false);
  });

  it('rejects anything that is not an IP literal', () => {
    // Cannot vouch for it, so it does not get the benefit of the doubt.
    expect(isPrivateAddress('not-an-ip')).toBe(true);
    expect(isPrivateAddress('')).toBe(true);
  });

  it('rejects 172.15/172.32, which are NOT private, only if truly outside the range', () => {
    // Guards against an off-by-one that would over-block real hosts.
    expect(isPrivateAddress('172.15.0.1')).toBe(false);
    expect(isPrivateAddress('172.32.0.1')).toBe(false);
  });
});

describe('fetchSource — egress guards', () => {
  const policy: FetchPolicy = {
    ...DEFAULT_FETCH_POLICY,
    allowPrivateAddresses: true,
  };

  it('refuses a non-http scheme', async () => {
    const f = fakeFetch(() => html('x'));
    const out = await fetchSource('file:///etc/passwd', policy, {
      fetchImpl: f.impl,
    });
    expect(out.status).toBe('blocked');
    // Never even attempted.
    expect(f.calls).toHaveLength(0);
  });

  it('refuses a literal private address even before DNS', async () => {
    const f = fakeFetch(() => html('secrets'));
    const out = await fetchSource(
      'http://169.254.169.254/latest/meta-data/',
      DEFAULT_FETCH_POLICY,
      { fetchImpl: f.impl },
    );
    expect(out.status).toBe('blocked');
    expect(out.status === 'blocked' && out.reason).toContain('private');
    expect(f.calls).toHaveLength(0);
  });

  it('re-checks every redirect hop, not just the first url', async () => {
    // The attack: a perfectly public government-looking URL that 302s into the
    // metadata service. redirect:'follow' would sail straight through.
    const f = fakeFetch((url) => {
      if (url.includes('start')) {
        return new Response(null, {
          status: 302,
          headers: { location: 'http://169.254.169.254/latest/meta-data/' },
        });
      }
      return html('SECRET');
    });
    const out = await fetchSource(
      'https://example.gov/start',
      DEFAULT_FETCH_POLICY,
      {
        fetchImpl: f.impl,
      },
    );
    expect(out.status).toBe('blocked');
    // The redirect target was never requested.
    expect(f.calls.some((c) => c.includes('169.254'))).toBe(false);
  });

  it('caps redirects instead of following a loop forever', async () => {
    let n = 0;
    const f = fakeFetch(() => {
      n++;
      return new Response(null, {
        status: 302,
        headers: { location: `https://example.gov/hop${n}` },
      });
    });
    const out = await fetchSource('https://example.gov/hop0', policy, {
      fetchImpl: f.impl,
    });
    expect(out.status).toBe('unavailable');
    expect(f.calls.length).toBeLessThanOrEqual(
      DEFAULT_FETCH_POLICY.maxRedirects + 1,
    );
  });

  it('treats an oversized response as a failure, not a truncation', async () => {
    // A truncated page would hash differently every run and manufacture an
    // endless stream of false "content changed" events.
    const big = 'x'.repeat(2000);
    const f = fakeFetch(() => html(big));
    const out = await fetchSource(
      'https://example.gov/big',
      { ...policy, maxBytes: 100 },
      {
        fetchImpl: f.impl,
      },
    );
    expect(out.status).toBe('unavailable');
    expect(out.status === 'unavailable' && out.reason).toContain('exceeds');
  });

  it('treats 403 and 429 as blocked, not as something to retry harder', async () => {
    // Retrying through a government block is how a monitor becomes an attack.
    for (const code of [403, 429]) {
      const f = fakeFetch(() => new Response('no', { status: code }));
      const out = await fetchSource('https://example.gov/x', policy, {
        fetchImpl: f.impl,
      });
      expect(out.status).toBe('blocked');
      expect(out.status === 'blocked' && out.httpStatus).toBe(code);
    }
  });

  it('reports 5xx as unavailable so it can be retried later', async () => {
    const f = fakeFetch(() => new Response('err', { status: 503 }));
    const out = await fetchSource('https://example.gov/x', policy, {
      fetchImpl: f.impl,
    });
    expect(out.status).toBe('unavailable');
  });

  it('sends no credentials and identifies itself honestly', async () => {
    let seen: RequestInit | undefined;
    const impl = async (_u: RequestInfo | URL, init?: RequestInit) => {
      seen = init;
      return html('ok');
    };
    await fetchSource('https://example.gov/x', policy, { fetchImpl: impl });
    expect(seen?.credentials).toBe('omit');
    expect(seen?.redirect).toBe('manual');
    const ua = (seen?.headers as Record<string, string>)['user-agent'];
    expect(ua).toContain('VisaAI');
    // A contact URL, so an administrator who sees the traffic can reach us.
    expect(ua).toContain('https://');
  });

  it('returns the body and the final url on success', async () => {
    const f = fakeFetch(() => html('<p>Passport required</p>'));
    const out = await fetchSource('https://example.gov/visa', policy, {
      fetchImpl: f.impl,
    });
    expect(out.status).toBe('ok');
    expect(out.status === 'ok' && out.body).toContain('Passport');
    expect(out.status === 'ok' && out.finalUrl).toBe(
      'https://example.gov/visa',
    );
  });

  it('reports the destination when a redirect moved the url', async () => {
    // The registry's stored URL has drifted and should be updated.
    const f = fakeFetch((url) =>
      url.endsWith('/old')
        ? new Response(null, {
            status: 301,
            headers: { location: 'https://example.gov/new' },
          })
        : html('<p>moved</p>'),
    );
    const out = await fetchSource('https://example.gov/old', policy, {
      fetchImpl: f.impl,
    });
    expect(out.status).toBe('ok');
    expect(out.status === 'ok' && out.finalUrl).toBe('https://example.gov/new');
  });

  it('rejects a malformed url without throwing', async () => {
    const out = await fetchSource('not a url', policy);
    expect(out.status).toBe('blocked');
  });

  it('reports a network error as unavailable rather than throwing', async () => {
    const impl = (async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    const out = await fetchSource('https://example.gov/x', policy, {
      fetchImpl: impl,
    });
    expect(out.status).toBe('unavailable');
  });
});

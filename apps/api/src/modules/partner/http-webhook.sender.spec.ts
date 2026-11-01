import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { HttpWebhookSender } from './http-webhook.sender';
import { createPinnedLookup, SsrfBlockedError } from './pinned-lookup';

/**
 * PD-4 regression cover.
 *
 * The interesting case is not "a private URL is rejected" — `validateWebhookUrl`
 * already did that at registration. It is "a PUBLIC-LOOKING hostname resolves to
 * a private address at delivery time", which registration cannot see. These
 * tests drive the resolver directly, because that is the component that has to
 * hold, and then prove the sender surfaces the refusal as a network error rather
 * than an unhandled throw.
 */
describe('createPinnedLookup (DNS-rebinding defence)', () => {
  const call = (
    lookup: ReturnType<typeof createPinnedLookup>,
    hostname: string,
  ) =>
    new Promise<{ err: Error | null; address: string }>((resolve) => {
      lookup(hostname, { family: 0 }, (err, address) =>
        resolve({ err: err ?? null, address: address as string }),
      );
    });

  it('refuses a hostname that resolves to link-local (cloud metadata)', async () => {
    // 169.254.169.254 as a literal: dns.lookup returns literals unchanged, which
    // is exactly the resolution path a rebound hostname ends up on.
    const { err } = await call(createPinnedLookup(false), '169.254.169.254');
    expect(err).toBeInstanceOf(SsrfBlockedError);
    expect((err as SsrfBlockedError).code).toBe('SSRF_BLOCKED');
  });

  it('refuses RFC1918 space', async () => {
    for (const host of ['10.0.0.1', '192.168.1.1', '172.16.0.1']) {
      const { err } = await call(createPinnedLookup(false), host);
      expect(err).toBeInstanceOf(SsrfBlockedError);
    }
  });

  it('refuses loopback when loopback is not allowed', async () => {
    const { err } = await call(createPinnedLookup(false), '127.0.0.1');
    expect(err).toBeInstanceOf(SsrfBlockedError);
  });

  it('permits loopback only when explicitly allowed (sandbox/dev)', async () => {
    const { err, address } = await call(createPinnedLookup(true), '127.0.0.1');
    expect(err).toBeNull();
    expect(address).toBe('127.0.0.1');
  });

  it('permits a public address', async () => {
    const { err, address } = await call(
      createPinnedLookup(false),
      '93.184.216.34',
    );
    expect(err).toBeNull();
    expect(address).toBe('93.184.216.34');
  });

  it('refuses IPv4-mapped IPv6 forms of private space', async () => {
    const { err } = await call(createPinnedLookup(false), '::ffff:10.0.0.1');
    expect(err).toBeInstanceOf(SsrfBlockedError);
  });
});

/**
 * Budget handed to the sender by the cases that actually open a socket. It is
 * scaffolding, not the behaviour under test: these assert "delivers and returns
 * the body", not "delivers within N ms". The original 5 000 ms was an implicit
 * latency SLA on a loopback round-trip, and with 350+ suites sharing the box it
 * expired often enough to make the whole api gate intermittently red — the
 * sender reported networkError and statusCode null on a request that was merely
 * slow. Nothing is skipped or relaxed by widening it; a genuinely dead socket
 * still fails, just later.
 */
const SOCKET_BUDGET_MS = 30_000;

describe('HttpWebhookSender', () => {
  let server: Server;
  let origin: string;

  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === '/big') {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('x'.repeat(10_000));
        return;
      }
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ echoed: body }));
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  // NODE_ENV is 'test' under jest, so loopback is permitted — this exercises the
  // real socket path rather than a mock.
  it('delivers and returns the response snippet', async () => {
    const result = await new HttpWebhookSender().send(
      `${origin}/hook`,
      '{"hello":"world"}',
      { 'content-type': 'application/json' },
      SOCKET_BUDGET_MS,
    );
    expect(result.statusCode).toBe(200);
    expect(result.networkError).toBe(false);
    expect(result.responseSnippet).toContain('hello');
  });

  it('caps an oversized response body', async () => {
    const result = await new HttpWebhookSender().send(
      `${origin}/big`,
      '{}',
      {},
      SOCKET_BUDGET_MS,
    );
    expect(result.statusCode).toBe(200);
    expect((result.responseSnippet ?? '').length).toBeLessThanOrEqual(2048);
  });

  it('reports a refused private destination as a network error, not a throw', async () => {
    // 169.254.169.254 is refused by the pinned lookup regardless of NODE_ENV.
    const result = await new HttpWebhookSender().send(
      'http://169.254.169.254/latest/meta-data/',
      '{}',
      {},
      5000,
    );
    expect(result.networkError).toBe(true);
    expect(result.statusCode).toBeNull();
    expect(result.responseSnippet).toContain('non-public address');
  });

  it('rejects a non-http scheme without opening a socket', async () => {
    const result = await new HttpWebhookSender().send(
      'file:///etc/passwd',
      '{}',
      {},
      5000,
    );
    expect(result.networkError).toBe(true);
    expect(result.responseSnippet).toContain('scheme not allowed');
  });

  it('reports a malformed url as a network error', async () => {
    const result = await new HttpWebhookSender().send(
      'not a url',
      '{}',
      {},
      5000,
    );
    expect(result.networkError).toBe(true);
    expect(result.responseSnippet).toBe('malformed webhook url');
  });
});

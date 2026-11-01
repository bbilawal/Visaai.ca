import { loggerConfig } from '../src/observability/logger.config';
import { resolveRequestId } from '../src/observability/request-id';

/**
 * OPS-004 regression cover.
 *
 * Request correlation existed only on the Partner API, so log lines from a
 * user-facing request could not be tied together. With SENTRY_DSN unset
 * (BLK-3), structured logs are the only production diagnostic surface, which
 * makes that gap expensive.
 *
 * `genReqId` puts the id on `req.id`, and pino-http includes it in every line
 * it emits for that request.
 */
type GenReqId = (
  req: { headers?: Record<string, unknown> },
  res: { setHeader?: (k: string, v: string) => void },
) => string;

const genReqId = (loggerConfig.pinoHttp as { genReqId: GenReqId }).genReqId;

function call(headerValue?: unknown) {
  const headers: Record<string, string> = {};
  const res = { setHeader: (k: string, v: string) => (headers[k] = v) };
  const id = genReqId({ headers: { 'x-request-id': headerValue } }, res);
  return { id, headers };
}

describe('OPS-004 — request correlation across the whole API', () => {
  it('generates an id when the caller supplies none', () => {
    const { id, headers } = call(undefined);
    expect(id).toMatch(/^req_[0-9a-f]{32}$/);
    expect(headers['X-Request-Id']).toBe(id);
  });

  it('honours a valid caller-supplied id so a trace spans web -> api', () => {
    const { id, headers } = call('web-abc.123:xyz');
    expect(id).toBe('web-abc.123:xyz');
    expect(headers['X-Request-Id']).toBe('web-abc.123:xyz');
  });

  it.each([
    ['a newline (log injection)', 'abc\ninjected=1'],
    ['a CRLF (header splitting)', 'abc\r\nX-Evil: 1'],
    ['a space', 'abc def'],
    ['an over-long value', 'a'.repeat(65)],
    ['an empty string', ''],
    ['a non-string', 12345],
  ])(
    'replaces %s with a generated id rather than echoing it',
    (_label, bad) => {
      const { id, headers } = call(bad);
      expect(id).toMatch(/^req_[0-9a-f]{32}$/);
      expect(id).not.toContain('\n');
      expect(id).not.toContain('\r');
      expect(headers['X-Request-Id']).toBe(id);
    },
  );

  it('accepts a 64-character id but not 65', () => {
    expect(resolveRequestId('a'.repeat(64))).toBe('a'.repeat(64));
    expect(resolveRequestId('a'.repeat(65))).toMatch(/^req_/);
  });

  it('still ignores health probes, so correlation does not flood the log', () => {
    const ignore = (
      loggerConfig.pinoHttp as {
        autoLogging: { ignore: (r: { url?: string }) => boolean };
      }
    ).autoLogging.ignore;
    expect(ignore({ url: '/health' })).toBe(true);
    expect(ignore({ url: '/applications' })).toBe(false);
  });
});

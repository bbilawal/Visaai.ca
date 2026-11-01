import {
  buildPage,
  canonicalJson,
  clampLimit,
  CURRENT_API_VERSION,
  decodeCursor,
  DEFAULT_PAGE_SIZE,
  deprecationHeaders,
  encodeCursor,
  idempotencyExpiry,
  idempotencyRequestHash,
  isSupportedVersion,
  isValidIdempotencyKey,
  MAX_PAGE_SIZE,
  resolveRequestId,
} from './partner-governance';

describe('versioning', () => {
  it('recognises the current version', () => {
    expect(isSupportedVersion(CURRENT_API_VERSION)).toBe(true);
  });

  it('rejects an unknown version', () => {
    expect(isSupportedVersion('v2')).toBe(false);
    expect(isSupportedVersion('')).toBe(false);
  });

  it('emits no deprecation headers for a current version', () => {
    expect(deprecationHeaders('v1')).toBeNull();
  });
});

describe('request ids', () => {
  it('mints an id when none is supplied', () => {
    expect(resolveRequestId(undefined)).toMatch(/^req_[0-9a-f]{32}$/);
  });

  it('mints distinct ids', () => {
    expect(resolveRequestId(undefined)).not.toBe(resolveRequestId(undefined));
  });

  it('keeps a well-formed caller-supplied id for cross-system tracing', () => {
    expect(resolveRequestId('trace-abc.123:9')).toBe('trace-abc.123:9');
  });

  // An unvalidated echo into a log line or a response header is log injection
  // and header splitting.
  it.each([
    ['a newline', 'abc\ndef'],
    ['a carriage return', 'abc\r\nSet-Cookie: x=1'],
    ['a space', 'abc def'],
    ['a quote', 'abc"def'],
    ['non-ascii', 'abc—def'],
    ['empty', ''],
    ['whitespace only', '   '],
  ])('replaces an unsafe caller-supplied id (%s)', (_label, value) => {
    expect(resolveRequestId(value)).toMatch(/^req_[0-9a-f]{32}$/);
  });

  it('replaces an over-long id', () => {
    expect(resolveRequestId('a'.repeat(65))).toMatch(/^req_/);
    expect(resolveRequestId('a'.repeat(64))).toBe('a'.repeat(64));
  });

  it('replaces a non-string id', () => {
    expect(resolveRequestId(42)).toMatch(/^req_/);
    expect(resolveRequestId(null)).toMatch(/^req_/);
    expect(resolveRequestId({ id: 'x' })).toMatch(/^req_/);
  });
});

describe('idempotency', () => {
  it('accepts a reasonable key', () => {
    expect(isValidIdempotencyKey('order-2026-08-06-001')).toBe(true);
  });

  it.each([
    ['empty', ''],
    ['too long', 'a'.repeat(256)],
    ['with a space', 'key with space'],
    ['with a slash', 'key/with/slash'],
  ])('rejects an invalid key (%s)', (_label, key) => {
    expect(isValidIdempotencyKey(key)).toBe(false);
  });

  it('hashes the same request to the same fingerprint', () => {
    const a = idempotencyRequestHash('POST', '/v1/applications', {
      a: 1,
      b: 2,
    });
    const b = idempotencyRequestHash('POST', '/v1/applications', {
      a: 1,
      b: 2,
    });
    expect(a).toBe(b);
  });

  it('ignores key ordering in the body', () => {
    expect(
      idempotencyRequestHash('POST', '/v1/applications', { a: 1, b: 2 }),
    ).toBe(idempotencyRequestHash('POST', '/v1/applications', { b: 2, a: 1 }));
  });

  it('preserves array ordering', () => {
    expect(idempotencyRequestHash('POST', '/v1/x', { list: [1, 2] })).not.toBe(
      idempotencyRequestHash('POST', '/v1/x', { list: [2, 1] }),
    );
  });

  it('distinguishes a different body', () => {
    expect(
      idempotencyRequestHash('POST', '/v1/applications', { a: 1 }),
    ).not.toBe(idempotencyRequestHash('POST', '/v1/applications', { a: 2 }));
  });

  // Two routes can legitimately take the same body, so the route is part of
  // the fingerprint: reusing a key across routes is a client bug we catch.
  it('distinguishes the same body on a different route', () => {
    expect(idempotencyRequestHash('POST', '/v1/a', { x: 1 })).not.toBe(
      idempotencyRequestHash('POST', '/v1/b', { x: 1 }),
    );
  });

  it('distinguishes a different method', () => {
    expect(idempotencyRequestHash('POST', '/v1/a', { x: 1 })).not.toBe(
      idempotencyRequestHash('PUT', '/v1/a', { x: 1 }),
    );
  });

  it('normalises method case', () => {
    expect(idempotencyRequestHash('post', '/v1/a', {})).toBe(
      idempotencyRequestHash('POST', '/v1/a', {}),
    );
  });

  it('canonicalises nested objects', () => {
    expect(canonicalJson({ b: { d: 1, c: 2 }, a: [{ f: 1, e: 2 }] })).toBe(
      '{"a":[{"e":2,"f":1}],"b":{"c":2,"d":1}}',
    );
  });

  it('expires 24 hours out', () => {
    expect(idempotencyExpiry(new Date('2026-08-06T00:00:00.000Z'))).toBe(
      '2026-08-07T00:00:00.000Z',
    );
  });
});

describe('cursor pagination', () => {
  it('round-trips', () => {
    const cursor = encodeCursor('2026-08-06T00:00:00.000Z', 'abc-123');
    expect(decodeCursor(cursor)).toEqual({
      createdAt: '2026-08-06T00:00:00.000Z',
      id: 'abc-123',
    });
  });

  it('is opaque (not readable as plain text)', () => {
    const cursor = encodeCursor('2026-08-06T00:00:00.000Z', 'abc-123');
    expect(cursor).not.toContain('2026');
  });

  it.each([
    ['garbage', '!!!!'],
    ['no separator', Buffer.from('nosep', 'utf8').toString('base64url')],
    ['bad date', Buffer.from('notadate|id', 'utf8').toString('base64url')],
    [
      'empty id',
      Buffer.from('2026-08-06T00:00:00.000Z|', 'utf8').toString('base64url'),
    ],
    ['empty', ''],
  ])('rejects a malformed cursor (%s)', (_label, cursor) => {
    expect(decodeCursor(cursor)).toBeNull();
  });

  it('clamps the page size', () => {
    expect(clampLimit(10)).toBe(10);
    expect(clampLimit('10')).toBe(10);
    expect(clampLimit(10_000)).toBe(MAX_PAGE_SIZE);
    expect(clampLimit(0)).toBe(DEFAULT_PAGE_SIZE);
    expect(clampLimit(-5)).toBe(DEFAULT_PAGE_SIZE);
    expect(clampLimit(undefined)).toBe(DEFAULT_PAGE_SIZE);
    expect(clampLimit('abc')).toBe(DEFAULT_PAGE_SIZE);
    expect(clampLimit(7.9)).toBe(7);
  });

  const row = (id: string) => ({
    id,
    created_at: `2026-08-0${id}T00:00:00.000Z`,
  });

  it('reports no next page when the result fits', () => {
    const page = buildPage([row('1'), row('2')], 5);
    expect(page.has_more).toBe(false);
    expect(page.next_cursor).toBeNull();
    expect(page.data).toHaveLength(2);
  });

  // The extra row is how we know there is more without a COUNT query — and it
  // must not be returned to the caller.
  it('trims the sentinel row and emits a cursor', () => {
    const page = buildPage([row('1'), row('2'), row('3')], 2);
    expect(page.data.map((r) => r.id)).toEqual(['1', '2']);
    expect(page.has_more).toBe(true);
    expect(decodeCursor(page.next_cursor as string)).toEqual({
      createdAt: '2026-08-02T00:00:00.000Z',
      id: '2',
    });
  });

  it('handles an empty page', () => {
    expect(buildPage([], 10)).toEqual({
      data: [],
      has_more: false,
      next_cursor: null,
    });
  });

  it('reports has_more with an exactly-full page plus sentinel', () => {
    const rows = Array.from({ length: 3 }, (_, i) => row(String(i + 1)));
    expect(buildPage(rows, 2).has_more).toBe(true);
  });
});

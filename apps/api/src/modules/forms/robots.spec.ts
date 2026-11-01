import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseRobots, isPathAllowed, RobotsGate } from './robots';
import type { FetchLike, HttpResponse } from './http';

const REAL = readFileSync(
  join(__dirname, '../../../test/fixtures/forms/canada-robots.txt'),
  'utf8',
);

function ok(body: string): HttpResponse {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: () => Promise.resolve(body),
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
  };
}

describe('parseRobots', () => {
  it('reads every Disallow in the User-agent: * group', () => {
    expect(parseRobots(REAL)).toHaveLength(47);
  });

  it('ignores comments and blank lines', () => {
    expect(parseRobots('#c\n\nUser-agent: *\nDisallow: /a\n')).toEqual(['/a']);
  });

  it('only reads the * group, not another agent’s rules', () => {
    const body = [
      'User-agent: BadBot',
      'Disallow: /everything',
      '',
      'User-agent: *',
      'Disallow: /forms/secret.pdf',
    ].join('\n');
    expect(parseRobots(body)).toEqual(['/forms/secret.pdf']);
  });

  it('treats an empty Disallow as "allow all" and drops it', () => {
    expect(parseRobots('User-agent: *\nDisallow:\n')).toEqual([]);
  });
});

describe('isPathAllowed', () => {
  const rules = parseRobots(REAL);

  it('blocks an exactly-named form PDF', () => {
    expect(
      isPathAllowed(
        rules,
        '/content/dam/ircc/documents/pdf/english/kits/forms/imm0143e.pdf',
      ),
    ).toBe(false);
  });

  it('blocks anything under a disallowed directory prefix', () => {
    expect(
      isPathAllowed(
        rules,
        '/content/dam/ircc/documents/pdf/english/kits/forms/imm5444/01-01-2020/imm5444e.pdf',
      ),
    ).toBe(false);
  });

  it('allows the IMM 5257 PDF, which is not disallowed', () => {
    expect(
      isPathAllowed(
        rules,
        '/content/dam/ircc/documents/pdf/english/kits/forms/imm5257/01-09-2023/imm5257e.pdf',
      ),
    ).toBe(true);
  });

  it('honours * wildcards mid-pattern', () => {
    expect(
      isPathAllowed(['/en/*/search.html'], '/en/anything/search.html'),
    ).toBe(false);
    expect(
      isPathAllowed(['/en/*/search.html'], '/en/anything/other.html'),
    ).toBe(true);
  });

  it('honours a trailing $ anchor', () => {
    expect(isPathAllowed(['/a.pdf$'], '/a.pdf')).toBe(false);
    expect(isPathAllowed(['/a.pdf$'], '/a.pdf.bak')).toBe(true);
  });

  it('escapes regex metacharacters in a literal pattern', () => {
    // The '.' must not match 'x'. A naive replace(/\*/g, '.*') gets this wrong.
    expect(isPathAllowed(['/a.pdf'], '/axpdf')).toBe(true);
  });
});

describe('RobotsGate', () => {
  it('allows a permitted URL and blocks a disallowed one from the same fetch', async () => {
    let calls = 0;
    const http: FetchLike = () => {
      calls++;
      return Promise.resolve(ok(REAL));
    };
    const gate = new RobotsGate(http);

    await expect(
      gate.allows(
        'https://www.canada.ca/content/dam/ircc/documents/pdf/english/kits/forms/imm5257/01-09-2023/imm5257e.pdf',
      ),
    ).resolves.toBe(true);
    await expect(
      gate.allows(
        'https://www.canada.ca/content/dam/ircc/documents/pdf/english/kits/forms/imm0143e.pdf',
      ),
    ).resolves.toBe(false);

    expect(calls).toBe(1); // cached per host
  });

  it('fails CLOSED when robots.txt cannot be fetched', async () => {
    const http: FetchLike = () => Promise.reject(new Error('ECONNREFUSED'));
    await expect(
      new RobotsGate(http).allows('https://example.gov/forms/a.pdf'),
    ).resolves.toBe(false);
  });

  it('treats a 404 robots.txt as "no rules", so everything is allowed', async () => {
    const http: FetchLike = () =>
      Promise.resolve({ ...ok(''), ok: false, status: 404 });
    await expect(
      new RobotsGate(http).allows('https://example.gov/forms/a.pdf'),
    ).resolves.toBe(true);
  });

  it('does not stampede when two calls race for the same host', async () => {
    let calls = 0;
    const http: FetchLike = () => {
      calls++;
      return Promise.resolve(ok(REAL));
    };
    const gate = new RobotsGate(http);
    const [a, b] = await Promise.all([
      gate.allows(
        'https://www.canada.ca/content/dam/ircc/documents/pdf/english/kits/forms/imm5257/01-09-2023/imm5257e.pdf',
      ),
      gate.allows(
        'https://www.canada.ca/content/dam/ircc/documents/pdf/english/kits/forms/imm0143e.pdf',
      ),
    ]);
    expect([a, b]).toEqual([true, false]);
    expect(calls).toBe(1);
  });
});

/**
 * Whole-branch review, Finding I1 (IMPORTANT): pre-fix, `allows()` collapsed
 * "explicitly disallowed" and "could not read robots.txt at all" into the
 * same `false`, AND cached a failed load forever (no TTL, no eviction) — so
 * one transient robots.txt failure permanently blacked out the feature until
 * a process restart. `check()` must distinguish the three states, and a
 * failed load must not poison the cache.
 */
describe('RobotsGate.check (tri-state)', () => {
  it('returns "unknown" on a transport failure and does NOT cache it — a later call retries', async () => {
    let calls = 0;
    const http: FetchLike = () => {
      calls++;
      return Promise.reject(new Error('ECONNREFUSED'));
    };
    const gate = new RobotsGate(http);

    await expect(gate.check('https://example.gov/forms/a.pdf')).resolves.toBe(
      'unknown',
    );
    await expect(gate.check('https://example.gov/forms/a.pdf')).resolves.toBe(
      'unknown',
    );

    expect(calls).toBe(2); // NOT cached: each call re-fetches
  });

  it('returns "unknown" for a non-OK, non-404 robots.txt response', async () => {
    const http: FetchLike = () =>
      Promise.resolve({ ...ok(''), ok: false, status: 503 });
    await expect(
      new RobotsGate(http).check('https://example.gov/forms/a.pdf'),
    ).resolves.toBe('unknown');
  });

  it('returns "disallowed" for an explicitly disallowed path — not conflated with "unknown"', async () => {
    const http: FetchLike = () => Promise.resolve(ok(REAL));
    const gate = new RobotsGate(http);
    await expect(
      gate.check(
        'https://www.canada.ca/content/dam/ircc/documents/pdf/english/kits/forms/imm0143e.pdf',
      ),
    ).resolves.toBe('disallowed');
  });

  it('returns "allowed" for a 404 robots.txt and CACHES it — a second call does not refetch', async () => {
    let calls = 0;
    const http: FetchLike = () => {
      calls++;
      return Promise.resolve({ ...ok(''), ok: false, status: 404 });
    };
    const gate = new RobotsGate(http);

    await expect(gate.check('https://example.gov/forms/a.pdf')).resolves.toBe(
      'allowed',
    );
    await expect(gate.check('https://example.gov/forms/a.pdf')).resolves.toBe(
      'allowed',
    );

    expect(calls).toBe(1); // cached: success is not evicted
  });

  it('returns "allowed" for a path that is not disallowed, and caches the successful parse', async () => {
    let calls = 0;
    const http: FetchLike = () => {
      calls++;
      return Promise.resolve(ok(REAL));
    };
    const gate = new RobotsGate(http);
    await expect(
      gate.check(
        'https://www.canada.ca/content/dam/ircc/documents/pdf/english/kits/forms/imm5257/01-09-2023/imm5257e.pdf',
      ),
    ).resolves.toBe('allowed');
    await expect(
      gate.check(
        'https://www.canada.ca/content/dam/ircc/documents/pdf/english/kits/forms/imm5257/01-09-2023/imm5257e.pdf',
      ),
    ).resolves.toBe('allowed');
    expect(calls).toBe(1);
  });
});

import {
  assertEnvironmentIsolation,
  findIsolationViolations,
  formatIsolationError,
  NON_PRODUCTION,
  PRODUCTION_HOST,
  PRODUCTION_SUPABASE_REF,
  supabaseRef,
} from './environment-isolation';

/**
 * The failure this prevents: a staging box provisioned by copying production's
 * `.env` and editing two lines. Everything works — against real applicants'
 * immigration files. Nothing alerts, because nothing is broken.
 */
const PROD_SUPABASE = `https://${PRODUCTION_SUPABASE_REF}.supabase.co`;
const STAGING_SUPABASE = 'https://abcdefghijklmnopqrst.supabase.co';

describe('supabaseRef', () => {
  it('extracts the project ref from a Supabase URL', () => {
    expect(supabaseRef(PROD_SUPABASE)).toBe(PRODUCTION_SUPABASE_REF);
  });

  it('is case-insensitive', () => {
    expect(supabaseRef(PROD_SUPABASE.toUpperCase())).toBe(
      PRODUCTION_SUPABASE_REF,
    );
  });

  it('tolerates surrounding whitespace, which .env files collect', () => {
    expect(supabaseRef(`  ${PROD_SUPABASE}  `)).toBe(PRODUCTION_SUPABASE_REF);
  });

  it.each([
    ['undefined', undefined],
    ['empty', ''],
    ['not a supabase URL', 'https://example.com'],
    ['a ref of the wrong length', 'https://tooshort.supabase.co'],
    ['a bare hostname', 'ujxzxefvtaoxiydbdrhb.supabase.co'],
  ])('returns null for %s', (_label, url) => {
    expect(supabaseRef(url)).toBeNull();
  });
});

describe('production is never restricted', () => {
  it('permits production config in production', () => {
    expect(
      findIsolationViolations({
        env: 'production',
        supabaseUrl: PROD_SUPABASE,
        redisUrl: `redis://${PRODUCTION_HOST}:6379`,
        webUrl: `https://${PRODUCTION_HOST}`,
        stripeSecretKey: 'sk_live_abc123',
      }),
    ).toEqual([]);
  });
});

describe.each(NON_PRODUCTION)('non-production env: %s', (env) => {
  it('refuses the production Supabase project', () => {
    const violations = findIsolationViolations({
      env,
      supabaseUrl: PROD_SUPABASE,
    });
    expect(violations).toHaveLength(1);
    expect(violations[0].field).toBe('SUPABASE_URL');
  });

  it('permits a different Supabase project', () => {
    expect(
      findIsolationViolations({ env, supabaseUrl: STAGING_SUPABASE }),
    ).toEqual([]);
  });

  // A shared queue means a staging worker can claim a production job and act
  // on it — sending a real email, charging a real card.
  it('refuses a Redis on the production host', () => {
    const violations = findIsolationViolations({
      env,
      redisUrl: `redis://${PRODUCTION_HOST}:6379`,
    });
    expect(violations[0].field).toBe('REDIS_URL');
  });

  it('refuses a WEB_URL on the production host', () => {
    const violations = findIsolationViolations({
      env,
      webUrl: `https://${PRODUCTION_HOST}`,
    });
    expect(violations[0].field).toBe('WEB_URL');
  });

  it('refuses a live Stripe key', () => {
    const violations = findIsolationViolations({
      env,
      stripeSecretKey: 'sk_live_51abcdef',
    });
    expect(violations[0].field).toBe('STRIPE_SECRET_KEY');
    expect(violations[0].reason).toContain('real cards');
  });

  it('permits a test Stripe key', () => {
    expect(
      findIsolationViolations({ env, stripeSecretKey: 'sk_test_51abcdef' }),
    ).toEqual([]);
  });

  it('checks any additional URLs it is given', () => {
    const violations = findIsolationViolations({
      env,
      extraUrls: [undefined, STAGING_SUPABASE, PROD_SUPABASE],
    });
    expect(violations).toHaveLength(1);
    expect(violations[0].field).toBe('extraUrls[2]');
  });
});

describe('reporting', () => {
  // All at once: an operator fixing one variable per boot attempt is how a
  // check like this gets commented out.
  it('reports every violation together, not just the first', () => {
    const violations = findIsolationViolations({
      env: 'staging',
      supabaseUrl: PROD_SUPABASE,
      redisUrl: `redis://${PRODUCTION_HOST}:6379`,
      webUrl: `https://${PRODUCTION_HOST}`,
      stripeSecretKey: 'sk_live_x',
    });
    expect(violations.map((v) => v.field).sort()).toEqual([
      'REDIS_URL',
      'STRIPE_SECRET_KEY',
      'SUPABASE_URL',
      'WEB_URL',
    ]);
  });

  it('names the offending variables and what to do', () => {
    const message = formatIsolationError(
      findIsolationViolations({ env: 'staging', supabaseUrl: PROD_SUPABASE }),
    );
    expect(message).toContain('SUPABASE_URL');
    expect(message).toContain('refusing to start');
    expect(message).toContain('staging project');
  });
});

describe('assertEnvironmentIsolation', () => {
  it('throws for an isolated-violating config', () => {
    expect(() =>
      assertEnvironmentIsolation({
        env: 'staging',
        supabaseUrl: PROD_SUPABASE,
      }),
    ).toThrow(/Environment isolation violation/);
  });

  it('is silent for a clean config', () => {
    expect(() =>
      assertEnvironmentIsolation({
        env: 'staging',
        supabaseUrl: STAGING_SUPABASE,
        stripeSecretKey: 'sk_test_x',
      }),
    ).not.toThrow();
  });

  it('is silent in production', () => {
    expect(() =>
      assertEnvironmentIsolation({
        env: 'production',
        supabaseUrl: PROD_SUPABASE,
        stripeSecretKey: 'sk_live_x',
      }),
    ).not.toThrow();
  });
});

import { validateEnv } from '../src/config/configuration';

/**
 * RT-009 / RT-011 — selecting an unimplemented provider must fail at BOOT.
 *
 * Both of these had the same shape as OCR-001: an enum advertising a capability
 * the code did not have. `AI_PROVIDERS=anthropic` was accepted by config and
 * then threw from `UnconfiguredProvider.completeJSON` on every request;
 * `SCAN_PROVIDER=clamav` was accepted and then made every document fail closed
 * at the scan node, where the engine call is still a TODO.
 *
 * Failing closed is correct. Discovering it per-document in production, when
 * the process could have refused to start, is not.
 */
const BASE = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role',
  SUPABASE_ANON_KEY: 'anon',
  SUPABASE_JWT_SECRET: 'jwt-secret',
  STRIPE_SECRET_KEY: 'sk_test',
  STRIPE_WEBHOOK_SECRET: 'whsec',
  OPENAI_API_KEY: 'sk-openai',
  UPSTASH_REDIS_REST_URL: 'https://redis.example.com',
  UPSTASH_REDIS_REST_TOKEN: 'redis-token',
};

describe('AI_PROVIDERS — unimplemented slots are refused at boot', () => {
  it('accepts the default (openai)', () => {
    expect(() => validateEnv({ ...BASE })).not.toThrow();
    expect(() =>
      validateEnv({ ...BASE, AI_PROVIDERS: 'openai' }),
    ).not.toThrow();
  });

  it.each(['anthropic', 'gemini'])('refuses the declared slot %s', (name) => {
    expect(() => validateEnv({ ...BASE, AI_PROVIDERS: name })).toThrow(
      /not implemented/i,
    );
  });

  it('refuses a chain where only ONE entry is unimplemented', () => {
    // The dangerous case: the chain looks configured and openai answers, right
    // up until it fails over to a provider that throws.
    expect(() =>
      validateEnv({ ...BASE, AI_PROVIDERS: 'openai,anthropic' }),
    ).toThrow(/anthropic/);
  });

  it('names which provider is at fault, not just that something is wrong', () => {
    expect(() =>
      validateEnv({ ...BASE, AI_PROVIDERS: 'openai, gemini' }),
    ).toThrow(/gemini/);
  });
});

describe('SCAN_PROVIDER — unwired AV engines are refused at boot', () => {
  it("accepts 'none' — the built-in allowlist and magic-byte check still run", () => {
    expect(() => validateEnv({ ...BASE, SCAN_PROVIDER: 'none' })).not.toThrow();
  });

  it.each(['clamav', 'virustotal'])('refuses the unwired engine %s', (name) => {
    // Before this guard, setting either of these made every upload fail at the
    // scan node with "AV provider ... is not implemented yet" — one document at
    // a time, in production, instead of once at startup.
    expect(() => validateEnv({ ...BASE, SCAN_PROVIDER: name })).toThrow(
      /not wired/i,
    );
  });

  it('explains what to do instead', () => {
    expect(() => validateEnv({ ...BASE, SCAN_PROVIDER: 'clamav' })).toThrow(
      /Use 'none'/,
    );
  });
});

import { validateEnv } from './configuration';

/**
 * "No fabricated data may reach a real user."
 *
 * Every mock provider in this codebase INVENTS output rather than returning
 * nothing:
 *   MockOcrProvider  → full_name: 'Test User', nationality: 'XX'
 *   MockSttProvider  → 'mock-transcript: <lang> <hash>'
 *   MockTtsProvider  → a synthetic buffer instead of speech
 *   MockKpiSource    → whatever it was seeded with
 *
 * On an immigration application that is not degraded service, it is wrong data
 * recorded against a real person. Boot must refuse.
 *
 * Two of these DEFAULT to mock when unset, so the dangerous case is not a
 * careless override — it is a production deploy that simply never set the
 * variable. Absent is therefore tested as strictly as explicit 'mock'.
 */

/** Same required-field set the existing residency spec uses. */
const REAL_PROD = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role',
  SUPABASE_ANON_KEY: 'anon',
  SUPABASE_JWT_SECRET: 'jwt-secret',
  STRIPE_SECRET_KEY: 'sk_test',
  STRIPE_WEBHOOK_SECRET: 'whsec',
  OPENAI_API_KEY: 'sk-openai',
  UPSTASH_REDIS_REST_URL: 'https://redis.example.com',
  UPSTASH_REDIS_REST_TOKEN: 'redis-token',
  NODE_ENV: 'production',
  DATA_RESIDENCY_MODE: 'regional',
  OCR_PROVIDER: 'azure-di',
  VOICE_STT_PROVIDERS: 'openai',
  VOICE_TTS_PROVIDERS: 'openai',
  ANALYTICS_WAREHOUSE: 'supabase',
  KPI_SOURCE: 'supabase',
} as Record<string, unknown>;

/** Collected message text, so assertions read on intent not on zod internals. */
function failureText(env: Record<string, unknown>): string {
  try {
    validateEnv(env);
    return '';
  } catch (err) {
    return String((err as Error).message);
  }
}

describe('production boot refuses fabricating providers', () => {
  it('accepts a fully real production configuration (control)', () => {
    expect(() => validateEnv({ ...REAL_PROD })).not.toThrow();
  });

  describe('OCR — invented passport fields', () => {
    it.each(['mock', 'openai'])('rejects OCR_PROVIDER=%s', (p) => {
      expect(failureText({ ...REAL_PROD, OCR_PROVIDER: p })).toMatch(
        /OCR_PROVIDER/,
      );
    });

    it('rejects mock even though MockOcrProvider self-declares regional=true', () => {
      // The guard is an allowlist by name, NOT the provider's own flag. If it
      // trusted self-attestation, mock would pass — it claims regional=true so
      // it can be used under any residency mode in development.
      expect(failureText({ ...REAL_PROD, OCR_PROVIDER: 'mock' })).toMatch(
        /regional managed provider/,
      );
    });
  });

  describe('voice — invented transcripts', () => {
    it('rejects an explicit mock STT chain', () => {
      expect(
        failureText({ ...REAL_PROD, VOICE_STT_PROVIDERS: 'mock' }),
      ).toMatch(/VOICE_STT_PROVIDERS/);
    });

    it('rejects mock anywhere in the fallback chain, not just first', () => {
      expect(
        failureText({ ...REAL_PROD, VOICE_STT_PROVIDERS: 'openai,mock' }),
      ).toMatch(/VOICE_STT_PROVIDERS/);
    });

    it('rejects an UNSET chain, because the factory falls back to mock', () => {
      const env = { ...REAL_PROD };
      delete env.VOICE_STT_PROVIDERS;
      // This is the realistic failure: nobody chose mock, they just never set
      // the variable, and users would have received invented transcripts.
      expect(failureText(env)).toMatch(/VOICE_STT_PROVIDERS/);
    });

    it('rejects an unset TTS chain for the same reason', () => {
      const env = { ...REAL_PROD };
      delete env.VOICE_TTS_PROVIDERS;
      expect(failureText(env)).toMatch(/VOICE_TTS_PROVIDERS/);
    });

    it('accepts a real chain with whitespace', () => {
      expect(() =>
        validateEnv({ ...REAL_PROD, VOICE_STT_PROVIDERS: 'openai, azure' }),
      ).not.toThrow();
    });
  });

  describe('analytics — invented or discarded numbers', () => {
    it('rejects a mock warehouse (events silently discarded)', () => {
      expect(
        failureText({ ...REAL_PROD, ANALYTICS_WAREHOUSE: 'mock' }),
      ).toMatch(/ANALYTICS_WAREHOUSE/);
    });

    it('rejects a mock KPI source (seeded numbers rendered as real)', () => {
      expect(failureText({ ...REAL_PROD, KPI_SOURCE: 'mock' })).toMatch(
        /KPI_SOURCE/,
      );
    });
  });

  describe('non-production is unaffected', () => {
    it.each(['development', 'test'])('permits mocks in %s', (env) => {
      expect(() =>
        validateEnv({
          ...REAL_PROD,
          NODE_ENV: env,
          SUPABASE_URL: 'https://example.supabase.co',
          OCR_PROVIDER: 'mock',
          VOICE_STT_PROVIDERS: 'mock',
          VOICE_TTS_PROVIDERS: 'mock',
          ANALYTICS_WAREHOUSE: 'mock',
          KPI_SOURCE: 'mock',
        }),
      ).not.toThrow();
    });
  });
});

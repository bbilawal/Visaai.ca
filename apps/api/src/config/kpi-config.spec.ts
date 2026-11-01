import { validateEnv } from './configuration';

// Complete set of keys that envSchema requires (no default, not optional).
const base = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'svc',
  SUPABASE_ANON_KEY: 'anon',
  SUPABASE_JWT_SECRET: 'jwt',
  STRIPE_SECRET_KEY: 'sk_test_x',
  STRIPE_WEBHOOK_SECRET: 'whsec_x',
  OPENAI_API_KEY: 'sk-openai',
  UPSTASH_REDIS_REST_URL: 'https://redis.example.com',
  UPSTASH_REDIS_REST_TOKEN: 'redis-token',
};

describe('KPI config defaults (SP-B)', () => {
  it('applies SP-B env defaults', () => {
    const env = validateEnv({ ...base });
    expect(env.KPI_SOURCE).toBe('supabase');
    expect(env.KPI_ROLLUP_LOOKBACK_DAYS).toBe(3);
    expect(env.KPI_ROLLUP_INTERVAL_MIN).toBe(15);
    expect(env.KPI_ROLLUP_STALE_MIN).toBe(15);
    expect(env.KPI_COHORT_INTERVAL_HOURS).toBe(24);
    expect(env.KPI_COHORT_STALE_HOURS).toBe(24);
  });

  it('accepts KPI_SOURCE=mock', () => {
    const env = validateEnv({ ...base, KPI_SOURCE: 'mock' });
    expect(env.KPI_SOURCE).toBe('mock');
  });
});

import { validateEnv } from './configuration';

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

describe('SP-C config defaults', () => {
  it('applies analytics-api env defaults', () => {
    const env = validateEnv({ ...base });
    expect(env.ANALYTICS_CACHE_TTL_SEC).toBe(60);
    expect(env.ANALYTICS_REPORTS_TICK_MIN).toBe(5);
  });
});

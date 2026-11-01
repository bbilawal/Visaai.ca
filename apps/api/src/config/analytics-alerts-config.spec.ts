import { validateEnv } from './configuration';

const base = {
  SUPABASE_URL: 'https://e.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'svc',
  SUPABASE_ANON_KEY: 'anon',
  SUPABASE_JWT_SECRET: 'jwt',
  STRIPE_SECRET_KEY: 'sk',
  STRIPE_WEBHOOK_SECRET: 'wh',
  OPENAI_API_KEY: 'ok',
  UPSTASH_REDIS_REST_URL: 'https://r.example.com',
  UPSTASH_REDIS_REST_TOKEN: 'tok',
};

describe('SP-E config', () => {
  it('ANALYTICS_ALERTS_TICK_MIN defaults to 5', () => {
    expect(validateEnv({ ...base }).ANALYTICS_ALERTS_TICK_MIN).toBe(5);
  });
});

import { validateEnv } from '../src/config/configuration';

const base = {
  SUPABASE_URL: 'https://x.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'k',
  SUPABASE_ANON_KEY: 'k',
  SUPABASE_JWT_SECRET: 'k',
  STRIPE_SECRET_KEY: 'k',
  STRIPE_WEBHOOK_SECRET: 'k',
  OPENAI_API_KEY: 'k',
  UPSTASH_REDIS_REST_URL: 'https://x',
  UPSTASH_REDIS_REST_TOKEN: 'k',
};

describe('config — P3b notification env', () => {
  it('defaults NOTIFICATION_EMAIL_DELAY_MS to 300000', () => {
    const env = validateEnv({ ...base });
    expect(env.NOTIFICATION_EMAIL_DELAY_MS).toBe(300000);
  });

  it('accepts VAPID keys and a custom delay', () => {
    const env = validateEnv({
      ...base,
      VAPID_PUBLIC_KEY: 'pub',
      VAPID_PRIVATE_KEY: 'priv',
      VAPID_SUBJECT: 'mailto:a@b.c',
      NOTIFICATION_EMAIL_DELAY_MS: '60000',
    });
    expect(env.VAPID_PUBLIC_KEY).toBe('pub');
    expect(env.NOTIFICATION_EMAIL_DELAY_MS).toBe(60000);
  });
});

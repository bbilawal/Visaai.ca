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

describe('validateEnv PAYMENT_PROVIDER_NAME', () => {
  it('defaults to stripe when unset', () => {
    const env = validateEnv({ ...base });
    expect(env.PAYMENT_PROVIDER_NAME).toBe('stripe');
  });

  it('accepts an explicit provider name', () => {
    const env = validateEnv({ ...base, PAYMENT_PROVIDER_NAME: 'stripe' });
    expect(env.PAYMENT_PROVIDER_NAME).toBe('stripe');
  });

  it('leaves STRIPE_CONNECT_WEBHOOK_SECRET optional (undefined when unset)', () => {
    const env = validateEnv({ ...base });
    expect(env.STRIPE_CONNECT_WEBHOOK_SECRET).toBeUndefined();
  });
});

describe('validateEnv subscriptions config', () => {
  const pricesJson = JSON.stringify({
    base: { month: 'price_bm', year: 'price_by' },
    pro: { month: 'price_pm', year: 'price_py' },
    premium: { month: 'price_prm', year: 'price_pry' },
  });

  it('SUBSCRIPTIONS_ENABLED defaults false; trial days default 0', () => {
    const env = validateEnv({ ...base });
    expect(env.SUBSCRIPTIONS_ENABLED).toBe(false);
    expect(env.SUBSCRIPTION_TRIAL_DAYS).toBe(0);
  });

  it('accepts prices JSON when enabled', () => {
    const env = validateEnv({
      ...base,
      SUBSCRIPTIONS_ENABLED: 'true',
      SUBSCRIPTION_PRICES: pricesJson,
      SUBSCRIPTION_TRIAL_DAYS: '14',
    });
    expect(env.SUBSCRIPTIONS_ENABLED).toBe(true);
    expect(env.SUBSCRIPTION_TRIAL_DAYS).toBe(14);
  });

  it('rejects enabling subscriptions without prices', () => {
    expect(() =>
      validateEnv({ ...base, SUBSCRIPTIONS_ENABLED: 'true' }),
    ).toThrow(/SUBSCRIPTION_PRICES/);
  });
});

describe('validateEnv MIN_PAYOUT_CENTS', () => {
  it('defaults to 1000', () => {
    expect(validateEnv({ ...base }).MIN_PAYOUT_CENTS).toBe(1000);
  });
  it('accepts an override', () => {
    expect(
      validateEnv({ ...base, MIN_PAYOUT_CENTS: '2500' }).MIN_PAYOUT_CENTS,
    ).toBe(2500);
  });
});

describe('validateEnv DUNNING_MAX_ATTEMPTS', () => {
  it('defaults to 4', () => {
    expect(validateEnv({ ...base }).DUNNING_MAX_ATTEMPTS).toBe(4);
  });
});

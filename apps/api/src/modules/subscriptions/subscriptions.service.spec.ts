import { ConfigService } from '@nestjs/config';
import { NotFoundException } from '@nestjs/common';
import { SubscriptionsService } from './subscriptions.service';

const PRICES = JSON.stringify({
  base: { month: 'price_bm', year: 'price_by' },
  pro: { month: 'price_pm', year: 'price_py' },
  premium: { month: 'price_prm', year: 'price_pry' },
});
const config = new ConfigService({
  SUBSCRIPTION_PRICES: PRICES,
  SUBSCRIPTION_TRIAL_DAYS: 14,
  WEB_URL: 'https://app.test',
});

function makeProvider(over: any = {}) {
  const notImpl = (n: string) => () => {
    throw new Error(`unexpected ${n}`);
  };
  return {
    name: 'stripe',
    ensureCustomer: jest.fn().mockResolvedValue({ id: 'cus_1' }),
    createSubscriptionCheckoutSession: jest.fn().mockResolvedValue({
      id: 'cs',
      url: 'https://co/s',
      paymentIntentId: null,
    }),
    updateSubscription: notImpl('updateSubscription'),
    pauseSubscription: notImpl('pauseSubscription'),
    resumeSubscription: notImpl('resumeSubscription'),
    cancelSubscription: notImpl('cancelSubscription'),
    ...over,
  };
}
function makeRepo(over: any = {}) {
  return {
    getActiveByUser: jest.fn(),
    getByStripeId: jest.fn(),
    upsertFromStripe: jest.fn(),
    getCurrentCredits: jest.fn(),
    ...over,
  };
}
function makeSupabase(customerId: string | null) {
  const update = jest
    .fn()
    .mockReturnValue({ eq: () => Promise.resolve({ error: null }) });
  const maybeSingle = jest
    .fn()
    .mockResolvedValue({ data: { stripe_customer_id: customerId } });
  const admin = {
    from: jest.fn().mockReturnValue({
      select: () => ({ eq: () => ({ maybeSingle }) }),
      update,
    }),
  };
  return { supabase: { admin } as any, update };
}

describe('SubscriptionsService', () => {
  it('startCheckout resolves the priceId, ensures a customer, persists it, passes trial days', async () => {
    const provider = makeProvider();
    const { supabase, update } = makeSupabase(null);
    const svc = new SubscriptionsService(
      provider,
      makeRepo(),
      config,
      supabase,
    );
    const res = await svc.startCheckout('u1', 'u@x.com', {
      plan: 'pro',
      interval: 'month',
      successUrl: 'https://app.test/ok',
      cancelUrl: 'https://app.test/no',
    });
    expect(res).toEqual({ url: 'https://co/s' });
    const arg = provider.createSubscriptionCheckoutSession.mock.calls[0][0];
    expect(arg.priceId).toBe('price_pm');
    expect(arg.trialDays).toBe(14);
    expect(arg.customerId).toBe('cus_1');
    expect(update).toHaveBeenCalled();
  });

  it('reuses an existing customer id (no ensureCustomer)', async () => {
    const provider = makeProvider();
    const { supabase } = makeSupabase('cus_existing');
    const svc = new SubscriptionsService(
      provider,
      makeRepo(),
      config,
      supabase,
    );
    await svc.startCheckout('u1', 'u@x.com', {
      plan: 'base',
      interval: 'year',
      successUrl: 'https://app.test/ok',
      cancelUrl: 'https://app.test/no',
    });
    expect(provider.ensureCustomer).not.toHaveBeenCalled();
    expect(
      provider.createSubscriptionCheckoutSession.mock.calls[0][0].customerId,
    ).toBe('cus_existing');
  });

  it('change updates with proration', async () => {
    const provider = makeProvider({
      updateSubscription: jest.fn().mockResolvedValue({}),
    });
    const repo = makeRepo({
      getActiveByUser: jest
        .fn()
        .mockResolvedValue({ stripe_subscription_id: 'sub_1' }),
    });
    const { supabase } = makeSupabase('cus_1');
    const svc = new SubscriptionsService(provider, repo, config, supabase);
    await svc.change('u1', { plan: 'premium', interval: 'month' });
    expect(provider.updateSubscription).toHaveBeenCalledWith('sub_1', {
      priceId: 'price_prm',
      prorationBehavior: 'create_prorations',
    });
  });

  it('change throws when no active subscription', async () => {
    const svc = new SubscriptionsService(
      makeProvider(),
      makeRepo({ getActiveByUser: jest.fn().mockResolvedValue(null) }),
      config,
      makeSupabase('cus_1').supabase,
    );
    await expect(
      svc.change('u1', { plan: 'pro', interval: 'month' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('cancel(immediate=false) cancels at period end', async () => {
    const provider = makeProvider({
      cancelSubscription: jest.fn().mockResolvedValue({}),
    });
    const repo = makeRepo({
      getActiveByUser: jest
        .fn()
        .mockResolvedValue({ stripe_subscription_id: 'sub_1' }),
    });
    const svc = new SubscriptionsService(
      provider,
      repo,
      config,
      makeSupabase('cus_1').supabase,
    );
    await svc.cancel('u1', false);
    expect(provider.cancelSubscription).toHaveBeenCalledWith('sub_1', {
      atPeriodEnd: true,
    });
  });
});

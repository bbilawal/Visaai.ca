import { ConfigService } from '@nestjs/config';
import { SubscriptionsModule } from './subscriptions.module';
import { AnalyticsEventBus } from '../analytics/analytics-event-bus';
import type { AnalyticsEvent } from '../analytics/events/catalog';

/**
 * Focused test of the analytics side-effects wired into the
 * onSubscriptionChanged webhook handler registered by SubscriptionsModule.
 * The module class is instantiated directly (bypassing Nest DI) — @Module()
 * only attaches metadata, so this is a plain constructor call.
 */

const PRICES = JSON.stringify({
  base: { month: 'price_bm', year: 'price_by' },
  pro: { month: 'price_pm', year: 'price_py' },
  premium: { month: 'price_prm', year: 'price_pry' },
});

function makeConfig() {
  return new ConfigService({
    SUBSCRIPTIONS_ENABLED: true,
    SUBSCRIPTION_PRICES: PRICES,
  });
}

function setup(
  existing: { user_id: string } | null,
  analytics?: AnalyticsEventBus,
) {
  const repo = {
    getByStripeId: jest.fn().mockResolvedValue(existing),
    upsertFromStripe: jest.fn().mockResolvedValue(undefined),
  };
  let handlers: any;
  const webhook = {
    registerHandlers: (h: any) => {
      handlers = h;
    },
  };
  const mod = new SubscriptionsModule(
    repo as any,
    {} as any,
    webhook as any,
    makeConfig(),
    analytics,
  );
  mod.onModuleInit();
  return { repo, handlers };
}

function rawSub(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sub_1',
    customer: 'cus_1',
    status: 'active',
    items: { data: [{ price: { id: 'price_pm' } }] },
    metadata: { userId: 'u1' },
    current_period_start: 1000,
    current_period_end: 2000,
    cancel_at_period_end: false,
    ...overrides,
  };
}

describe('SubscriptionsModule onSubscriptionChanged analytics', () => {
  it('emits subscription.started for a brand-new active subscription', async () => {
    const analytics = new AnalyticsEventBus();
    const seen: AnalyticsEvent[] = [];
    analytics.events$.subscribe((e) => seen.push(e));
    const { repo, handlers } = setup(null, analytics);

    await handlers.onSubscriptionChanged({ raw: rawSub() } as any);

    expect(repo.upsertFromStripe).toHaveBeenCalled(); // the real mutation still runs
    expect(seen).toHaveLength(1);
    expect(seen[0].name).toBe('subscription.started');
    expect(seen[0].user_id).toBe('u1');
    expect(seen[0].props).toEqual({ plan: 'pro', interval: 'month' });
  });

  it('does not re-emit subscription.started on a renewal update for an existing subscription', async () => {
    const analytics = new AnalyticsEventBus();
    const seen: AnalyticsEvent[] = [];
    analytics.events$.subscribe((e) => seen.push(e));
    const { handlers } = setup({ user_id: 'u1' }, analytics);

    await handlers.onSubscriptionChanged({ raw: rawSub() } as any);

    expect(seen).toHaveLength(0);
  });

  it('emits subscription.canceled when status transitions to canceled', async () => {
    const analytics = new AnalyticsEventBus();
    const seen: AnalyticsEvent[] = [];
    analytics.events$.subscribe((e) => seen.push(e));
    const { handlers } = setup({ user_id: 'u1' }, analytics);

    await handlers.onSubscriptionChanged({
      raw: rawSub({ status: 'canceled', cancel_at_period_end: true }),
    } as any);

    expect(seen).toHaveLength(1);
    expect(seen[0].name).toBe('subscription.canceled');
    expect(seen[0].user_id).toBe('u1');
    expect(seen[0].props).toEqual({ plan: 'pro', interval: 'month' });
  });

  it('does not throw when analytics bus is not injected', async () => {
    const { handlers } = setup(null, undefined);
    await expect(
      handlers.onSubscriptionChanged({ raw: rawSub() } as any),
    ).resolves.toBeUndefined();
  });
});

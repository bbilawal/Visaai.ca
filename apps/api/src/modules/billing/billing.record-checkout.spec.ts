import { ConfigService } from '@nestjs/config';
import { BillingService } from './billing.service';
import { AnalyticsEventBus } from '../analytics/analytics-event-bus';
import type { AnalyticsEvent } from '../analytics/events/catalog';

const config = new ConfigService({
  WEB_URL: 'https://app.visaai.test',
  STRIPE_SECRET_KEY: 'sk',
  STRIPE_WEBHOOK_SECRET: 'wh',
});

it('recordCheckoutCompleted inserts a processing_fee payment with currency + provider', async () => {
  const insert = jest.fn().mockReturnValue({
    select: () => ({ single: () => ({ data: { id: 'pay_1' }, error: null }) }),
  });
  const supabase: any = {
    admin: { from: jest.fn().mockReturnValue({ insert }) },
  };
  const notifBus: any = { emit: jest.fn() };
  const svc = new BillingService(
    config,
    supabase,
    {} as any,
    {} as any,
    notifBus,
    { name: 'stripe' } as any,
    {} as any, // credits
    {} as any, // discounts
  );

  await svc.recordCheckoutCompleted({
    type: 'checkout.completed',
    providerEventId: 'evt',
    providerObjectId: 'pi_1',
    amount: { amountMinor: 12345, currency: 'usd' },
    metadata: {
      feature: 'processing_fee',
      userId: 'u1',
      applicationId: 'a1',
      visaType: 'trv',
      country: 'CA',
    },
    raw: {},
  } as any);

  expect(insert).toHaveBeenCalledWith(
    expect.objectContaining({
      feature: 'processing_fee',
      amount_cents: 12345,
      currency: 'usd',
      provider: 'stripe',
      status: 'complete',
    }),
  );
});

it('recordCheckoutCompleted emits a payment.succeeded analytics event with allowlisted props', async () => {
  const insert = jest.fn().mockReturnValue({
    select: () => ({ single: () => ({ data: { id: 'pay_1' }, error: null }) }),
  });
  const supabase: any = {
    admin: { from: jest.fn().mockReturnValue({ insert }) },
  };
  const notifBus: any = { emit: jest.fn() };
  const analytics = new AnalyticsEventBus();
  const seen: AnalyticsEvent[] = [];
  analytics.events$.subscribe((e) => seen.push(e));

  const svc = new BillingService(
    config,
    supabase,
    {} as any,
    {} as any,
    notifBus,
    { name: 'stripe' } as any,
    {} as any, // credits
    {} as any, // discounts
    analytics,
  );

  await svc.recordCheckoutCompleted({
    type: 'checkout.completed',
    providerEventId: 'evt',
    providerObjectId: 'pi_1',
    amount: { amountMinor: 12345, currency: 'usd' },
    metadata: {
      feature: 'processing_fee',
      userId: 'u1',
      applicationId: 'a1',
      visaType: 'trv',
      country: 'CA',
    },
    raw: {},
  } as any);

  expect(seen).toHaveLength(1);
  expect(seen[0].name).toBe('payment.succeeded');
  expect(seen[0].user_id).toBe('u1');
  expect(seen[0].application_id).toBe('a1');
  expect(seen[0].props).toEqual({
    amount_cents: 12345,
    currency: 'usd',
    kind: 'processing_fee',
  });
});

/**
 * A failed `payments` insert used to be invisible.
 *
 * supabase-js resolves a failed insert as `{ data: null, error }` rather than
 * rejecting, and all three insert sites destructured only `data`. So the row
 * never landed, `pay?.id ?? null` carried on, the customer was notified that
 * their payment succeeded, and on the plan branch `applications.plan_tier` was
 * granted anyway: a customer on a paid plan that no revenue total,
 * reconciliation run or tax statement can see, with nothing reporting a problem.
 *
 * The entitlement is still granted on purpose — the customer paid, and
 * `PaymentWebhookService` claims the provider event id as its idempotency gate
 * BEFORE dispatch, so throwing here would make Stripe's retry look like a
 * duplicate and the side effects would never run at all. What must not happen
 * is the failure passing silently.
 */
describe('recordCheckoutCompleted — a failed payments insert', () => {
  function svcWith(insertResult: {
    data: { id: string } | null;
    error: { message: string } | null;
  }) {
    const updateEq2 = jest.fn().mockResolvedValue({ error: null });
    const updateEq1 = jest.fn().mockReturnValue({ eq: updateEq2 });
    const update = jest.fn().mockReturnValue({ eq: updateEq1 });
    const insert = jest.fn().mockReturnValue({
      select: () => ({ single: () => insertResult }),
    });
    const supabase: any = {
      admin: { from: jest.fn().mockReturnValue({ insert, update }) },
    };
    const notifBus: any = { emit: jest.fn() };
    const svc = new BillingService(
      config,
      supabase,
      {} as any,
      {} as any,
      notifBus,
      { name: 'stripe' } as any,
      {} as any,
      {} as any,
    );
    return { svc, insert, update, updateEq1 };
  }

  const planEvent = {
    type: 'checkout.completed',
    providerEventId: 'evt',
    providerObjectId: 'pi_1',
    amount: { amountMinor: 4900, currency: 'usd' },
    metadata: {
      feature: 'plan',
      userId: 'u1',
      applicationId: 'a1',
      planTier: 'pro',
    },
    raw: {},
  } as any;

  it('logs the accounting hole instead of swallowing it', async () => {
    const spy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const { svc } = svcWith({
      data: null,
      error: { message: 'insert denied' },
    });

    await svc.recordCheckoutCompleted(planEvent);

    const logged = spy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).toContain('PAYMENT NOT RECORDED');
    expect(logged).toContain('insert denied');
    spy.mockRestore();
  });

  it('still grants the plan the customer paid for', async () => {
    const spy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const { svc, update } = svcWith({
      data: null,
      error: { message: 'insert denied' },
    });

    await svc.recordCheckoutCompleted(planEvent);

    expect(update).toHaveBeenCalledWith({ plan_tier: 'pro' });
    spy.mockRestore();
  });

  it('says nothing when the insert succeeds', async () => {
    const spy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const { svc } = svcWith({ data: { id: 'pay_1' }, error: null });

    await svc.recordCheckoutCompleted(planEvent);

    const logged = spy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).not.toContain('PAYMENT NOT RECORDED');
    spy.mockRestore();
  });
});

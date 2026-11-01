import { PaymentFailedService } from './payment-failed.service';
import { AnalyticsEventBus } from '../analytics/analytics-event-bus';
import type { AnalyticsEvent } from '../analytics/events/catalog';

function makeRepo() {
  return { markPaymentFailed: jest.fn().mockResolvedValue(undefined) };
}

describe('PaymentFailedService.onPaymentFailed', () => {
  it('marks the pending payment failed', async () => {
    const repo = makeRepo();
    const svc = new PaymentFailedService(repo as any);

    await svc.onPaymentFailed({
      type: 'payment.failed',
      providerEventId: 'evt_1',
      providerObjectId: 'pi_1',
      amount: { amountMinor: 5000, currency: 'usd' },
      metadata: {},
      raw: {},
    });

    expect(repo.markPaymentFailed).toHaveBeenCalledWith('pi_1');
  });

  it('emits a payment.failed analytics event with allowlisted props', async () => {
    const repo = makeRepo();
    const analytics = new AnalyticsEventBus();
    const seen: AnalyticsEvent[] = [];
    analytics.events$.subscribe((e) => seen.push(e));

    const svc = new PaymentFailedService(repo as any, analytics);

    await svc.onPaymentFailed({
      type: 'payment.failed',
      providerEventId: 'evt_1',
      providerObjectId: 'pi_1',
      amount: { amountMinor: 5000, currency: 'usd' },
      metadata: { userId: 'u1', applicationId: 'a1' },
      raw: {},
    });

    expect(seen).toHaveLength(1);
    expect(seen[0].name).toBe('payment.failed');
    expect(seen[0].user_id).toBe('u1');
    expect(seen[0].application_id).toBe('a1');
    expect(seen[0].props).toEqual({
      amount_cents: 5000,
      currency: 'usd',
      kind: 'one_time',
    });
  });

  it('does not throw when analytics bus is not injected', async () => {
    const repo = makeRepo();
    const svc = new PaymentFailedService(repo as any);
    await expect(
      svc.onPaymentFailed({
        type: 'payment.failed',
        providerEventId: 'evt_2',
        providerObjectId: 'pi_2',
        amount: null,
        metadata: {},
        raw: {},
      }),
    ).resolves.toBeUndefined();
  });
});

import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RefundService } from './refund.service';
import { DisputeService } from './dispute.service';
import { DunningService } from './dunning.service';
import { FinancialReportService } from './financial-report.service';

function repo(over: any = {}) {
  return {
    getPayment: jest.fn(),
    insertRefund: jest.fn().mockResolvedValue({ id: 'ref_1' }),
    markRefunded: jest.fn().mockResolvedValue({ paymentId: 'pay_1' }),
    markRefundSucceeded: jest.fn().mockResolvedValue(undefined),
    findServiceOrderByPI: jest.fn().mockResolvedValue(null),
    setServiceOrderStatus: jest.fn().mockResolvedValue(true),
    upsertDispute: jest.fn().mockResolvedValue(undefined),
    markPaymentDisputed: jest.fn().mockResolvedValue(undefined),
    listDisputes: jest.fn(),
    markPaymentFailed: jest.fn(),
    listPastDueSubscriptions: jest.fn().mockResolvedValue([]),
    getDunning: jest.fn(),
    upsertDunning: jest.fn().mockResolvedValue(undefined),
    incrementDunning: jest.fn().mockResolvedValue(undefined),
    setDunningStatus: jest.fn().mockResolvedValue(undefined),
    revenueSummary: jest.fn(),
    revenueByDimension: jest.fn(),
    ...over,
  };
}
const provider = () =>
  ({
    name: 'stripe',
    createRefund: jest.fn().mockResolvedValue({
      id: 're_1',
      status: 'succeeded',
      amount: { amountMinor: 1, currency: 'usd' },
    }),
    reverseTransfer: jest.fn().mockResolvedValue({ id: 'trr_1' }),
    cancelSubscription: jest.fn().mockResolvedValue({}),
  }) as any;

describe('RefundService', () => {
  it('initiateRefund rejects a non-complete payment', async () => {
    const svc = new RefundService(
      provider(),
      repo({
        getPayment: jest.fn().mockResolvedValue({
          id: 'pay_1',
          status: 'failed',
          amount_cents: 100,
          stripe_payment_intent_id: 'pi_1',
        }),
      }),
    );
    await expect(
      svc.initiateRefund('pay_1', 'admin', undefined),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('initiateRefund calls provider + records a refund row', async () => {
    const p = provider();
    const r = repo({
      getPayment: jest.fn().mockResolvedValue({
        id: 'pay_1',
        status: 'complete',
        amount_cents: 30000,
        stripe_payment_intent_id: 'pi_1',
      }),
    });
    const svc = new RefundService(p, r);
    const out = await svc.initiateRefund('pay_1', 'admin');
    expect(p.createRefund).toHaveBeenCalledWith(
      expect.objectContaining({ paymentIntentId: 'pi_1' }),
    );
    expect(r.insertRefund).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentId: 'pay_1',
        amountCents: 30000,
        initiatedBy: 'admin',
      }),
    );
    expect(out).toEqual({ id: 'ref_1' });
  });

  it('onRefundCreated marks refunded + reverses transfer for a service order', async () => {
    const p = provider();
    const r = repo({
      findServiceOrderByPI: jest
        .fn()
        .mockResolvedValue({ id: 'ord_1', transferId: 'tr_1' }),
    });
    const svc = new RefundService(p, r);
    await svc.onRefundCreated({
      type: 'refund.created',
      providerEventId: 'e',
      providerObjectId: 'pi_1',
      amount: { amountMinor: 100, currency: 'usd' },
      metadata: {},
      raw: {},
    } as any);
    expect(r.markRefunded).toHaveBeenCalledWith('pi_1');
    expect(r.setServiceOrderStatus).toHaveBeenCalledWith('ord_1', 'refunded');
    expect(p.reverseTransfer).toHaveBeenCalledWith('tr_1');
  });
});

describe('DisputeService', () => {
  it('onDisputeCreated upserts + flags the payment', async () => {
    const r = repo();
    const svc = new DisputeService(r);
    await svc.onDisputeCreated({
      type: 'dispute.created',
      providerEventId: 'evt_d',
      providerObjectId: 'pi_1',
      amount: { amountMinor: 30000, currency: 'usd' },
      metadata: { disputeId: 'dp_1' },
      raw: {},
    } as any);
    expect(r.upsertDispute).toHaveBeenCalledWith(
      expect.objectContaining({
        stripeDisputeId: 'dp_1',
        providerObjectId: 'pi_1',
      }),
    );
    expect(r.markPaymentDisputed).toHaveBeenCalledWith('pi_1');
  });
});

describe('DunningService', () => {
  const cfg = (max = 4) =>
    new ConfigService({ DUNNING_MAX_ATTEMPTS: max }) as any;

  it('escalates a reminder for a past_due subscription below max', async () => {
    const p = provider();
    const r = repo({
      listPastDueSubscriptions: jest
        .fn()
        .mockResolvedValue([{ id: 's1', stripe_subscription_id: 'sub_1' }]),
      getDunning: jest
        .fn()
        .mockResolvedValue({ attempts: 0, status: 'active' }),
    });
    const svc = new DunningService(r, p, cfg(4));
    const res = await svc.runDailyCycle();
    expect(r.incrementDunning).toHaveBeenCalledWith('s1');
    expect(p.cancelSubscription).not.toHaveBeenCalled();
    expect(res.escalated).toBe(1);
  });

  it('cancels the subscription at the max attempt', async () => {
    const p = provider();
    const r = repo({
      listPastDueSubscriptions: jest
        .fn()
        .mockResolvedValue([{ id: 's1', stripe_subscription_id: 'sub_1' }]),
      getDunning: jest
        .fn()
        .mockResolvedValue({ attempts: 3, status: 'active' }),
    });
    const svc = new DunningService(r, p, cfg(4));
    const res = await svc.runDailyCycle();
    expect(p.cancelSubscription).toHaveBeenCalledWith('sub_1', {
      atPeriodEnd: false,
    });
    expect(r.setDunningStatus).toHaveBeenCalledWith('s1', 'canceled');
    expect(res.canceled).toBe(1);
  });
});

describe('FinancialReportService', () => {
  it('report returns summary + breakdown when a dimension is given', async () => {
    const r = repo({
      revenueSummary: jest.fn().mockResolvedValue({
        collectedCents: 39900,
        refundedCents: 5000,
        netCents: 34900,
        count: 2,
      }),
      revenueByDimension: jest
        .fn()
        .mockResolvedValue([{ key: 'CA', netCents: 25000 }]),
    });
    const svc = new FinancialReportService(r);
    const out = await svc.report('2026-01-01', '2027-01-01', 'country');
    expect(out.summary.netCents).toBe(34900);
    expect(out.breakdown).toEqual([{ key: 'CA', netCents: 25000 }]);
  });
});

/**
 * REF-001 — one refund, two Stripe deliveries, two transfer reversals.
 *
 * Stripe fires `charge.refunded` AND `refund.created` for a single refund, and
 * the provider maps both to the domain type `refund.created` with the same
 * `providerObjectId`. They arrive as two events with two different event ids,
 * so the ledger's per-event-id idempotency gate lets both through and this
 * handler ran twice — calling `reverseTransfer` twice on one transfer, with no
 * idempotency key and no check of what had already been reversed. Real money,
 * already paid out to a consultant.
 *
 * The status transition is now the mutual exclusion.
 */
describe('RefundService.onRefundCreated — reversing at most once', () => {
  const order = { id: 'ord_1', transferId: 'tr_1' };
  const event = {
    type: 'refund.created' as const,
    providerObjectId: 'pi_1',
  } as never;

  it('reverses the consultant transfer on the delivery that wins the transition', async () => {
    const r = repo({
      findServiceOrderByPI: jest.fn().mockResolvedValue(order),
      setServiceOrderStatus: jest.fn().mockResolvedValue(true),
    });
    const p = provider();

    await new RefundService(p as never, r as never).onRefundCreated(event);

    expect(p.reverseTransfer).toHaveBeenCalledWith('tr_1');
  });

  it('does NOT reverse again on the second delivery of the same refund', async () => {
    const r = repo({
      findServiceOrderByPI: jest.fn().mockResolvedValue(order),
      // The order is already 'refunded', so the conditional update matches
      // nothing and reports that this call did not perform the transition.
      setServiceOrderStatus: jest.fn().mockResolvedValue(false),
    });
    const p = provider();

    await new RefundService(p as never, r as never).onRefundCreated(event);

    expect(p.reverseTransfer).not.toHaveBeenCalled();
  });

  it('still marks the payment refunded on both deliveries', async () => {
    const r = repo({
      findServiceOrderByPI: jest.fn().mockResolvedValue(order),
      setServiceOrderStatus: jest.fn().mockResolvedValue(false),
    });

    await new RefundService(provider() as never, r as never).onRefundCreated(
      event,
    );

    expect(r.markRefunded).toHaveBeenCalledWith('pi_1');
  });

  it('reverses nothing when the order carries no transfer', async () => {
    const r = repo({
      findServiceOrderByPI: jest
        .fn()
        .mockResolvedValue({ id: 'ord_1', transferId: null }),
      setServiceOrderStatus: jest.fn().mockResolvedValue(true),
    });
    const p = provider();

    await new RefundService(p as never, r as never).onRefundCreated(event);

    expect(p.reverseTransfer).not.toHaveBeenCalled();
  });
});

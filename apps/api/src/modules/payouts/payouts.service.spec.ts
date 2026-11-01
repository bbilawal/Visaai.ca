import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ConsultantPayout } from '@visaai/types';
import { PayoutsService } from './payouts.service';
import type {
  IPayoutsRepository,
  RecordPayoutInput,
} from './payouts.repository';
import type { IPayoutsStripe } from './payouts.stripe';
import type { SweepableOrder } from './payouts.engine';

const config = new ConfigService({ MIN_PAYOUT_CENTS: 1000 }) as any;

/** Typed recordPayout mock that captures the last input (no `any` indexing). */
function captureRecordPayout() {
  const calls: RecordPayoutInput[] = [];
  const fn = jest.fn((input: RecordPayoutInput): Promise<ConsultantPayout> => {
    calls.push(input);
    return Promise.resolve({ id: 'p1' } as ConsultantPayout);
  });
  return { fn, calls };
}

function makeRepo(over: Partial<IPayoutsRepository> = {}): IPayoutsRepository {
  const notImpl = (n: string) => () => {
    throw new Error(`unexpected repo call: ${n}`);
  };
  return {
    getProfileByUserId: notImpl('getProfileByUserId'),
    getProfileById: notImpl('getProfileById'),
    setConnectAccountId: notImpl('setConnectAccountId'),
    syncKycByAccountId: notImpl('syncKycByAccountId'),
    listSweepableOrders: notImpl('listSweepableOrders'),
    recordPayout: notImpl('recordPayout'),
    getEarnings: notImpl('getEarnings'),
    listPayoutsByConsultant: notImpl('listPayoutsByConsultant'),
    markPayoutReversed: notImpl('markPayoutReversed'),
    upsertTaxProfile: notImpl('upsertTaxProfile'),
    getTaxProfile: notImpl('getTaxProfile'),
    sumPaidForYear: notImpl('sumPaidForYear'),
    upsertTaxStatement: notImpl('upsertTaxStatement'),
    listConsultantsWithPaidPayouts: notImpl('listConsultantsWithPaidPayouts'),
    ...over,
  };
}

function makeStripe(over: Partial<IPayoutsStripe> = {}): IPayoutsStripe {
  const notImpl = (n: string) => () => {
    throw new Error(`unexpected stripe call: ${n}`);
  };
  return {
    createExpressAccount: notImpl('createExpressAccount'),
    createAccountLink: notImpl('createAccountLink'),
    createTransfer: notImpl('createTransfer'),
    // Every sweep resolves a charge per order; default to a derivable one so
    // tests that don't care about funding still exercise the real path.
    resolveChargeFunding: jest.fn((pi: string) =>
      Promise.resolve({
        chargeId: `ch_for_${pi}`,
        // Same currency as the order by default, so existing expectations
        // stay about source_transaction rather than conversion.
        settlementCurrency: 'usd',
        settledAmountMinor: 10000,
      }),
    ),
    createExpressDashboardLink: notImpl('createExpressDashboardLink'),
    ...over,
  };
}

const sweepable = (over: Partial<SweepableOrder> = {}): SweepableOrder => ({
  service_order_id: 'o1',
  consultant_id: 'c1',
  consultant_payout_usd: 80,
  amount_usd: 100,
  currency: 'usd',
  stripe_connect_account_id: 'acct_1',
  payouts_enabled: true,
  stripe_payment_intent_id: 'pi_1',
  ...over,
});

describe('PayoutsService', () => {
  describe('sweep', () => {
    it('creates one transfer PER ORDER, funded by that order’s charge, under a single payout', async () => {
      const createTransfer = jest
        .fn()
        .mockResolvedValueOnce({ id: 'tr_1' })
        .mockResolvedValueOnce({ id: 'tr_2' });
      const recordPayout = captureRecordPayout();
      const svc = new PayoutsService(
        makeRepo({
          listSweepableOrders: jest.fn().mockResolvedValue([
            sweepable({
              service_order_id: 'o1',
              consultant_payout_usd: 80,
              stripe_payment_intent_id: 'pi_a',
            }),
            sweepable({
              service_order_id: 'o2',
              consultant_payout_usd: 40,
              stripe_payment_intent_id: 'pi_b',
            }),
          ]),
          recordPayout: recordPayout.fn,
        }),
        makeStripe({ createTransfer }),
        config,
      );

      const summary = await svc.sweep();

      // Two orders -> two transfers, each carrying its own charge. A grouped
      // transfer could not name a source_transaction at all.
      expect(createTransfer).toHaveBeenCalledTimes(2);
      expect(createTransfer).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          amountCents: 8000,
          currency: 'usd',
          destination: 'acct_1',
          sourceTransaction: 'ch_for_pi_a',
          idempotencyKey: 'payout_item_o1',
        }),
      );
      expect(createTransfer).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          amountCents: 4000,
          sourceTransaction: 'ch_for_pi_b',
          idempotencyKey: 'payout_item_o2',
        }),
      );

      // One payout row still groups them; transfer ids live on the items.
      expect(recordPayout.calls).toHaveLength(1);
      const recorded = recordPayout.calls[0];
      expect(recorded.status).toBe('paid');
      expect(recorded.stripe_transfer_id).toBeNull();
      expect(recorded.amount_usd).toBe(120);
      expect(recorded.items).toEqual([
        {
          service_order_id: 'o1',
          amount_usd: 80,
          stripe_transfer_id: 'tr_1',
        },
        {
          service_order_id: 'o2',
          amount_usd: 40,
          stripe_transfer_id: 'tr_2',
        },
      ]);
      expect(summary).toEqual({
        consultants: 1,
        orders_swept: 2,
        transferred_usd: 120,
        failed: 0,
      });
    });

    it('transfers in the SETTLEMENT currency when the charge settled in another one', async () => {
      // Reproduces the live 2026-08-13 sweep failure: a CA platform billing USD
      // settles into CAD, and Stripe rejected the USD transfer outright with
      // "The currency of source_transaction's balance transaction (cad) must be
      // the same as the transfer currency (usd)".
      const createTransfer = jest.fn().mockResolvedValue({ id: 'tr_1' });
      const recordPayout = captureRecordPayout();
      const svc = new PayoutsService(
        makeRepo({
          listSweepableOrders: jest.fn().mockResolvedValue([
            sweepable({
              consultant_payout_usd: 39.2,
              amount_usd: 49,
              stripe_payment_intent_id: 'pi_ca',
            }),
          ]),
          recordPayout: recordPayout.fn,
        }),
        makeStripe({
          createTransfer,
          resolveChargeFunding: jest.fn(() =>
            Promise.resolve({
              chargeId: 'ch_ca',
              settlementCurrency: 'cad',
              settledAmountMinor: 6700, // $49 settled as C$67.00
            }),
          ),
        }),
        config,
      );

      await svc.sweep();

      expect(createTransfer).toHaveBeenCalledWith(
        expect.objectContaining({
          currency: 'cad',
          amountCents: 5360, // 80% of the settled gross = C$ equal to $39.20
          sourceTransaction: 'ch_ca',
        }),
      );
      // The ledger still records what is OWED, in USD — only the movement is CAD.
      const recorded = recordPayout.calls[0];
      expect(recorded.amount_usd).toBe(39.2);
      expect(recorded.currency).toBe('usd');
    });

    it('omits sourceTransaction when the order has no resolvable charge', async () => {
      const createTransfer = jest.fn().mockResolvedValue({ id: 'tr_1' });
      const recordPayout = captureRecordPayout();
      const svc = new PayoutsService(
        makeRepo({
          listSweepableOrders: jest
            .fn()
            .mockResolvedValue([sweepable({ stripe_payment_intent_id: null })]),
          recordPayout: recordPayout.fn,
        }),
        makeStripe({ createTransfer }),
        config,
      );

      await svc.sweep();

      // Falls back to drawing on available balance rather than refusing to pay.
      expect(createTransfer).toHaveBeenCalledWith(
        expect.objectContaining({ sourceTransaction: undefined }),
      );
    });

    it('keeps the orders that transferred when a sibling order fails', async () => {
      const createTransfer = jest
        .fn()
        .mockResolvedValueOnce({ id: 'tr_1' })
        .mockRejectedValueOnce(new Error('balance_insufficient'));
      const recordPayout = captureRecordPayout();
      const svc = new PayoutsService(
        makeRepo({
          listSweepableOrders: jest
            .fn()
            .mockResolvedValue([
              sweepable({ service_order_id: 'o1', consultant_payout_usd: 80 }),
              sweepable({ service_order_id: 'o2', consultant_payout_usd: 40 }),
            ]),
          recordPayout: recordPayout.fn,
        }),
        makeStripe({ createTransfer }),
        config,
      );

      const summary = await svc.sweep();

      // o2 gets no payout_item, so the next sweep retries exactly that order.
      const recorded = recordPayout.calls[0];
      expect(recorded.status).toBe('paid');
      expect(recorded.amount_usd).toBe(80);
      expect(recorded.items.map((i) => i.service_order_id)).toEqual(['o1']);
      expect(summary.orders_swept).toBe(1);
      expect(summary.transferred_usd).toBe(80);
      expect(summary.failed).toBe(1);
    });

    it('skips a consultant group below MIN_PAYOUT_CENTS (rolls over)', async () => {
      const createTransfer = jest.fn();
      const recordPayout = captureRecordPayout();
      const svc = new PayoutsService(
        makeRepo({
          listSweepableOrders: jest
            .fn()
            .mockResolvedValue([sweepable({ consultant_payout_usd: 5 })]), // $5 < $10 min
          recordPayout: recordPayout.fn,
        }),
        makeStripe({ createTransfer }),
        config,
      );
      const summary = await svc.sweep();
      expect(createTransfer).not.toHaveBeenCalled();
      expect(recordPayout.calls).toHaveLength(0);
      expect(summary.consultants).toBe(0);
    });

    it('records a failed payout (no items) when the transfer throws', async () => {
      const recordPayout = captureRecordPayout();
      const svc = new PayoutsService(
        makeRepo({
          listSweepableOrders: jest.fn().mockResolvedValue([sweepable()]),
          recordPayout: recordPayout.fn,
        }),
        makeStripe({
          createTransfer: jest
            .fn()
            .mockRejectedValue(new Error('insufficient funds')),
        }),
        config,
      );

      const summary = await svc.sweep();

      expect(summary.failed).toBe(1);
      expect(summary.orders_swept).toBe(0);
      expect(recordPayout.calls).toHaveLength(1);
      const recorded = recordPayout.calls[0];
      expect(recorded.status).toBe('failed');
      expect(recorded.stripe_transfer_id).toBeNull();
      expect(recorded.items).toHaveLength(0);
    });

    it('no transfer when nothing is sweepable', async () => {
      const createTransfer = jest.fn();
      const svc = new PayoutsService(
        makeRepo({ listSweepableOrders: jest.fn().mockResolvedValue([]) }),
        makeStripe({ createTransfer }),
        config,
      );
      const summary = await svc.sweep();
      expect(createTransfer).not.toHaveBeenCalled();
      expect(summary).toEqual({
        consultants: 0,
        orders_swept: 0,
        transferred_usd: 0,
        failed: 0,
      });
    });
  });

  describe('earnings', () => {
    it('resolves the caller profile and computes the summary', async () => {
      const svc = new PayoutsService(
        makeRepo({
          getProfileByUserId: jest
            .fn()
            .mockResolvedValue({ id: 'c1', user_id: 'u1' }),
          getEarnings: jest.fn().mockResolvedValue({
            lifetime_usd: 200,
            paid_out_usd: 120,
            orders_count: 3,
          }),
        }),
        makeStripe(),
        config,
      );
      const e = await svc.earnings('u1');
      expect(e).toMatchObject({
        consultant_id: 'c1',
        lifetime_usd: 200,
        paid_out_usd: 120,
        pending_usd: 80,
        orders_count: 3,
      });
    });

    it('rejects a caller with no consultant profile', async () => {
      const svc = new PayoutsService(
        makeRepo({ getProfileByUserId: jest.fn().mockResolvedValue(null) }),
        makeStripe(),
        config,
      );
      await expect(svc.earnings('u1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });
});

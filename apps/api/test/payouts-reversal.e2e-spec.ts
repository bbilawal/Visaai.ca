import { ConfigService } from '@nestjs/config';
import { PayoutsService } from '../src/modules/payouts/payouts.service';
import { PayoutsRepository } from '../src/modules/payouts/payouts.repository.impl';

// A reversed payout must delete its item links so the order re-enters listSweepableOrders.
describe('payout reversal → re-sweepable (e2e)', () => {
  it('clears items on reversal so the order is sweepable again', async () => {
    const payouts = [
      {
        id: 'po_1',
        consultant_id: 'c1',
        stripe_transfer_id: 'tr_1',
        status: 'paid',
      },
    ];
    const items = [
      { payout_id: 'po_1', service_order_id: 'o1', amount_usd: 50 },
    ];

    const admin = {
      from(table: string) {
        if (table === 'consultant_payouts') {
          return {
            update: () => ({
              eq: () => ({
                select: () => ({
                  maybeSingle: () => {
                    payouts[0].status = 'reversed';
                    return Promise.resolve({
                      data: { id: 'po_1', consultant_id: 'c1' },
                    });
                  },
                }),
              }),
            }),
          };
        }
        if (table === 'consultant_payout_items') {
          return {
            delete: () => ({
              eq: (_c: string, id: string) => {
                for (let i = items.length - 1; i >= 0; i--) {
                  if (items[i].payout_id === id) items.splice(i, 1);
                }
                return Promise.resolve({ error: null });
              },
            }),
          };
        }
        throw new Error(`unexpected ${table}`);
      },
    };
    const repo = new PayoutsRepository({ admin } as any);
    const svc = new PayoutsService(
      repo,
      {} as any,
      new ConfigService({ MIN_PAYOUT_CENTS: 1000 }),
    );

    await svc.handleTransferReversed('tr_1');

    expect(payouts[0].status).toBe('reversed');
    expect(items).toHaveLength(0); // item link cleared → order o1 no longer "swept"
  });
});

import { RefundService } from '../src/modules/financial-ops/refund.service';
import { FinancialOpsRepository } from '../src/modules/financial-ops/financial-ops.repository.impl';

// A refund of a marketplace-order charge must mark the order refunded AND reverse
// the consultant transfer (clawback). Uses the real repo over an in-memory Supabase.
describe('financial-ops refund → marketplace clawback (e2e)', () => {
  function setup(initialStatus = 'paid') {
    const orders = [
      { id: 'ord_1', stripe_payment_intent_id: 'pi_1', status: initialStatus },
    ];
    const admin = {
      from(table: string) {
        if (table === 'payments') {
          return {
            update: () => ({
              eq: () => ({
                select: () => ({
                  maybeSingle: () => Promise.resolve({ data: { id: 'pay_1' } }),
                }),
              }),
            }),
          };
        }
        if (table === 'refunds') {
          return {
            update: () => ({
              eq: () => ({ eq: () => Promise.resolve({ error: null }) }),
            }),
          };
        }
        if (table === 'consultant_service_orders') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: () => Promise.resolve({ data: { id: 'ord_1' } }),
              }),
            }),
            // update({ status }).eq('id', id).neq('status', status).select('id')
            // — the repository's once-only guard: only a row not already in
            // the target state moves, and the moved rows come back.
            update: (patch: { status: string }) => ({
              eq: (_c: string, id: string) => ({
                neq: (_c2: string, status: string) => ({
                  select: () => {
                    const moved = orders.filter(
                      (x) => x.id === id && x.status !== status,
                    );
                    for (const o of moved) o.status = patch.status;
                    return Promise.resolve({
                      data: moved.map((o) => ({ id: o.id })),
                      error: null,
                    });
                  },
                }),
              }),
            }),
          };
        }
        if (table === 'consultant_payout_items') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({ data: { payout_id: 'po_1' } }),
              }),
            }),
          };
        }
        if (table === 'consultant_payouts') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({ data: { stripe_transfer_id: 'tr_1' } }),
              }),
            }),
          };
        }
        throw new Error(`unexpected ${table}`);
      },
    };
    const repo = new FinancialOpsRepository({ admin } as any);
    const provider = {
      name: 'stripe',
      reverseTransfer: jest.fn().mockResolvedValue({ id: 'trr_1' }),
    } as any;
    return { orders, provider, svc: new RefundService(provider, repo) };
  }

  const refundCreated = {
    type: 'refund.created',
    providerEventId: 'evt',
    providerObjectId: 'pi_1',
    amount: { amountMinor: 30000, currency: 'usd' },
    metadata: {},
    raw: {},
  } as any;

  it('marks order refunded + reverses the payout transfer', async () => {
    const { orders, provider, svc } = setup();

    await svc.onRefundCreated(refundCreated);

    expect(orders[0].status).toBe('refunded');
    expect(provider.reverseTransfer).toHaveBeenCalledWith('tr_1');
  });

  it('does not reverse the transfer again for an order already refunded', async () => {
    const { orders, provider, svc } = setup();

    await svc.onRefundCreated(refundCreated);
    await svc.onRefundCreated(refundCreated); // provider redelivery / second refund event

    expect(orders[0].status).toBe('refunded');
    expect(provider.reverseTransfer).toHaveBeenCalledTimes(1);
  });
});

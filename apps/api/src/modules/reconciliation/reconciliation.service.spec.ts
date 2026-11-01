import { ReconciliationService } from './reconciliation.service';

function makeSupabase(ledgerRows: any[]) {
  const runInsert = jest.fn().mockReturnValue({
    select: () => ({ single: () => ({ data: { id: 'run_1' }, error: null }) }),
  });
  const excInsert = jest.fn().mockResolvedValue({ error: null });
  const runUpdate = jest.fn().mockReturnValue({ eq: () => ({ error: null }) });
  const from = jest.fn((table: string) => {
    if (table === 'payment_events') {
      return {
        select: () => ({
          gte: () => ({ lt: () => ({ data: ledgerRows, error: null }) }),
        }),
      };
    }
    if (table === 'reconciliation_runs') {
      return { insert: runInsert, update: runUpdate };
    }
    if (table === 'reconciliation_exceptions') return { insert: excInsert };
    throw new Error(`unexpected table ${table}`);
  });
  return { supabase: { admin: { from } } as any, runInsert, excInsert };
}

const range = {
  start: new Date('2026-07-04T00:00:00Z'),
  end: new Date('2026-07-05T00:00:00Z'),
};

function makeProvider(items: any[]) {
  return {
    name: 'stripe',
    listBalanceTransactions: jest
      .fn()
      .mockResolvedValue({ items, nextCursor: null }),
  } as any;
}

describe('ReconciliationService', () => {
  it('matches equal ledger + balance txns with no exceptions', async () => {
    const { supabase, excInsert } = makeSupabase([
      { provider_object_id: 'pi_1', amount_minor: 2900, currency: 'usd' },
    ]);
    const provider = makeProvider([
      {
        id: 'txn_1',
        providerObjectId: 'pi_1',
        amount: { amountMinor: 2900, currency: 'usd' },
        type: 'charge',
        createdAt: new Date(),
      },
    ]);
    const svc = new ReconciliationService(provider, supabase);
    const res = await svc.reconcile(range);
    expect(res.matched).toBe(1);
    expect(res.exceptions).toHaveLength(0);
    expect(excInsert).not.toHaveBeenCalled();
  });

  it('flags missing_in_ledger when Stripe has a txn with no ledger event', async () => {
    const { supabase } = makeSupabase([]);
    const provider = makeProvider([
      {
        id: 'txn_1',
        providerObjectId: 'pi_1',
        amount: { amountMinor: 2900, currency: 'usd' },
        type: 'charge',
        createdAt: new Date(),
      },
    ]);
    const svc = new ReconciliationService(provider, supabase);
    const res = await svc.reconcile(range);
    expect(res.exceptions).toEqual([
      expect.objectContaining({
        kind: 'missing_in_ledger',
        providerObjectId: 'pi_1',
      }),
    ]);
  });

  it('flags phantom_in_ledger when a ledger event has no Stripe txn', async () => {
    const { supabase } = makeSupabase([
      { provider_object_id: 'pi_9', amount_minor: 100, currency: 'usd' },
    ]);
    const provider = makeProvider([]);
    const svc = new ReconciliationService(provider, supabase);
    const res = await svc.reconcile(range);
    expect(res.exceptions).toEqual([
      expect.objectContaining({
        kind: 'phantom_in_ledger',
        providerObjectId: 'pi_9',
      }),
    ]);
  });

  it('flags amount_mismatch when amounts differ', async () => {
    const { supabase } = makeSupabase([
      { provider_object_id: 'pi_1', amount_minor: 2900, currency: 'usd' },
    ]);
    const provider = makeProvider([
      {
        id: 'txn_1',
        providerObjectId: 'pi_1',
        amount: { amountMinor: 3000, currency: 'usd' },
        type: 'charge',
        createdAt: new Date(),
      },
    ]);
    const svc = new ReconciliationService(provider, supabase);
    const res = await svc.reconcile(range);
    expect(res.exceptions).toEqual([
      expect.objectContaining({
        kind: 'amount_mismatch',
        providerObjectId: 'pi_1',
      }),
    ]);
  });
});

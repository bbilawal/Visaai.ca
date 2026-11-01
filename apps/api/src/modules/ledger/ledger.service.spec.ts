import { LedgerService } from './ledger.service';

function makeSupabase(rpcImpl: jest.Mock) {
  const admin = { rpc: rpcImpl };
  return { admin } as any;
}

const baseEvent = {
  provider: 'stripe',
  eventType: 'checkout.completed',
  providerEventId: 'evt_1',
  providerObjectId: 'pi_1',
  amount: { amountMinor: 2900, currency: 'usd' },
  direction: 'credit' as const,
  userId: 'u1',
  relatedEntity: { applicationId: 'app_1' },
  occurredAt: new Date('2026-07-04T00:00:00Z'),
};

describe('LedgerService', () => {
  it('atomically claims an event while mapping Money to minor units', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: 'claimed', error: null });
    const svc = new LedgerService(makeSupabase(rpc));
    await expect(svc.claim(baseEvent)).resolves.toBe('claimed');
    expect(rpc).toHaveBeenCalledWith(
      'claim_payment_webhook_event',
      expect.objectContaining({
        p_provider_event_id: 'evt_1',
        p_amount_minor: 2900,
        p_currency: 'usd',
        p_direction: 'credit',
        p_related_entity: { applicationId: 'app_1' },
      }),
    );
  });

  it('returns the durable duplicate/processing state without guessing', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: 'processed', error: null });
    const svc = new LedgerService(makeSupabase(rpc));
    await expect(svc.claim(baseEvent)).resolves.toBe('processed');
  });

  it('rethrows claim errors', async () => {
    const rpc = jest.fn().mockResolvedValue({ error: { message: 'boom' } });
    const svc = new LedgerService(makeSupabase(rpc));
    await expect(svc.claim(baseEvent)).rejects.toThrow('boom');
  });

  it('marks a handler attempt completed or retryable', async () => {
    const rpc = jest.fn().mockResolvedValue({ error: null });
    const svc = new LedgerService(makeSupabase(rpc));
    await svc.markProcessed('evt_1');
    await svc.markFailed('evt_1', 'boom');
    expect(rpc).toHaveBeenNthCalledWith(1, 'complete_payment_webhook_event', {
      p_provider_event_id: 'evt_1',
    });
    expect(rpc).toHaveBeenNthCalledWith(2, 'fail_payment_webhook_event', {
      p_provider_event_id: 'evt_1',
      p_error: 'boom',
    });
  });
});

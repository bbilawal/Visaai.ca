import { Test } from '@nestjs/testing';
import {
  PAYMENT_PROVIDER,
  type PaymentWebhookEvent,
} from '../src/modules/shared/payments/payment-provider.port';
import { PAYMENT_EVENT_RECORDER } from '../src/modules/shared/payments/payment-event-recorder.port';
import { PaymentWebhookService } from '../src/modules/shared/payments/payment-webhook.service';
import { LedgerService } from '../src/modules/ledger/ledger.service';
import { SupabaseService } from '../src/modules/shared/supabase/supabase.service';
import { paymentWebhookRpc } from './fakes/payment-webhook-rpc.fake';

describe('payment webhook pipeline (e2e)', () => {
  // In-memory Supabase fake: records inserts by table, enforces the unique
  // provider_event_id constraint that the real ledger relies on for idempotency.
  function makeFakeSupabase() {
    const tables: Record<string, any[]> = { payment_events: [], payments: [] };
    const admin = {
      rpc: paymentWebhookRpc(tables),
      from(table: string) {
        return {
          insert: (row: any) => {
            if (
              table === 'payment_events' &&
              tables.payment_events.some(
                (r) => r.provider_event_id === row.provider_event_id,
              )
            ) {
              return Promise.resolve({ error: { code: '23505' } });
            }
            tables[table] ??= [];
            tables[table].push(row);
            return Promise.resolve({ error: null });
          },
          select: () => ({
            eq: () => ({ maybeSingle: () => Promise.resolve({ data: null }) }),
          }),
          update: () => ({
            eq: () => ({ eq: () => Promise.resolve({ error: null }) }),
          }),
        };
      },
    };
    return { tables, service: { admin } as unknown as SupabaseService };
  }

  const checkoutEvent: PaymentWebhookEvent = {
    type: 'checkout.completed',
    providerEventId: 'evt_1',
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
  };

  async function build(
    fakeSupabase: SupabaseService,
    event: PaymentWebhookEvent,
  ) {
    const provider = {
      name: 'stripe',
      verifyAndParseWebhook: () => event,
    } as any;
    const moduleRef = await Test.createTestingModule({
      providers: [
        PaymentWebhookService,
        LedgerService,
        { provide: PAYMENT_PROVIDER, useValue: provider },
        // Mirrors ledger.module.ts. PaymentWebhookService takes the
        // PAYMENT_EVENT_RECORDER port, not LedgerService — the ARCH-003
        // refactor that broke the shared->ledger cycle. These specs still
        // registered the concrete class only, so DI could not resolve.
        { provide: PAYMENT_EVENT_RECORDER, useExisting: LedgerService },
        { provide: SupabaseService, useValue: fakeSupabase },
      ],
    }).compile();
    return moduleRef.get(PaymentWebhookService);
  }

  it('records exactly one ledger event + dispatches once; replay is a no-op', async () => {
    const fake = makeFakeSupabase();
    const svc = await build(fake.service, checkoutEvent);
    const onCheckoutCompleted = jest.fn().mockResolvedValue(undefined);
    svc.registerHandlers({ onCheckoutCompleted });

    await svc.handle(Buffer.from('{}'), 'sig', 'platform'); // first delivery
    await svc.handle(Buffer.from('{}'), 'sig', 'platform'); // replay

    expect(fake.tables.payment_events).toHaveLength(1);
    expect(fake.tables.payment_events[0].amount_minor).toBe(12345);
    expect(onCheckoutCompleted).toHaveBeenCalledTimes(1);
  });
});

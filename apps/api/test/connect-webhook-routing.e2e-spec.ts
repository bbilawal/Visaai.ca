import type { RawBodyRequest } from '@nestjs/common';
import { BillingController } from '../src/modules/billing/billing.controller';
import { BillingService } from '../src/modules/billing/billing.service';
import { PaymentWebhookService } from '../src/modules/shared/payments/payment-webhook.service';
import { LedgerService } from '../src/modules/ledger/ledger.service';
import { SupabaseService } from '../src/modules/shared/supabase/supabase.service';
import type {
  PaymentWebhookEvent,
  WebhookKind,
} from '../src/modules/shared/payments/payment-provider.port';
import { paymentWebhookRpc } from './fakes/payment-webhook-rpc.fake';

/**
 * Connect events (account.updated, transfer.reversed) are delivered by Stripe to
 * a SEPARATE webhook endpoint with its OWN signing secret. The provider already
 * reads STRIPE_CONNECT_WEBHOOK_SECRET when it is handed kind:'connect' — but
 * nothing ever handed it that, because the only HTTP route hardcoded 'platform'.
 * These tests pin the routing so the connect secret is actually reachable.
 */
describe('connect webhook routing', () => {
  function makeFakeSupabase() {
    const rows: any[] = [];
    const admin = {
      rpc: paymentWebhookRpc({}),
      from() {
        return {
          insert: (row: any) => {
            rows.push(row);
            return Promise.resolve({ error: null });
          },
        };
      },
    };
    return { rows, service: { admin } as unknown as SupabaseService };
  }

  const accountUpdated: PaymentWebhookEvent = {
    type: 'connect.account.updated',
    providerEventId: 'evt_connect_1',
    providerObjectId: 'acct_1',
    amount: null,
    metadata: {},
    raw: {},
  };

  /** Builds a real controller + real webhook service; only the provider is faked,
   *  so it can record the WebhookKind it was asked to verify with. */
  function build() {
    const seenKinds: WebhookKind[] = [];
    const provider = {
      name: 'stripe',
      verifyAndParseWebhook: (
        _body: Buffer,
        _sig: string,
        kind: WebhookKind,
      ) => {
        seenKinds.push(kind);
        return accountUpdated;
      },
    } as any;

    const fake = makeFakeSupabase();
    const webhookService = new PaymentWebhookService(
      provider,
      new LedgerService(fake.service),
    );
    const controller = new BillingController(
      {} as BillingService,
      webhookService,
    );
    return { controller, webhookService, seenKinds };
  }

  const req = { rawBody: Buffer.from('{}') } as RawBodyRequest<Request>;

  it('verifies connect deliveries with the connect secret, not the platform one', async () => {
    const { controller, seenKinds } = build();

    await controller.handleConnectWebhook(req, 'sig');

    expect(seenKinds).toEqual(['connect']);
  });

  it('dispatches connect account updates to the registered domain handler', async () => {
    const { controller, webhookService } = build();
    const onConnectAccountUpdated = jest.fn().mockResolvedValue(undefined);
    webhookService.registerHandlers({ onConnectAccountUpdated });

    await controller.handleConnectWebhook(req, 'sig');

    expect(onConnectAccountUpdated).toHaveBeenCalledTimes(1);
  });

  it('still verifies the main endpoint as a platform delivery', async () => {
    const { controller, seenKinds } = build();

    await controller.handleWebhook(req, 'sig');

    expect(seenKinds).toEqual(['platform']);
  });
});

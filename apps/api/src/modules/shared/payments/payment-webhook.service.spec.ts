import { PaymentWebhookService } from './payment-webhook.service';
import type { PaymentWebhookEvent } from './payment-provider.port';

function makeProvider(event: PaymentWebhookEvent) {
  return {
    name: 'stripe',
    verifyAndParseWebhook: jest.fn().mockReturnValue(event),
  } as any;
}

function makeLedger(state: 'claimed' | 'processed' | 'processing' = 'claimed') {
  return {
    claim: jest.fn().mockResolvedValue(state),
    markProcessed: jest.fn().mockResolvedValue(undefined),
    markFailed: jest.fn().mockResolvedValue(undefined),
  } as any;
}

const checkoutEvent: PaymentWebhookEvent = {
  type: 'checkout.completed',
  providerEventId: 'evt_1',
  providerObjectId: 'pi_1',
  amount: { amountMinor: 2900, currency: 'usd' },
  metadata: { feature: 'plan', userId: 'u1' },
  raw: {},
};

describe('PaymentWebhookService', () => {
  it('records to the ledger then dispatches the checkout handler', async () => {
    const ledger = makeLedger();
    const svc = new PaymentWebhookService(makeProvider(checkoutEvent), ledger);
    const onCheckoutCompleted = jest.fn().mockResolvedValue(undefined);
    svc.registerHandlers({ onCheckoutCompleted });

    await svc.handle(Buffer.from('{}'), 'sig', 'platform');

    expect(ledger.claim).toHaveBeenCalledWith(
      expect.objectContaining({
        providerEventId: 'evt_1',
        providerObjectId: 'pi_1',
        direction: 'credit',
      }),
    );
    expect(onCheckoutCompleted).toHaveBeenCalledWith(checkoutEvent);
  });

  it('is idempotent: a completed duplicate does NOT dispatch', async () => {
    const ledger = makeLedger('processed');
    const svc = new PaymentWebhookService(makeProvider(checkoutEvent), ledger);
    const onCheckoutCompleted = jest.fn();
    svc.registerHandlers({ onCheckoutCompleted });

    await svc.handle(Buffer.from('{}'), 'sig', 'platform');

    expect(onCheckoutCompleted).not.toHaveBeenCalled();
  });

  it('does not acknowledge an in-progress delivery as a duplicate', async () => {
    const ledger = makeLedger('processing');
    const svc = new PaymentWebhookService(makeProvider(checkoutEvent), ledger);
    const onCheckoutCompleted = jest.fn();
    svc.registerHandlers({ onCheckoutCompleted });

    await expect(
      svc.handle(Buffer.from('{}'), 'sig', 'platform'),
    ).rejects.toMatchObject({
      status: 503,
    });
    expect(onCheckoutCompleted).not.toHaveBeenCalled();
  });

  it('releases a failed handler attempt so the provider can retry it', async () => {
    const ledger = makeLedger();
    const svc = new PaymentWebhookService(makeProvider(checkoutEvent), ledger);
    svc.registerHandlers({
      onCheckoutCompleted: jest
        .fn()
        .mockRejectedValue(new Error('database timeout')),
    });

    await expect(
      svc.handle(Buffer.from('{}'), 'sig', 'platform'),
    ).rejects.toThrow('database timeout');
    expect(ledger.markFailed).toHaveBeenCalledWith('evt_1', 'database timeout');
    expect(ledger.markProcessed).not.toHaveBeenCalled();
  });

  it('dispatches connect.account.updated to its handler', async () => {
    const ev: PaymentWebhookEvent = {
      type: 'connect.account.updated',
      providerEventId: 'evt_2',
      providerObjectId: 'acct_1',
      amount: null,
      metadata: {},
      raw: { id: 'acct_1' },
    };
    const ledger = makeLedger();
    const svc = new PaymentWebhookService(makeProvider(ev), ledger);
    const onConnectAccountUpdated = jest.fn().mockResolvedValue(undefined);
    svc.registerHandlers({ onConnectAccountUpdated });
    await svc.handle(Buffer.from('{}'), 'sig', 'platform');
    expect(onConnectAccountUpdated).toHaveBeenCalledWith(ev);
  });

  it('unhandled event type records to ledger but dispatches nothing', async () => {
    const ev: PaymentWebhookEvent = {
      type: 'unhandled',
      providerEventId: 'evt_3',
      providerObjectId: 'x',
      amount: null,
      metadata: {},
      raw: {},
    };
    const ledger = makeLedger();
    const svc = new PaymentWebhookService(makeProvider(ev), ledger);
    await expect(
      svc.handle(Buffer.from('{}'), 'sig', 'platform'),
    ).resolves.toBeUndefined();
    expect(ledger.claim).toHaveBeenCalled();
  });
});

describe('PaymentWebhookService — transfer.reversed', () => {
  it('dispatches transfer.reversed', async () => {
    const ev: PaymentWebhookEvent = {
      type: 'transfer.reversed',
      providerEventId: 'e_tr',
      providerObjectId: 'tr_1',
      amount: { amountMinor: 5000, currency: 'usd' },
      metadata: {},
      raw: {},
    };
    const ledger = makeLedger();
    const svc = new PaymentWebhookService(
      { name: 'stripe', verifyAndParseWebhook: () => ev } as any,
      ledger,
    );
    const onTransferReversed = jest.fn().mockResolvedValue(undefined);
    svc.registerHandlers({ onTransferReversed });
    await svc.handle(Buffer.from('{}'), 's', 'platform');
    expect(onTransferReversed).toHaveBeenCalledWith(ev);
  });
});

describe('PaymentWebhookService — SP5 refund/dispute/payment-failed', () => {
  const cases: Array<[string, any]> = [
    ['refund.created', 'onRefundCreated'],
    ['dispute.created', 'onDisputeCreated'],
    ['payment.failed', 'onPaymentFailed'],
  ];
  it.each(cases)('dispatches %s', async (type, handlerName) => {
    const ev: any = {
      type,
      providerEventId: 'e_' + type,
      providerObjectId: 'pi_1',
      amount: { amountMinor: 100, currency: 'usd' },
      metadata: {},
      raw: {},
    };
    const ledger = makeLedger();
    const svc = new PaymentWebhookService(
      { name: 'stripe', verifyAndParseWebhook: () => ev } as any,
      ledger,
    );
    const handler = jest.fn().mockResolvedValue(undefined);
    svc.registerHandlers({ [handlerName]: handler });
    await svc.handle(Buffer.from('{}'), 's', 'platform');
    expect(handler).toHaveBeenCalledWith(ev);
  });
});

describe('PaymentWebhookService — subscription events', () => {
  const subEvent: PaymentWebhookEvent = {
    type: 'subscription.updated',
    providerEventId: 'evt_su',
    providerObjectId: 'sub_1',
    amount: null,
    metadata: {},
    raw: { id: 'sub_1', status: 'active' },
  };
  it('dispatches subscription.updated', async () => {
    const ledger = makeLedger();
    const provider = {
      name: 'stripe',
      verifyAndParseWebhook: () => subEvent,
    } as any;
    const svc = new PaymentWebhookService(provider, ledger);
    const onSubscriptionChanged = jest.fn().mockResolvedValue(undefined);
    svc.registerHandlers({ onSubscriptionChanged });
    await svc.handle(Buffer.from('{}'), 's', 'platform');
    expect(onSubscriptionChanged).toHaveBeenCalledWith(subEvent);
  });

  it('dispatches invoice.paid and invoice.payment_failed', async () => {
    const ledger = makeLedger();
    const paid: PaymentWebhookEvent = {
      type: 'invoice.paid',
      providerEventId: 'e1',
      providerObjectId: 'sub_1',
      amount: { amountMinor: 1500, currency: 'usd' },
      metadata: {},
      raw: {},
    };
    const failed: PaymentWebhookEvent = {
      type: 'invoice.payment_failed',
      providerEventId: 'e2',
      providerObjectId: 'sub_1',
      amount: null,
      metadata: {},
      raw: {},
    };
    const onInvoicePaid = jest.fn().mockResolvedValue(undefined);
    const onInvoicePaymentFailed = jest.fn().mockResolvedValue(undefined);

    let svc = new PaymentWebhookService(
      { name: 'stripe', verifyAndParseWebhook: () => paid } as any,
      ledger,
    );
    svc.registerHandlers({ onInvoicePaid, onInvoicePaymentFailed });
    await svc.handle(Buffer.from('{}'), 's', 'platform');
    expect(onInvoicePaid).toHaveBeenCalledWith(paid);

    svc = new PaymentWebhookService(
      { name: 'stripe', verifyAndParseWebhook: () => failed } as any,
      ledger,
    );
    svc.registerHandlers({ onInvoicePaid, onInvoicePaymentFailed });
    await svc.handle(Buffer.from('{}'), 's', 'platform');
    expect(onInvoicePaymentFailed).toHaveBeenCalledWith(failed);
  });
});

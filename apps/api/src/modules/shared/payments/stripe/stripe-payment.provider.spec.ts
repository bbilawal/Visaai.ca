import { ConfigService } from '@nestjs/config';
import { StripePaymentProvider } from './stripe-payment.provider';

function makeStripe(over: any = {}) {
  return {
    checkout: { sessions: { create: jest.fn() } },
    paymentIntents: { retrieve: jest.fn(), create: jest.fn() },
    customers: { create: jest.fn() },
    refunds: { create: jest.fn() },
    subscriptions: { create: jest.fn(), update: jest.fn(), cancel: jest.fn() },
    invoices: { retrieve: jest.fn() },
    accounts: { create: jest.fn(), createLoginLink: jest.fn() },
    accountLinks: { create: jest.fn() },
    v2: { core: { accounts: { create: jest.fn() } } },
    transfers: { create: jest.fn() },
    balanceTransactions: { list: jest.fn() },
    webhooks: { constructEvent: jest.fn() },
    ...over,
  };
}

const config = new ConfigService({ STRIPE_WEBHOOK_SECRET: 'whsec_platform' });

describe('StripePaymentProvider (wired)', () => {
  it('createCheckoutSession maps Money line items to Stripe price_data and returns url + PI', async () => {
    const stripe = makeStripe();
    stripe.checkout.sessions.create.mockResolvedValue({
      id: 'cs_1',
      url: 'https://checkout.stripe/cs_1',
      payment_intent: 'pi_1',
    });
    const p = new StripePaymentProvider(stripe, config);

    const res = await p.createCheckoutSession({
      mode: 'payment',
      lineItems: [
        {
          name: 'Plan',
          amount: { amountMinor: 2900, currency: 'usd' },
          quantity: 1,
        },
      ],
      metadata: { feature: 'plan' },
      successUrl: 'https://app/ok',
      cancelUrl: 'https://app/no',
    });

    expect(res).toEqual({
      id: 'cs_1',
      url: 'https://checkout.stripe/cs_1',
      paymentIntentId: 'pi_1',
    });
    const arg = stripe.checkout.sessions.create.mock.calls[0][0];
    expect(arg.line_items[0].price_data.unit_amount).toBe(2900);
    expect(arg.line_items[0].price_data.currency).toBe('usd');
    expect(arg.metadata).toEqual({ feature: 'plan' });
  });

  it('verifyAndParseWebhook (platform) maps checkout.session.completed to a normalized event', () => {
    const stripe = makeStripe();
    stripe.webhooks.constructEvent.mockReturnValue({
      id: 'evt_1',
      type: 'checkout.session.completed',
      data: {
        object: {
          payment_intent: 'pi_1',
          amount_total: 2900,
          currency: 'usd',
          metadata: { feature: 'plan', userId: 'u1' },
        },
      },
    });
    const p = new StripePaymentProvider(stripe, config);

    const ev = p.verifyAndParseWebhook(Buffer.from('{}'), 'sig', 'platform');
    expect(stripe.webhooks.constructEvent).toHaveBeenCalledWith(
      Buffer.from('{}'),
      'sig',
      'whsec_platform',
    );
    expect(ev.type).toBe('checkout.completed');
    expect(ev.providerEventId).toBe('evt_1');
    expect(ev.providerObjectId).toBe('pi_1');
    expect(ev.amount).toEqual({ amountMinor: 2900, currency: 'usd' });
    expect(ev.metadata).toEqual({ feature: 'plan', userId: 'u1' });
  });

  it('verifyAndParseWebhook maps account.updated to connect.account.updated', () => {
    const stripe = makeStripe();
    stripe.webhooks.constructEvent.mockReturnValue({
      id: 'evt_2',
      type: 'account.updated',
      data: { object: { id: 'acct_1' } },
    });
    const p = new StripePaymentProvider(stripe, config);
    const ev = p.verifyAndParseWebhook(Buffer.from('{}'), 'sig', 'platform');
    expect(ev.type).toBe('connect.account.updated');
    expect(ev.providerObjectId).toBe('acct_1');
  });

  it('verifyAndParseWebhook maps unknown types to unhandled', () => {
    const stripe = makeStripe();
    stripe.webhooks.constructEvent.mockReturnValue({
      id: 'evt_3',
      type: 'customer.created',
      data: { object: { id: 'cus_1' } },
    });
    const p = new StripePaymentProvider(stripe, config);
    expect(
      p.verifyAndParseWebhook(Buffer.from('{}'), 'sig', 'platform').type,
    ).toBe('unhandled');
  });

  it('invalid signature throws BadRequestException', () => {
    const stripe = makeStripe();
    stripe.webhooks.constructEvent.mockImplementation(() => {
      throw new Error('bad sig');
    });
    const p = new StripePaymentProvider(stripe, config);
    expect(() =>
      p.verifyAndParseWebhook(Buffer.from('{}'), 'sig', 'platform'),
    ).toThrow('Invalid webhook signature');
  });

  it('createConnectAccount creates a v2 recipient account, never the v1 typed account', async () => {
    const stripe = makeStripe();
    stripe.v2.core.accounts.create.mockResolvedValue({ id: 'acct_9' });
    const p = new StripePaymentProvider(stripe, config);
    const res = await p.createConnectAccount({
      country: 'CA',
      email: 'c@x.com',
    });
    expect(res).toEqual({ id: 'acct_9' });
    expect(stripe.v2.core.accounts.create).toHaveBeenCalledWith(
      expect.objectContaining({
        contact_email: 'c@x.com',
        // v2 expects a lowercase ISO-3166-1 alpha-2 code.
        identity: { country: 'ca' },
        dashboard: 'express',
        defaults: {
          responsibilities: {
            fees_collector: 'application',
            losses_collector: 'application',
          },
        },
        configuration: {
          recipient: {
            capabilities: {
              stripe_balance: { stripe_transfers: { requested: true } },
            },
          },
        },
      }),
    );
    // Accounts v1 is rejected outright for new Connect platforms.
    expect(stripe.accounts.create).not.toHaveBeenCalled();
  });

  it('createConnectAccount passes metadata through and defaults country to us', async () => {
    const stripe = makeStripe();
    stripe.v2.core.accounts.create.mockResolvedValue({ id: 'acct_10' });
    const p = new StripePaymentProvider(stripe, config);
    await p.createConnectAccount({
      country: '',
      email: null,
      metadata: { consultant_id: 'c1' },
    });
    const arg = stripe.v2.core.accounts.create.mock.calls[0][0];
    expect(arg.identity).toEqual({ country: 'us' });
    expect(arg.metadata).toEqual({ consultant_id: 'c1' });
    expect(arg).not.toHaveProperty('contact_email');
  });

  it('createTransfer maps Money + passes idempotencyKey as request options', async () => {
    const stripe = makeStripe();
    stripe.transfers.create.mockResolvedValue({ id: 'tr_1' });
    const p = new StripePaymentProvider(stripe, config);
    const res = await p.createTransfer({
      destinationAccountId: 'acct_1',
      amount: { amountMinor: 5000, currency: 'usd' },
      idempotencyKey: 'idem_1',
      metadata: { payoutId: 'po_1' },
    });
    expect(res).toEqual({ id: 'tr_1' });
    expect(stripe.transfers.create).toHaveBeenCalledWith(
      {
        amount: 5000,
        currency: 'usd',
        destination: 'acct_1',
        metadata: { payoutId: 'po_1' },
      },
      { idempotencyKey: 'idem_1' },
    );
  });

  it('listBalanceTransactions maps a page and cursor', async () => {
    const stripe = makeStripe();
    stripe.balanceTransactions.list.mockResolvedValue({
      data: [
        {
          id: 'txn_1',
          source: 'pi_1',
          amount: 2900,
          currency: 'usd',
          type: 'charge',
          created: 1_700_000_000,
        },
      ],
      has_more: true,
    });
    const p = new StripePaymentProvider(stripe, config);
    const page = await p.listBalanceTransactions({
      start: new Date(1_699_000_000_000),
      end: new Date(1_700_000_000_000),
    });
    expect(page.items[0]).toEqual({
      id: 'txn_1',
      providerObjectId: 'pi_1',
      amount: { amountMinor: 2900, currency: 'usd' },
      type: 'charge',
      createdAt: new Date(1_700_000_000 * 1000),
    });
    expect(page.nextCursor).toBe('txn_1');
  });
});

describe('StripePaymentProvider (declared-upfront wrappers)', () => {
  it('createRefund maps to stripe.refunds.create', async () => {
    const stripe: any = makeStripe();
    stripe.refunds.create.mockResolvedValue({
      id: 're_1',
      status: 'succeeded',
      amount: 2900,
      currency: 'usd',
    });
    const p = new StripePaymentProvider(stripe, config);
    const res = await p.createRefund({
      paymentIntentId: 'pi_1',
      amount: { amountMinor: 2900, currency: 'usd' },
    });
    expect(res).toEqual({
      id: 're_1',
      status: 'succeeded',
      amount: { amountMinor: 2900, currency: 'usd' },
    });
    expect(stripe.refunds.create).toHaveBeenCalledWith({
      payment_intent: 'pi_1',
      amount: 2900,
    });
  });

  it('createSubscription maps trialDays and returns normalized result', async () => {
    const stripe: any = makeStripe();
    stripe.subscriptions.create.mockResolvedValue({
      id: 'sub_1',
      status: 'trialing',
      current_period_end: 1_700_000_000,
      cancel_at_period_end: false,
    });
    const p = new StripePaymentProvider(stripe, config);
    const res = await p.createSubscription({
      customerId: 'cus_1',
      priceId: 'price_1',
      trialDays: 14,
    });
    expect(res).toEqual({
      id: 'sub_1',
      status: 'trialing',
      currentPeriodEnd: new Date(1_700_000_000 * 1000),
      cancelAtPeriodEnd: false,
    });
    expect(stripe.subscriptions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        customer: 'cus_1',
        items: [{ price: 'price_1' }],
        trial_period_days: 14,
      }),
    );
  });

  it('ensureCustomer creates a Stripe customer', async () => {
    const stripe: any = makeStripe();
    stripe.customers.create.mockResolvedValue({ id: 'cus_9' });
    const p = new StripePaymentProvider(stripe, config);
    const res = await p.ensureCustomer({ userId: 'u1', email: 'a@b.com' });
    expect(res).toEqual({ id: 'cus_9' });
  });
});

describe('StripePaymentProvider — SP3 tax/invoice/portal/coupon', () => {
  it('createCheckoutSession maps collectTax + createInvoice', async () => {
    const stripe = makeStripe();
    stripe.checkout.sessions.create.mockResolvedValue({
      id: 'cs',
      url: 'https://co/x',
      payment_intent: 'pi',
    });
    const p = new StripePaymentProvider(stripe, config);
    await p.createCheckoutSession({
      mode: 'payment',
      lineItems: [
        {
          name: 'Fee',
          amount: { amountMinor: 34900, currency: 'usd' },
          quantity: 1,
        },
      ],
      metadata: { feature: 'processing_fee' },
      successUrl: 'https://a/ok',
      cancelUrl: 'https://a/no',
      customerId: 'cus_1',
      collectTax: true,
      createInvoice: true,
    });
    const arg = stripe.checkout.sessions.create.mock.calls[0][0];
    expect(arg.automatic_tax).toEqual({ enabled: true });
    expect(arg.billing_address_collection).toBe('required');
    expect(arg.invoice_creation).toEqual({ enabled: true });
    expect(arg.customer).toBe('cus_1');
  });

  it('checkout.completed surfaces tax, discount, invoice id', () => {
    const stripe = makeStripe();
    stripe.webhooks.constructEvent.mockReturnValue({
      id: 'evt_c',
      type: 'checkout.session.completed',
      data: {
        object: {
          payment_intent: 'pi_1',
          amount_total: 30000,
          currency: 'usd',
          invoice: 'in_1',
          total_details: { amount_tax: 2000, amount_discount: 4900 },
          metadata: { feature: 'processing_fee', userId: 'u1' },
        },
      },
    });
    const ev: any = new StripePaymentProvider(
      stripe,
      config,
    ).verifyAndParseWebhook(Buffer.from('{}'), 's', 'platform');
    expect(ev.type).toBe('checkout.completed');
    expect(ev.taxMinor).toBe(2000);
    expect(ev.discountMinor).toBe(4900);
    expect(ev.invoiceId).toBe('in_1');
  });

  it('createBillingPortalSession returns a url', async () => {
    const stripe: any = makeStripe({
      billingPortal: {
        sessions: {
          create: jest.fn().mockResolvedValue({ url: 'https://portal/x' }),
        },
      },
    });
    const p = new StripePaymentProvider(stripe, config);
    expect(
      await p.createBillingPortalSession('cus_1', 'https://a/back'),
    ).toEqual({ url: 'https://portal/x' });
    expect(stripe.billingPortal.sessions.create).toHaveBeenCalledWith({
      customer: 'cus_1',
      return_url: 'https://a/back',
    });
  });

  it('createCoupon mints a percent coupon', async () => {
    const stripe: any = makeStripe({
      coupons: { create: jest.fn().mockResolvedValue({ id: 'co_1' }) },
    });
    const p = new StripePaymentProvider(stripe, config);
    expect(await p.createCoupon({ kind: 'percent', percentOff: 20 })).toEqual({
      id: 'co_1',
    });
    expect(stripe.coupons.create).toHaveBeenCalledWith(
      expect.objectContaining({ percent_off: 20, duration: 'once' }),
    );
  });
});

describe('StripePaymentProvider — SP4 transfers/dashboard', () => {
  it('parses transfer.reversed (providerObjectId = transfer id)', () => {
    const stripe = makeStripe();
    stripe.webhooks.constructEvent.mockReturnValue({
      id: 'evt_tr',
      type: 'transfer.reversed',
      data: { object: { id: 'tr_1', amount: 5000, currency: 'usd' } },
    });
    const ev = new StripePaymentProvider(stripe, config).verifyAndParseWebhook(
      Buffer.from('{}'),
      's',
      'platform',
    );
    expect(ev.type).toBe('transfer.reversed');
    expect(ev.providerObjectId).toBe('tr_1');
    expect(ev.amount).toEqual({ amountMinor: 5000, currency: 'usd' });
  });

  it('createExpressDashboardLink returns a login link', async () => {
    const stripe: any = makeStripe({
      accounts: {
        create: jest.fn(),
        createLoginLink: jest
          .fn()
          .mockResolvedValue({ url: 'https://connect.stripe/express/x' }),
      },
    });
    const p = new StripePaymentProvider(stripe, config);
    expect(await p.createExpressDashboardLink('acct_1')).toEqual({
      url: 'https://connect.stripe/express/x',
    });
    expect(stripe.accounts.createLoginLink).toHaveBeenCalledWith('acct_1');
  });

  it('reverseTransfer creates a transfer reversal', async () => {
    const stripe: any = makeStripe({
      transfers: {
        create: jest.fn(),
        createReversal: jest.fn().mockResolvedValue({ id: 'trr_1' }),
      },
    });
    const p = new StripePaymentProvider(stripe, config);
    expect(await p.reverseTransfer('tr_1')).toEqual({ id: 'trr_1' });
    expect(stripe.transfers.createReversal).toHaveBeenCalledWith('tr_1');
  });
});

describe('StripePaymentProvider — subscriptions', () => {
  it('createSubscriptionCheckoutSession maps mode/subscription_data/trial', async () => {
    const stripe = makeStripe();
    stripe.checkout.sessions.create.mockResolvedValue({
      id: 'cs_s',
      url: 'https://co/s',
      payment_intent: null,
    });
    const p = new StripePaymentProvider(stripe, config);
    const res = await p.createSubscriptionCheckoutSession({
      priceId: 'price_pm',
      trialDays: 14,
      customerId: 'cus_1',
      metadata: { userId: 'u1' },
      successUrl: 'https://a/ok',
      cancelUrl: 'https://a/no',
      clientReferenceId: 'u1',
    });
    expect(res.url).toBe('https://co/s');
    const arg = stripe.checkout.sessions.create.mock.calls[0][0];
    expect(arg.mode).toBe('subscription');
    expect(arg.line_items[0].price).toBe('price_pm');
    expect(arg.subscription_data.trial_period_days).toBe(14);
    expect(arg.customer).toBe('cus_1');
    expect(arg.client_reference_id).toBe('u1');
  });

  it('parses customer.subscription.updated', () => {
    const stripe = makeStripe();
    stripe.webhooks.constructEvent.mockReturnValue({
      id: 'evt_su',
      type: 'customer.subscription.updated',
      data: { object: { id: 'sub_1', status: 'active' } },
    });
    const ev = new StripePaymentProvider(stripe, config).verifyAndParseWebhook(
      Buffer.from('{}'),
      's',
      'platform',
    );
    expect(ev.type).toBe('subscription.updated');
    expect(ev.providerObjectId).toBe('sub_1');
  });

  it('parses invoice.paid (providerObjectId = subscription id)', () => {
    const stripe = makeStripe();
    stripe.webhooks.constructEvent.mockReturnValue({
      id: 'evt_ip',
      type: 'invoice.paid',
      data: {
        object: {
          id: 'in_1',
          subscription: 'sub_1',
          amount_paid: 1500,
          currency: 'usd',
        },
      },
    });
    const ev = new StripePaymentProvider(stripe, config).verifyAndParseWebhook(
      Buffer.from('{}'),
      's',
      'platform',
    );
    expect(ev.type).toBe('invoice.paid');
    expect(ev.providerObjectId).toBe('sub_1');
    expect(ev.amount).toEqual({ amountMinor: 1500, currency: 'usd' });
  });

  it('parses invoice.payment_failed', () => {
    const stripe = makeStripe();
    stripe.webhooks.constructEvent.mockReturnValue({
      id: 'evt_if',
      type: 'invoice.payment_failed',
      data: {
        object: {
          id: 'in_2',
          subscription: 'sub_1',
          amount_due: 1500,
          currency: 'usd',
        },
      },
    });
    const ev = new StripePaymentProvider(stripe, config).verifyAndParseWebhook(
      Buffer.from('{}'),
      's',
      'platform',
    );
    expect(ev.type).toBe('invoice.payment_failed');
    expect(ev.providerObjectId).toBe('sub_1');
  });
});

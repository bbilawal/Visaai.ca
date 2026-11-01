import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import type { Env } from '../../../../config/configuration';
import { money } from '../money';
import { STRIPE_CLIENT } from './stripe.factory';
import type {
  BalanceTxnPage,
  CancelOptions,
  CheckoutSessionInput,
  CheckoutSessionResult,
  ConnectAccountInput,
  ConnectAccountResult,
  CustomerInput,
  CustomerResult,
  DateRange,
  InvoiceResult,
  OnboardingLinkInput,
  PauseOptions,
  PaymentIntentInput,
  PaymentIntentResult,
  PaymentProvider,
  PaymentWebhookEvent,
  RefundInput,
  RefundResult,
  SubscriptionCheckoutInput,
  SubscriptionInput,
  SubscriptionResult,
  SubscriptionUpdateInput,
  ChargeFunding,
  TransferInput,
  TransferResult,
  WebhookKind,
} from '../payment-provider.port';

// `Stripe` is a namespace under nodenext; the client instance type is the
// constructed class value (mirrors payouts.stripe.ts).
type StripeClient = InstanceType<typeof Stripe>;

@Injectable()
export class StripePaymentProvider implements PaymentProvider {
  readonly name = 'stripe';

  constructor(
    @Inject(STRIPE_CLIENT) private readonly stripe: StripeClient,
    private readonly config: ConfigService<Env>,
  ) {}

  async createCheckoutSession(
    input: CheckoutSessionInput,
  ): Promise<CheckoutSessionResult> {
    const session = await this.stripe.checkout.sessions.create({
      mode: input.mode,
      line_items: input.lineItems.map((li) => ({
        price_data: {
          currency: li.amount.currency,
          unit_amount: li.amount.amountMinor,
          product_data: { name: li.name },
        },
        quantity: li.quantity,
      })),
      metadata: input.metadata,
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      ...(input.customerId ? { customer: input.customerId } : {}),
      ...(input.collectTax
        ? {
            automatic_tax: { enabled: true },
            billing_address_collection: 'required' as const,
          }
        : {}),
      ...(input.createInvoice ? { invoice_creation: { enabled: true } } : {}),
    });
    return {
      id: session.id,
      url: session.url as string,
      paymentIntentId: (session.payment_intent as string) ?? null,
    };
  }

  async createSubscriptionCheckoutSession(
    input: SubscriptionCheckoutInput,
  ): Promise<CheckoutSessionResult> {
    const session = await this.stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: input.priceId, quantity: 1 }],
      ...(input.trialDays
        ? { subscription_data: { trial_period_days: input.trialDays } }
        : {}),
      ...(input.customerId ? { customer: input.customerId } : {}),
      ...(input.clientReferenceId
        ? { client_reference_id: input.clientReferenceId }
        : {}),
      metadata: input.metadata,
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
    });
    return {
      id: session.id,
      url: session.url as string,
      paymentIntentId: (session.payment_intent as string) ?? null,
    };
  }

  async retrievePaymentIntent(id: string): Promise<PaymentIntentResult> {
    const pi = await this.stripe.paymentIntents.retrieve(id);
    // `latest_charge` is a bare id unless the caller expanded it; accept both.
    const latest: unknown = (pi as { latest_charge?: unknown }).latest_charge;
    const latestChargeId =
      typeof latest === 'string'
        ? latest
        : ((latest as { id?: string } | null)?.id ?? null);
    return {
      id: pi.id,
      status: pi.status,
      amount: money(pi.amount, pi.currency),
      metadata: pi.metadata ?? {},
      latestChargeId,
    };
  }

  async retrieveChargeFunding(
    paymentIntentId: string,
  ): Promise<ChargeFunding | null> {
    const pi = await this.stripe.paymentIntents.retrieve(paymentIntentId);
    const latest: unknown = (pi as { latest_charge?: unknown }).latest_charge;
    const chargeId =
      typeof latest === 'string'
        ? latest
        : ((latest as { id?: string } | null)?.id ?? null);
    if (!chargeId) return null;

    // Expanded so the settlement currency comes back inline — the charge's own
    // `currency` is what the CUSTOMER was billed, which is the wrong one here.
    const charge = await this.stripe.charges.retrieve(chargeId, {
      expand: ['balance_transaction'],
    });
    const txn = (charge as { balance_transaction?: unknown })
      .balance_transaction as
      | { currency?: string; amount?: number }
      | string
      | null
      | undefined;
    // Unexpanded (a bare id) or absent => the charge has not settled yet.
    if (!txn || typeof txn === 'string') return null;
    if (!txn.currency || typeof txn.amount !== 'number') return null;

    return {
      chargeId,
      settlementCurrency: txn.currency,
      settledAmountMinor: txn.amount,
    };
  }

  async createConnectAccount(
    input: ConnectAccountInput,
  ): Promise<ConnectAccountResult> {
    // Accounts v2. Stripe rejects v1 `accounts.create({type:'express'})` outright
    // for Connect platforms onboarded after the v2 switch, so this is the only
    // creation path — there is no v1 fallback worth keeping.
    //
    // VisaAI is a marketplace on SEPARATE CHARGES AND TRANSFERS: the platform
    // takes the payment via Checkout, then transfers the consultant's share.
    // That fixes the three v2 dimensions:
    //   dashboard        'express' — cobranded, and the only dashboard that
    //                    supports login links (the consultant's 1099 access).
    //   fees_collector   'application' — the platform owns pricing.
    //   losses_collector 'application' — REQUIRED here; Stripe rejects express +
    //                    losses_collector 'stripe', and transfer reversals during
    //                    disputes need platform-owned liability.
    // Only the `recipient` configuration is requested. Asking for `merchant` /
    // card_payments would lengthen onboarding for no benefit — consultants never
    // act as merchant of record.
    const acct = await this.stripe.v2.core.accounts.create({
      ...(input.email ? { contact_email: input.email } : {}),
      identity: { country: (input.country || 'us').toLowerCase() },
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
      ...(input.metadata ? { metadata: input.metadata } : {}),
    });
    return { id: acct.id };
  }

  async createAccountOnboardingLink(
    accountId: string,
    input: OnboardingLinkInput,
  ): Promise<{ url: string }> {
    const link = await this.stripe.accountLinks.create({
      account: accountId,
      refresh_url: input.refreshUrl,
      return_url: input.returnUrl,
      type: 'account_onboarding',
    });
    return { url: link.url };
  }

  async reverseTransfer(transferId: string): Promise<{ id: string }> {
    const reversal = await this.stripe.transfers.createReversal(transferId);
    return { id: reversal.id };
  }

  async createExpressDashboardLink(
    accountId: string,
  ): Promise<{ url: string }> {
    const link = await this.stripe.accounts.createLoginLink(accountId);
    return { url: link.url };
  }

  async createTransfer(input: TransferInput): Promise<TransferResult> {
    const transfer = await this.stripe.transfers.create(
      {
        amount: input.amount.amountMinor,
        currency: input.amount.currency,
        destination: input.destinationAccountId,
        ...(input.sourceTransaction
          ? { source_transaction: input.sourceTransaction }
          : {}),
        ...(input.metadata ? { metadata: input.metadata } : {}),
      },
      input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {},
    );
    return { id: transfer.id };
  }

  verifyAndParseWebhook(
    payload: Buffer,
    signature: string,
    kind: WebhookKind,
  ): PaymentWebhookEvent {
    const secret =
      kind === 'connect'
        ? (this.config.get('STRIPE_CONNECT_WEBHOOK_SECRET', { infer: true }) ??
          this.config.getOrThrow('STRIPE_WEBHOOK_SECRET', { infer: true }))
        : this.config.getOrThrow('STRIPE_WEBHOOK_SECRET', { infer: true });

    let event: ReturnType<StripeClient['webhooks']['constructEvent']>;
    try {
      event = this.stripe.webhooks.constructEvent(payload, signature, secret);
    } catch {
      throw new BadRequestException('Invalid webhook signature');
    }

    const obj = event.data.object as any;
    const base = { providerEventId: event.id, raw: obj };
    const metadata = (obj.metadata as Record<string, string>) ?? {};

    switch (event.type) {
      case 'checkout.session.completed':
        return {
          ...base,
          type: 'checkout.completed',
          providerObjectId: (obj.payment_intent as string) ?? obj.id,
          amount:
            obj.amount_total != null
              ? money(obj.amount_total, obj.currency)
              : null,
          taxMinor: obj.total_details?.amount_tax ?? undefined,
          discountMinor: obj.total_details?.amount_discount ?? undefined,
          invoiceId: (obj.invoice as string) ?? null,
          metadata,
        };
      case 'account.updated':
        return {
          ...base,
          type: 'connect.account.updated',
          providerObjectId: obj.id,
          amount: null,
          metadata,
        };
      case 'transfer.reversed':
        return {
          ...base,
          type: 'transfer.reversed',
          providerObjectId: obj.id,
          amount: obj.amount != null ? money(obj.amount, obj.currency) : null,
          metadata,
        };
      case 'charge.refunded':
      case 'refund.created':
        return {
          ...base,
          type: 'refund.created',
          providerObjectId: obj.payment_intent ?? obj.id,
          amount: money(obj.amount ?? obj.amount_refunded ?? 0, obj.currency),
          metadata,
        };
      case 'charge.dispute.created':
        return {
          ...base,
          type: 'dispute.created',
          providerObjectId: obj.payment_intent ?? obj.charge ?? obj.id,
          amount: money(obj.amount ?? 0, obj.currency),
          metadata,
        };
      case 'payment_intent.succeeded':
        return {
          ...base,
          type: 'payment.succeeded',
          providerObjectId: obj.id,
          amount: money(obj.amount, obj.currency),
          metadata,
        };
      case 'payment_intent.payment_failed':
        return {
          ...base,
          type: 'payment.failed',
          providerObjectId: obj.id,
          amount: obj.amount != null ? money(obj.amount, obj.currency) : null,
          metadata,
        };
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        return {
          ...base,
          type: 'subscription.updated',
          providerObjectId: obj.id,
          amount: null,
          metadata,
        };
      case 'invoice.paid':
        return {
          ...base,
          type: 'invoice.paid',
          providerObjectId: (obj.subscription as string) ?? obj.id,
          amount:
            obj.amount_paid != null
              ? money(obj.amount_paid, obj.currency)
              : null,
          metadata,
        };
      case 'invoice.payment_failed':
        return {
          ...base,
          type: 'invoice.payment_failed',
          providerObjectId: (obj.subscription as string) ?? obj.id,
          amount:
            obj.amount_due != null ? money(obj.amount_due, obj.currency) : null,
          metadata,
        };
      default:
        return {
          ...base,
          type: 'unhandled',
          providerObjectId: obj.id ?? '',
          amount: null,
          metadata,
        };
    }
  }

  async createBillingPortalSession(
    customerId: string,
    returnUrl: string,
  ): Promise<{ url: string }> {
    const session = await this.stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });
    return { url: session.url };
  }

  async createCoupon(input: {
    kind: 'percent' | 'amount';
    percentOff?: number;
    amountOffCents?: number;
    currency?: string;
  }): Promise<{ id: string }> {
    const coupon = await this.stripe.coupons.create({
      duration: 'once',
      ...(input.kind === 'percent'
        ? { percent_off: input.percentOff }
        : {
            amount_off: input.amountOffCents,
            currency: input.currency ?? 'usd',
          }),
    });
    return { id: coupon.id };
  }

  async listBalanceTransactions(
    range: DateRange,
    cursor?: string,
  ): Promise<BalanceTxnPage> {
    const res = await this.stripe.balanceTransactions.list({
      created: {
        gte: Math.floor(range.start.getTime() / 1000),
        lt: Math.floor(range.end.getTime() / 1000),
      },
      limit: 100,
      ...(cursor ? { starting_after: cursor } : {}),
    });
    const items = res.data.map((t) => ({
      id: t.id,
      providerObjectId: (t.source as string) ?? t.id,
      amount: money(t.amount, t.currency),
      type: t.type,
      createdAt: new Date(t.created * 1000),
    }));
    return {
      items,
      nextCursor:
        res.has_more && items.length ? items[items.length - 1].id : null,
    };
  }

  // --- Methods declared upfront; not wired into app flows until SP2/SP3/SP5 ---
  async createPaymentIntent(
    input: PaymentIntentInput,
  ): Promise<PaymentIntentResult> {
    const pi = await this.stripe.paymentIntents.create({
      amount: input.amount.amountMinor,
      currency: input.amount.currency,
      ...(input.customerId ? { customer: input.customerId } : {}),
      ...(input.metadata ? { metadata: input.metadata } : {}),
    });
    return {
      id: pi.id,
      status: pi.status,
      amount: money(pi.amount, pi.currency),
      metadata: pi.metadata ?? {},
    };
  }

  async ensureCustomer(input: CustomerInput): Promise<CustomerResult> {
    const cus = await this.stripe.customers.create({
      email: input.email,
      metadata: { userId: input.userId, ...(input.metadata ?? {}) },
    });
    return { id: cus.id };
  }

  async createRefund(input: RefundInput): Promise<RefundResult> {
    const refund = await this.stripe.refunds.create({
      payment_intent: input.paymentIntentId,
      ...(input.amount ? { amount: input.amount.amountMinor } : {}),
      ...(input.reason ? { reason: input.reason as any } : {}),
      ...(input.metadata ? { metadata: input.metadata } : {}),
    });
    return {
      id: refund.id,
      status: refund.status ?? 'unknown',
      amount: money(refund.amount, refund.currency),
    };
  }

  private mapSubscription(s: any): SubscriptionResult {
    return {
      id: s.id,
      status: s.status,
      currentPeriodEnd: s.current_period_end
        ? new Date(s.current_period_end * 1000)
        : null,
      cancelAtPeriodEnd: !!s.cancel_at_period_end,
    };
  }

  async createSubscription(
    input: SubscriptionInput,
  ): Promise<SubscriptionResult> {
    const s = await this.stripe.subscriptions.create({
      customer: input.customerId,
      items: [{ price: input.priceId }],
      ...(input.trialDays ? { trial_period_days: input.trialDays } : {}),
      ...(input.metadata ? { metadata: input.metadata } : {}),
    });
    return this.mapSubscription(s);
  }

  async updateSubscription(
    id: string,
    input: SubscriptionUpdateInput,
  ): Promise<SubscriptionResult> {
    const s = await this.stripe.subscriptions.update(id, {
      ...(input.priceId ? { items: [{ price: input.priceId }] } : {}),
      ...(input.prorationBehavior
        ? { proration_behavior: input.prorationBehavior }
        : {}),
      ...(input.metadata ? { metadata: input.metadata } : {}),
    });
    return this.mapSubscription(s);
  }

  async cancelSubscription(
    id: string,
    opts?: CancelOptions,
  ): Promise<SubscriptionResult> {
    const s = opts?.atPeriodEnd
      ? await this.stripe.subscriptions.update(id, {
          cancel_at_period_end: true,
        })
      : await this.stripe.subscriptions.cancel(id);
    return this.mapSubscription(s);
  }

  async pauseSubscription(
    id: string,
    _opts?: PauseOptions,
  ): Promise<SubscriptionResult> {
    const s = await this.stripe.subscriptions.update(id, {
      pause_collection: { behavior: 'void' },
    });
    return this.mapSubscription(s);
  }

  async resumeSubscription(id: string): Promise<SubscriptionResult> {
    const s = await this.stripe.subscriptions.update(id, {
      pause_collection: null,
    });
    return this.mapSubscription(s);
  }

  async retrieveInvoice(id: string): Promise<InvoiceResult> {
    const inv = await this.stripe.invoices.retrieve(id);
    return {
      id: inv.id,
      status: inv.status ?? 'unknown',
      amountDue: money(inv.amount_due, inv.currency),
      hostedInvoiceUrl: inv.hosted_invoice_url ?? null,
    };
  }
}

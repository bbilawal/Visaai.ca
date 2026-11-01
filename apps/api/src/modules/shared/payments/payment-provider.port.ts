import type { Money } from './money';

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');

export type WebhookKind = 'platform' | 'connect';
export interface DateRange {
  start: Date;
  end: Date;
}

// --- Checkout (hosted) ---
export interface CheckoutLineItem {
  name: string;
  amount: Money;
  quantity: number;
}
export interface CheckoutSessionInput {
  mode: 'payment';
  lineItems: CheckoutLineItem[];
  metadata: Record<string, string>;
  successUrl: string;
  cancelUrl: string;
  customerId?: string;
  collectTax?: boolean;
  createInvoice?: boolean;
}
export interface CheckoutSessionResult {
  id: string;
  url: string;
  paymentIntentId: string | null;
}

// --- Subscription checkout (hosted, mode:'subscription') ---
export interface SubscriptionCheckoutInput {
  priceId: string;
  customerId?: string;
  trialDays?: number;
  metadata: Record<string, string>;
  successUrl: string;
  cancelUrl: string;
  clientReferenceId?: string;
}

// --- Payment intents ---
export interface PaymentIntentInput {
  amount: Money;
  customerId?: string;
  metadata?: Record<string, string>;
}
export interface PaymentIntentResult {
  id: string;
  status: string;
  amount: Money;
  metadata: Record<string, string>;
  /**
   * The charge the intent settled onto, when it has one. Needed as a transfer's
   * `sourceTransaction` — Stripe keys that to a charge, not to an intent.
   */
  latestChargeId?: string | null;
}

// --- Refunds ---
export interface RefundInput {
  paymentIntentId: string;
  amount?: Money;
  reason?: string;
  metadata?: Record<string, string>;
}
export interface RefundResult {
  id: string;
  status: string;
  amount: Money;
}

// --- Customers ---
export interface CustomerInput {
  userId: string;
  email: string;
  metadata?: Record<string, string>;
}
export interface CustomerResult {
  id: string;
}

// --- Subscriptions ---
export interface SubscriptionInput {
  customerId: string;
  priceId: string;
  trialDays?: number;
  metadata?: Record<string, string>;
}
export interface SubscriptionUpdateInput {
  priceId?: string;
  prorationBehavior?: 'create_prorations' | 'none';
  metadata?: Record<string, string>;
}
export interface CancelOptions {
  atPeriodEnd?: boolean;
}
export interface PauseOptions {
  resumesAt?: Date;
}
export interface SubscriptionResult {
  id: string;
  status: string;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
}

// --- Invoices ---
export interface InvoiceResult {
  id: string;
  status: string;
  amountDue: Money;
  hostedInvoiceUrl: string | null;
}

// --- Connect / payouts ---
export interface ConnectAccountInput {
  // Nullable as well as optional: the payouts gateway forwards a profile email
  // that is genuinely `string | null`, and the provider already treats absent
  // and null alike (it omits `contact_email` entirely).
  email?: string | null;
  country: string;
  metadata?: Record<string, string>;
}
export interface ConnectAccountResult {
  id: string;
}
export interface OnboardingLinkInput {
  refreshUrl: string;
  returnUrl: string;
}
export interface TransferInput {
  destinationAccountId: string;
  amount: Money;
  // Provider-level idempotency key (preserves the payouts transfer contract).
  idempotencyKey?: string;
  metadata?: Record<string, string>;
  /**
   * Charge id this transfer is drawn from. Without it a transfer can only spend
   * the platform's *available* balance, so a payout fails with
   * `balance_insufficient` until the originating charge has settled — days on a
   * platform carrying no float. Keying the transfer to its charge also gives
   * per-charge reconciliation in Stripe's reporting.
   */
  sourceTransaction?: string;
}
export interface TransferResult {
  id: string;
}

/**
 * How a charge actually settled.
 *
 * A transfer using `sourceTransaction` must be denominated in the SETTLEMENT
 * currency — the currency of the charge's balance transaction — not the
 * currency the customer was charged in. A CA platform billing USD settles into
 * CAD, so the two differ and Stripe rejects the mismatch.
 *
 * `settledAmountMinor` is the gross in that settlement currency, which lets a
 * caller convert a USD-denominated obligation without looking up an FX rate:
 * a share of the settled gross is that same share of the original amount, at
 * the exact rate Stripe applied to this charge.
 */
export interface ChargeFunding {
  chargeId: string;
  settlementCurrency: string;
  settledAmountMinor: number;
}

// --- Reconciliation ---
export interface BalanceTxn {
  id: string;
  providerObjectId: string;
  amount: Money;
  type: string;
  createdAt: Date;
}
export interface BalanceTxnPage {
  items: BalanceTxn[];
  nextCursor: string | null;
}

// --- Webhooks ---
interface WebhookBase {
  providerEventId: string;
  providerObjectId: string;
  metadata: Record<string, string>;
  raw: unknown;
}
export type PaymentWebhookEvent =
  | (WebhookBase & {
      type: 'checkout.completed';
      amount: Money | null;
      taxMinor?: number;
      discountMinor?: number;
      invoiceId?: string | null;
    })
  | (WebhookBase & { type: 'payment.succeeded'; amount: Money })
  | (WebhookBase & { type: 'payment.failed'; amount: Money | null })
  | (WebhookBase & { type: 'refund.created'; amount: Money })
  | (WebhookBase & { type: 'dispute.created'; amount: Money })
  | (WebhookBase & { type: 'connect.account.updated'; amount: null })
  | (WebhookBase & { type: 'transfer.reversed'; amount: Money | null })
  | (WebhookBase & { type: 'subscription.updated'; amount: null })
  | (WebhookBase & { type: 'invoice.paid'; amount: Money | null })
  | (WebhookBase & { type: 'invoice.payment_failed'; amount: Money | null })
  | (WebhookBase & { type: 'unhandled'; amount: null });

export interface PaymentProvider {
  readonly name: string;

  // WIRED in SP1
  createCheckoutSession(
    input: CheckoutSessionInput,
  ): Promise<CheckoutSessionResult>;
  // WIRED in SP2 (subscriptions)
  createSubscriptionCheckoutSession(
    input: SubscriptionCheckoutInput,
  ): Promise<CheckoutSessionResult>;
  retrievePaymentIntent(id: string): Promise<PaymentIntentResult>;
  /** How the intent's charge settled; null when it has no settled charge. */
  retrieveChargeFunding(paymentIntentId: string): Promise<ChargeFunding | null>;
  createConnectAccount(
    input: ConnectAccountInput,
  ): Promise<ConnectAccountResult>;
  createAccountOnboardingLink(
    accountId: string,
    input: OnboardingLinkInput,
  ): Promise<{ url: string }>;
  createTransfer(input: TransferInput): Promise<TransferResult>;
  reverseTransfer(transferId: string): Promise<{ id: string }>;
  createExpressDashboardLink(accountId: string): Promise<{ url: string }>;
  verifyAndParseWebhook(
    payload: Buffer,
    signature: string,
    kind: WebhookKind,
  ): PaymentWebhookEvent;
  listBalanceTransactions(
    range: DateRange,
    cursor?: string,
  ): Promise<BalanceTxnPage>;
  // WIRED in SP3 (one-time payments)
  createBillingPortalSession(
    customerId: string,
    returnUrl: string,
  ): Promise<{ url: string }>;
  createCoupon(input: {
    kind: 'percent' | 'amount';
    percentOff?: number;
    amountOffCents?: number;
    currency?: string;
  }): Promise<{ id: string }>;

  // Declared now, wired by later sub-projects (SP2/SP3/SP5)
  createPaymentIntent(input: PaymentIntentInput): Promise<PaymentIntentResult>;
  ensureCustomer(input: CustomerInput): Promise<CustomerResult>;
  createRefund(input: RefundInput): Promise<RefundResult>;
  createSubscription(input: SubscriptionInput): Promise<SubscriptionResult>;
  updateSubscription(
    id: string,
    input: SubscriptionUpdateInput,
  ): Promise<SubscriptionResult>;
  cancelSubscription(
    id: string,
    opts?: CancelOptions,
  ): Promise<SubscriptionResult>;
  pauseSubscription(
    id: string,
    opts?: PauseOptions,
  ): Promise<SubscriptionResult>;
  resumeSubscription(id: string): Promise<SubscriptionResult>;
  retrieveInvoice(id: string): Promise<InvoiceResult>;
}

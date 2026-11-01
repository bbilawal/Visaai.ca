export const FINANCIAL_OPS_REPOSITORY = Symbol('FINANCIAL_OPS_REPOSITORY');

export type ReportDimension = 'country' | 'visa' | 'plan' | 'feature';

export interface PaymentLite {
  id: string;
  stripe_payment_intent_id: string | null;
  amount_cents: number | null;
  status: string;
  feature: string | null;
}

export interface RevenueSummary {
  collectedCents: number;
  refundedCents: number;
  netCents: number;
  count: number;
}

export interface IFinancialOpsRepository {
  getPayment(paymentId: string): Promise<PaymentLite | null>;
  insertRefund(input: {
    paymentId: string;
    stripeRefundId?: string | null;
    amountCents: number;
    reason?: string;
    initiatedBy: string;
  }): Promise<{ id: string }>;
  /** Set the payment refunded by PaymentIntent id; returns the payment id (or null). */
  markRefunded(paymentIntentId: string): Promise<{ paymentId: string | null }>;
  markRefundSucceeded(paymentId: string): Promise<void>;
  /** Resolve a marketplace order + its payout transfer id from a PaymentIntent. */
  findServiceOrderByPI(
    paymentIntentId: string,
  ): Promise<{ id: string; transferId: string | null } | null>;
  /**
   * Move a service order to `status`, and report whether THIS call performed
   * the transition. The boolean is the concurrency guard callers use to run a
   * once-only side effect (see RefundService.onRefundCreated).
   */
  setServiceOrderStatus(id: string, status: string): Promise<boolean>;
  upsertDispute(input: {
    stripeDisputeId: string;
    providerObjectId: string;
    amountCents: number | null;
    currency: string | null;
    reason?: string;
    status: string;
  }): Promise<void>;
  markPaymentDisputed(providerObjectId: string): Promise<void>;
  listDisputes(): Promise<unknown[]>;
  markPaymentFailed(paymentIntentId: string): Promise<void>;
  // Dunning
  listPastDueSubscriptions(): Promise<
    { id: string; stripe_subscription_id: string }[]
  >;
  getDunning(
    subscriptionId: string,
  ): Promise<{ attempts: number; status: string } | null>;
  upsertDunning(subscriptionId: string): Promise<void>;
  incrementDunning(subscriptionId: string): Promise<void>;
  setDunningStatus(subscriptionId: string, status: string): Promise<void>;
  // Reporting
  revenueSummary(fromIso: string, toIso: string): Promise<RevenueSummary>;
  revenueByDimension(
    fromIso: string,
    toIso: string,
    dim: ReportDimension,
  ): Promise<{ key: string; netCents: number }[]>;
}

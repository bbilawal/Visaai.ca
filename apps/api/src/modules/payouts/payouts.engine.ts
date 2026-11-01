/**
 * Payouts engine — pure helpers for the marketplace pay-out loop
 * (VISAAIDocs/features/consultant-marketplace/STRIPE-CONNECT.md §2/§4/§6). No DB, no clock, no
 * Stripe: deterministic functions of their inputs (mirrors commission.engine.ts /
 * matching.engine.ts). The service supplies the snapshots and performs the I/O.
 */
import type { ConsultantEarnings, ConsultantKycStatus } from '@visaai/types';

/** Round to cents, avoiding binary float drift (e.g. 1.005 -> 1.01). */
export function roundCents(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// ---- Onboarding status mapping (PAY-2) -------------------------------

/** Minimal shape of a Stripe Account as delivered on `account.updated`. */
export interface StripeAccountLike {
  id: string;
  details_submitted?: boolean;
  /**
   * Merchant-of-record signal. Meaningless for our recipient-only consultants
   * and explicitly deprecated by Stripe for readiness checks — retained only
   * because the webhook payload still carries it. Do not gate on it.
   */
  charges_enabled?: boolean;
  payouts_enabled?: boolean;
  /** v1 view of the v2 `stripe_balance.stripe_transfers` capability. */
  capabilities?: { transfers?: string } | null;
  requirements?: { disabled_reason?: string | null } | null;
}

/**
 * Map a Stripe connected-account snapshot to our persisted KYC view. We never
 * trust the client — only the webhook-delivered account object drives this.
 *
 * `payouts_enabled` ⇔ the transfers capability is ACTIVE **and** Stripe can pay
 * the account out.
 *
 * The capability is the signal that actually authorises a transfer; Stripe's
 * Connect guidance is explicit that `charges_enabled` / `payouts_enabled` are
 * the wrong readiness check, and `charges_enabled` in particular is meaningless
 * for recipient accounts that are never merchant of record. Gating on it used
 * to silently exclude payable consultants from the sweep.
 *
 * Requiring `payouts_enabled` on top of the capability is a deliberate, stricter-
 * than-Stripe policy choice: we only move money once the consultant can actually
 * withdraw it, so earnings never strand in a balance they cannot reach. The two
 * signals diverge in practice — an account pending identity verification can be
 * `transfers: active` while `payouts_enabled` is still false.
 *
 *   kyc_status: rejected (disabled_reason starts 'rejected') > verified (enabled
 *               + details_submitted) > pending (account exists / onboarding underway)
 */
export function mapAccountStatus(a: StripeAccountLike): {
  kyc_status: ConsultantKycStatus;
  payouts_enabled: boolean;
} {
  const transfersActive = a.capabilities?.transfers === 'active';
  const payoutsEnabled = transfersActive && Boolean(a.payouts_enabled);
  const disabled = a.requirements?.disabled_reason ?? null;

  let kyc_status: ConsultantKycStatus;
  if (disabled && disabled.startsWith('rejected')) {
    kyc_status = 'rejected';
  } else if (payoutsEnabled && a.details_submitted) {
    kyc_status = 'verified';
  } else {
    // Account row exists (we only ever sync after creation) → onboarding pending.
    kyc_status = 'pending';
  }
  return { kyc_status, payouts_enabled: payoutsEnabled };
}

// ---- Sweep grouping (PAY-5) ------------------------------------------

/** A paid, not-yet-swept service order eligible for transfer. */
export interface SweepableOrder {
  service_order_id: string;
  consultant_id: string;
  consultant_payout_usd: number;
  /** Gross charged. Needed to express the payout as a share of the settled amount. */
  amount_usd: number;
  currency: string;
  stripe_connect_account_id: string | null;
  payouts_enabled: boolean;
  /** Pay-in intent, resolved to a charge to fund the transfer. */
  stripe_payment_intent_id: string | null;
}

export interface ConsultantSweepGroup {
  consultant_id: string;
  connect_account_id: string;
  currency: string;
  total_usd: number;
  orders: SweepableOrder[];
}

/**
 * Group paid+unswept orders into one transfer per consultant. Only consultants
 * with payouts enabled and a Connect account, and groups with a positive total,
 * are returned — so an incomplete Connect account never blocks the charge or
 * produces a zero/garbage transfer. Currency is taken from the first order;
 * orders are assumed single-currency per consultant (USD platform default).
 */
export function groupSweepable(
  orders: SweepableOrder[],
): ConsultantSweepGroup[] {
  const byConsultant = new Map<string, SweepableOrder[]>();
  for (const o of orders) {
    if (!o.payouts_enabled || !o.stripe_connect_account_id) continue;
    const list = byConsultant.get(o.consultant_id) ?? [];
    list.push(o);
    byConsultant.set(o.consultant_id, list);
  }

  const groups: ConsultantSweepGroup[] = [];
  for (const [consultant_id, list] of byConsultant) {
    const total_usd = roundCents(
      list.reduce((sum, o) => sum + (o.consultant_payout_usd || 0), 0),
    );
    if (total_usd <= 0) continue;
    groups.push({
      consultant_id,
      connect_account_id: list[0].stripe_connect_account_id as string,
      currency: list[0].currency || 'usd',
      total_usd,
      orders: list,
    });
  }
  return groups;
}

// ---- Settlement-currency conversion ----------------------------------

/**
 * What a transfer should actually move for one order.
 *
 * The ledger owes USD, but a transfer using `source_transaction` must be
 * denominated in the currency the charge SETTLED into — a CA platform billing
 * USD settles to CAD, and Stripe rejects the mismatch outright.
 *
 * The consultant's share of the settled gross is, by definition, that same
 * share of the original amount at the exact rate Stripe applied to this charge.
 * So converting is a ratio, not an FX lookup — no rate table, no drift between
 * what we quote and what Stripe used, and it works for any settlement currency.
 *
 * Falls back to the order's own currency and amount when the charge has not
 * settled (or could not be read), which is the pre-existing available-balance
 * behaviour.
 */
export function settlementTransfer(
  order: { consultant_payout_usd: number; currency: string },
  orderGrossUsd: number,
  funding: {
    settlementCurrency: string;
    settledAmountMinor: number;
  } | null,
): { amountMinor: number; currency: string } {
  const owedMinor = Math.round((order.consultant_payout_usd || 0) * 100);
  if (!funding) {
    return { amountMinor: owedMinor, currency: order.currency || 'usd' };
  }
  // Already the same currency — no conversion, just pay what is owed.
  if (funding.settlementCurrency === (order.currency || 'usd')) {
    return { amountMinor: owedMinor, currency: funding.settlementCurrency };
  }
  // Guard against a zero/absent gross rather than dividing by it.
  if (!orderGrossUsd || orderGrossUsd <= 0) {
    return { amountMinor: owedMinor, currency: order.currency || 'usd' };
  }
  const share = (order.consultant_payout_usd || 0) / orderGrossUsd;
  const amountMinor = Math.round(funding.settledAmountMinor * share);
  return { amountMinor, currency: funding.settlementCurrency };
}

// ---- Earnings (PAY-6) ------------------------------------------------

/** Raw aggregates the repository computes from the ledger. */
export interface EarningsRaw {
  /** Σ consultant_payout_usd over every PAID service order. */
  lifetime_usd: number;
  /** Σ consultant_payout_items.amount_usd already swept into transfers. */
  paid_out_usd: number;
  /** Count of paid service orders. */
  orders_count: number;
}

/** Build the consultant earnings summary; pending = lifetime − paid_out (≥ 0). */
export function computeEarnings(
  consultantId: string,
  raw: EarningsRaw,
  currency = 'usd',
): ConsultantEarnings {
  const lifetime = roundCents(raw.lifetime_usd || 0);
  const paidOut = roundCents(raw.paid_out_usd || 0);
  const pending = Math.max(0, roundCents(lifetime - paidOut));
  return {
    consultant_id: consultantId,
    currency,
    lifetime_usd: lifetime,
    paid_out_usd: paidOut,
    pending_usd: pending,
    orders_count: raw.orders_count || 0,
  };
}

import { Inject, Injectable } from '@nestjs/common';
import { money } from '../shared/payments/money';
import {
  PAYMENT_PROVIDER,
  type ChargeFunding,
  type PaymentProvider,
} from '../shared/payments/payment-provider.port';

export const PAYOUTS_STRIPE = Symbol('PAYOUTS_STRIPE');

/**
 * Narrow port over the Stripe Connect calls payouts needs. Injected behind a
 * token so the service/sweep can be unit-tested with a fake. Now a thin adapter
 * over the shared PaymentProvider — the Stripe SDK lives only in the payments
 * module's StripePaymentProvider.
 */
export interface IPayoutsStripe {
  /** Create an Express connected account with the `transfers` capability. */
  createExpressAccount(params: {
    country: string;
    email?: string | null;
    metadata?: Record<string, string>;
  }): Promise<{ id: string }>;

  /** Hosted onboarding (KYC) link for an account. */
  createAccountLink(params: {
    account: string;
    refreshUrl: string;
    returnUrl: string;
  }): Promise<{ url: string }>;

  /** Transfer funds (cents) from the platform balance to a connected account. */
  createTransfer(params: {
    amountCents: number;
    currency: string;
    destination: string;
    idempotencyKey: string;
    metadata?: Record<string, string>;
    /** Charge to draw from, so the transfer needn't wait for settlement. */
    sourceTransaction?: string;
  }): Promise<{ id: string }>;

  /**
   * How the intent's charge settled — charge id, settlement currency and the
   * gross in that currency. Null when the intent never settled or cannot be
   * read; callers treat null as "transfer from available balance".
   */
  resolveChargeFunding(paymentIntentId: string): Promise<ChargeFunding | null>;

  /** Short-lived link to the consultant's Stripe Express dashboard (1099s, payouts). */
  createExpressDashboardLink(accountId: string): Promise<{ url: string }>;
}

@Injectable()
export class PayoutsStripeGateway implements IPayoutsStripe {
  constructor(
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {}

  createExpressAccount(params: {
    country: string;
    email?: string | null;
    metadata?: Record<string, string>;
  }): Promise<{ id: string }> {
    return this.provider.createConnectAccount({
      country: params.country,
      email: params.email ?? undefined,
      metadata: params.metadata,
    });
  }

  createAccountLink(params: {
    account: string;
    refreshUrl: string;
    returnUrl: string;
  }): Promise<{ url: string }> {
    return this.provider.createAccountOnboardingLink(params.account, {
      refreshUrl: params.refreshUrl,
      returnUrl: params.returnUrl,
    });
  }

  createTransfer(params: {
    amountCents: number;
    currency: string;
    destination: string;
    idempotencyKey: string;
    metadata?: Record<string, string>;
    sourceTransaction?: string;
  }): Promise<{ id: string }> {
    return this.provider.createTransfer({
      destinationAccountId: params.destination,
      amount: money(params.amountCents, params.currency),
      idempotencyKey: params.idempotencyKey,
      metadata: params.metadata,
      sourceTransaction: params.sourceTransaction,
    });
  }

  async resolveChargeFunding(
    paymentIntentId: string,
  ): Promise<ChargeFunding | null> {
    try {
      return await this.provider.retrieveChargeFunding(paymentIntentId);
    } catch {
      // A missing/unreadable intent must not abort the sweep — the transfer
      // simply falls back to drawing on the available balance.
      return null;
    }
  }

  createExpressDashboardLink(accountId: string): Promise<{ url: string }> {
    return this.provider.createExpressDashboardLink(accountId);
  }
}

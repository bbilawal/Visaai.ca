import type { SubPlan, BillingInterval } from './subscription.constants';

export const SUBSCRIPTIONS_REPOSITORY = Symbol('SUBSCRIPTIONS_REPOSITORY');

export type SubscriptionStatus =
  | 'active'
  | 'trialing'
  | 'past_due'
  | 'canceled'
  | 'incomplete';

export interface SubscriptionRow {
  id: string;
  user_id: string;
  stripe_subscription_id: string;
  stripe_customer_id: string;
  plan: SubPlan;
  status: SubscriptionStatus;
  billing_interval: BillingInterval;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
}

export interface UpsertSubscriptionInput {
  userId: string;
  stripeSubscriptionId: string;
  stripeCustomerId: string;
  plan: SubPlan;
  status: SubscriptionStatus;
  billingInterval: BillingInterval;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
}

export interface ISubscriptionsRepository {
  getActiveByUser(userId: string): Promise<SubscriptionRow | null>;
  getByStripeId(stripeSubscriptionId: string): Promise<SubscriptionRow | null>;
  upsertFromStripe(input: UpsertSubscriptionInput): Promise<void>;
  getCurrentCredits(
    subscriptionId: string,
  ): Promise<{ granted: number; consumed: number } | null>;
}

import type {
  SubPlan,
  BillingInterval,
} from '../subscriptions/subscription.constants';

export const BILLING_ANALYTICS_REPOSITORY = Symbol(
  'BILLING_ANALYTICS_REPOSITORY',
);

export interface SubLite {
  plan: SubPlan;
  billing_interval: BillingInterval;
}

export interface IBillingAnalyticsRepository {
  /** Active or trialing subscriptions (plan + interval only). */
  listActiveSubscriptions(): Promise<SubLite[]>;
  /** past_due subscriptions (plan + interval only). */
  listPastDueSubscriptions(): Promise<SubLite[]>;
  /** Refund records, newest first. */
  listRefunds(): Promise<unknown[]>;
}

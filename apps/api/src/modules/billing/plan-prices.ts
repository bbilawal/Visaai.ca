import { PLAN_LABELS, PLAN_PRICE_CENTS, type PlanTier } from '@visaai/types';

/**
 * Per-application plan catalog. Server-resolved — the client never supplies an
 * amount. Charged as inline Stripe `price_data`, so there is no Stripe Price
 * object to keep in step: changing a value here IS the price change.
 *
 * Lives in its own file rather than in billing.service.ts because payouts reads
 * it too (to value an Expert-plan consultant review), and BillingModule already
 * imports PayoutsModule — importing the service back the other way is a module
 * cycle that breaks Nest's DI metadata.
 */
/**
 * Amounts come from @visaai/types so the web app quotes the same number this
 * charges. They were independent literals, and they had drifted: the web toast
 * said Expert Review was $100 while this charged $250.
 */
export const PLAN_PRICES: Record<
  Exclude<PlanTier, 'none'>,
  { amount: number; label: string }
> = {
  self_service: {
    amount: PLAN_PRICE_CENTS.self_service,
    label: `${PLAN_LABELS.self_service} Plan`,
  },
  copilot: {
    amount: PLAN_PRICE_CENTS.copilot,
    label: `${PLAN_LABELS.copilot} Plan`,
  },
  expert: {
    amount: PLAN_PRICE_CENTS.expert,
    label: `${PLAN_LABELS.expert} Plan`,
  },
};

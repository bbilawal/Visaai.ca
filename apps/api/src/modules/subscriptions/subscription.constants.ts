export type SubPlan = 'base' | 'pro' | 'premium';
export type BillingInterval = 'month' | 'year';

export const PLAN_CREDIT_CAP: Record<SubPlan, number> = {
  base: 0,
  pro: 1,
  premium: 2,
};

// Monthly + annual list prices (cents), seeded from doc 06 §2/§3 (base $15/$190,
// pro $49/$490, premium $99/$990). Used for MRR/ARR analytics (SP6). Must match
// the Stripe catalog referenced by SUBSCRIPTION_PRICES.
export const PLAN_MONTHLY_CENTS: Record<SubPlan, number> = {
  base: 1500,
  pro: 4900,
  premium: 9900,
};
export const PLAN_ANNUAL_CENTS: Record<SubPlan, number> = {
  base: 19000,
  pro: 49000,
  premium: 99000,
};

/** Monthly-equivalent revenue (cents) for a subscription line — annual/12. */
export function monthlyEquivCents(
  plan: SubPlan,
  interval: BillingInterval,
): number {
  return interval === 'year'
    ? Math.round(PLAN_ANNUAL_CENTS[plan] / 12)
    : PLAN_MONTHLY_CENTS[plan];
}

// Service types a review credit may cover. Others always pay.
export const CREDIT_ELIGIBLE_SERVICES: readonly string[] = ['premium_review'];

export type PriceCatalog = Record<SubPlan, Record<BillingInterval, string>>;

export function parsePriceCatalog(
  json: string | undefined,
): PriceCatalog | null {
  if (!json) return null;
  try {
    const p = JSON.parse(json);
    for (const plan of ['base', 'pro', 'premium'] as SubPlan[]) {
      if (!p[plan]?.month || !p[plan]?.year) return null;
    }
    return p as PriceCatalog;
  } catch {
    return null;
  }
}

export function resolvePriceId(
  catalog: PriceCatalog,
  plan: SubPlan,
  interval: BillingInterval,
): string {
  return catalog[plan][interval];
}

export function planFromPriceId(
  catalog: PriceCatalog,
  priceId: string,
): { plan: SubPlan; interval: BillingInterval } | null {
  for (const plan of ['base', 'pro', 'premium'] as SubPlan[]) {
    for (const interval of ['month', 'year'] as BillingInterval[]) {
      if (catalog[plan][interval] === priceId) return { plan, interval };
    }
  }
  return null;
}

import type {
  PricingCountryFactor,
  PricingMarketInputs,
  PricingVisaTier,
} from './pricing.engine';

/**
 * Assemble the engine's market inputs from the config row.
 *
 * As of PRICE-2.1 the source values (ai_cost_base / anchor / human_fee) are
 * stored on pricing_visa_tiers (Canada-anchored) rather than hardcoded here.
 * The only logic left is the corridor scaling: Canada is the anchor market
 * (ppp = 1); other countries scale the Canada anchor by PPP, clamped into their
 * configured price band. (`ai_cost_base` will move to the PRICE-10 metered ledger.)
 */
const clamp = (x: number, lo: number, hi: number): number =>
  Math.min(Math.max(x, lo), hi);

export function marketInputsFor(
  v: PricingVisaTier,
  c: PricingCountryFactor,
): PricingMarketInputs {
  const ai_cost_base = v.ai_cost_base_usd;
  const human_fee = v.human_fee_usd * c.ppp_factor;
  const anchor =
    c.country_code === 'CA'
      ? v.base_anchor_usd
      : clamp(
          v.base_anchor_usd * c.ppp_factor,
          c.price_band_min,
          c.price_band_max,
        );
  return { ai_cost_base, anchor, human_fee };
}

/**
 * Dynamic pricing engine — pure implementation of 07-dynamic-pricing-engine §2.
 *
 * `computeQuote` is a pure function of an explicit config snapshot: no DB, no
 * clock, no hidden state (07 §6.2). The repository assembles the snapshot from
 * the pricing_* tables; this file only does the deterministic math.
 *
 * NOTE (schema follow-up): `market` (per-tier ai_cost base, market anchor, and
 * the traditional human_fee) and `constants.lawyer_rate_multiplier` are NOT yet
 * columns on pricing_visa_tiers / pricing_constants. They are sourced from
 * pricing.reference.ts (08 §1/§2 + 06) until an additive migration promotes them
 * to seeded config. See pricing.reference.ts.
 */

export type ComplexityTier = 'low' | 'med' | 'med_high' | 'high';
export type LaborBand = 'low' | 'mid' | 'high' | 'origin';
export type PricingFlag = 'excluded' | 'lawyer_flag' | 'margin_at_risk';

export interface PricingConstants {
  min_margin: number;
  target_margin: number;
  premium_margin: number;
  max_capture: number;
  rework_load: number;
  take_rate: number;
  lawyer_rate_multiplier: number;
}

/** All engine constants live in pricing_constants (incl lawyer_rate_multiplier as of PRICE-2.1). */
export type DbPricingConstants = PricingConstants;

export interface PricingVisaTier {
  visa_type: string;
  complexity_tier: ComplexityTier;
  compressed_review_hours: number;
  lawyer_flag: boolean;
  priceable: boolean;
  // Market inputs (PRICE-2.1): Canada-anchored; non-CA corridors scale by PPP at read time.
  ai_cost_base_usd: number; // 08 §1 per-tier base AI cost
  base_anchor_usd: number; // 08 §2 Canada market anchor
  human_fee_usd: number; // 06 traditional consultant fee (engine ceiling = fee × max_capture)
}

export interface PricingCountryFactor {
  country_code: string;
  labor_band: LaborBand;
  labor_multiplier: number;
  ai_complexity_multiplier: number;
  ppp_factor: number;
  reviewer_rate_usd: number;
  price_band_min: number;
  price_band_max: number;
  priceable: boolean;
}

export interface PricingMarketInputs {
  ai_cost_base: number; // per-tier base AI cost (08 §1), pre country complexity
  anchor: number; // market value price (08 §2 + 02 band)
  human_fee: number; // traditional consultant/lawyer fee (06/02) — sets the ceiling
}

export interface PricingEngineInput {
  constants: PricingConstants;
  visaTier: PricingVisaTier;
  countryFactor: PricingCountryFactor;
  market: PricingMarketInputs;
  demand?: number; // bounded surge [0.9, 1.15]; default 1.0 (no surge in v1)
}

export interface PricingBreakdown {
  ai_cost: number;
  payout: number;
  pay_fee: number;
  anchor: number;
  ppp: number;
  demand: number;
  reviewer_rate: number;
  compressed_hours: number;
}

export interface PricingQuote {
  visa_type: string;
  country_code: string;
  price: number | null; // null when excluded
  band: { floor: number; ceiling: number | null };
  gross_margin: number | null;
  total_cogs: number;
  breakdown: PricingBreakdown;
  flags: PricingFlag[];
  reason?: string;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

// Stripe-class estimate (07 §1): flat + percentage.
const payFee = (price: number): number => 0.3 + 0.029 * price;

function psychBelow(x: number): number {
  // Largest …9 ending <= x (e.g. 305 → 299, 349 → 349).
  const r = Math.round(x);
  return r - (((r % 10) + 1) % 10);
}

function roundPsych(x: number, dir: 'nearest' | 'up' = 'nearest'): number {
  // Snap to a charm (…9) ending (07 §2 round_psych).
  if (x <= 0) return 0;
  const below = psychBelow(x);
  const above = below + 10;
  if (dir === 'up') return below >= x ? below : above;
  return x - below <= above - x ? below : above;
}

export function computeQuote(inp: PricingEngineInput): PricingQuote {
  const { constants: k, visaTier: v, countryFactor: c, market: m } = inp;
  const demand = inp.demand ?? 1.0;

  const reviewer_rate = v.lawyer_flag
    ? c.reviewer_rate_usd * k.lawyer_rate_multiplier
    : c.reviewer_rate_usd;
  const compressed_hours = v.compressed_review_hours;
  const payout = compressed_hours * reviewer_rate * k.rework_load;
  const ai_cost = m.ai_cost_base * c.ai_complexity_multiplier;

  const breakdown: PricingBreakdown = {
    ai_cost: round2(ai_cost),
    payout: round2(payout),
    pay_fee: 0,
    anchor: m.anchor,
    ppp: c.ppp_factor,
    demand,
    reviewer_rate: round2(reviewer_rate),
    compressed_hours,
  };

  // Excluded: refugee/humanitarian or AI-only (non-priceable) corridor (07 §6, 08 §2/§3).
  if (!v.priceable || !c.priceable) {
    return {
      visa_type: v.visa_type,
      country_code: c.country_code,
      price: null,
      band: { floor: 0, ceiling: null },
      gross_margin: null,
      total_cogs: round2(ai_cost + payout),
      breakdown,
      flags: v.lawyer_flag ? ['excluded', 'lawyer_flag'] : ['excluded'],
      reason: !v.priceable
        ? 'visa type excluded from commercial engine'
        : 'country not priceable (AI-only corridor)',
    };
  }

  // pay_fee is price-dependent → floor is too. Use the price as the seed.
  const cogsAt = (price: number): number => ai_cost + payout + payFee(price);
  const floorAt = (price: number): number => cogsAt(price) / (1 - k.min_margin);

  const ceiling = m.human_fee * k.max_capture;
  const flags: PricingFlag[] = [];
  if (v.lawyer_flag) flags.push('lawyer_flag');

  const floorSeed = floorAt(m.anchor);
  let raw: number;
  let dir: 'nearest' | 'up' = 'nearest';
  if (ceiling >= floorSeed) {
    // Valid market band — sit the anchor inside [floor, ceiling].
    raw = Math.min(Math.max(m.anchor, floorSeed), ceiling);
  } else if (m.anchor >= floorSeed) {
    // Common healthy case (07 §4): cost well under 15% of the human fee → bank the anchor.
    raw = m.anchor;
  } else {
    // Anchor cannot clear the cost floor.
    flags.push('margin_at_risk');
    if (v.lawyer_flag) {
      // High/lawyer SKUs price at the thin anchor (08 §2 investor $1799@21%; premium/deferred).
      raw = m.anchor;
    } else {
      // Profit-core tiers hold the floor rather than sell below cost (07 §2 note).
      raw = floorSeed;
      dir = 'up';
    }
  }

  // Corridor (PPP) scaling is resolved upstream in marketInputsFor (anchor + human_fee),
  // so the engine applies only the bounded demand surge here — NOT ppp again (would double-count).
  let recommended = roundPsych(raw * demand, dir);
  // Floor guarantee: a non-lawyer quote must never settle below its (price-dependent) floor.
  if (!v.lawyer_flag) {
    while (recommended < floorAt(recommended))
      recommended = psychBelow(recommended) + 10;
  }

  const total_cogs = cogsAt(recommended);
  const gross_margin = (recommended - total_cogs) / recommended;

  return {
    visa_type: v.visa_type,
    country_code: c.country_code,
    price: recommended,
    band: { floor: round2(floorAt(recommended)), ceiling: round2(ceiling) },
    gross_margin: round2(gross_margin),
    total_cogs: round2(total_cogs),
    breakdown: { ...breakdown, pay_fee: round2(payFee(recommended)) },
    flags,
  };
}

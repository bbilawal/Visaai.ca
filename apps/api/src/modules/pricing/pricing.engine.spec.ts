import { computeQuote } from './pricing.engine';
import type {
  PricingConstants,
  PricingCountryFactor,
  PricingVisaTier,
  PricingMarketInputs,
  PricingEngineInput,
} from './pricing.engine';

/**
 * Pure-engine spec (mirrors assignment.service.spec hand-rolled-fixture style).
 * Numbers anchor to 08-profitability-model §2 (Canada) + 07 §4 worked example.
 * computeQuote is a pure function of an explicit config snapshot — no DB, no clock.
 */

const CONSTANTS: PricingConstants = {
  min_margin: 0.55,
  target_margin: 0.65,
  premium_margin: 0.75,
  max_capture: 0.15,
  rework_load: 1.35,
  take_rate: 0.2,
  lawyer_rate_multiplier: 2.0,
};

const CA: PricingCountryFactor = {
  country_code: 'CA',
  labor_band: 'mid',
  labor_multiplier: 1.0,
  ai_complexity_multiplier: 1.15,
  ppp_factor: 1.0,
  reviewer_rate_usd: 125,
  price_band_min: 150,
  price_band_max: 600,
  priceable: true,
};

const TIERS: Record<string, PricingVisaTier> = {
  work_permit: {
    visa_type: 'work_permit',
    complexity_tier: 'med',
    compressed_review_hours: 0.75,
    lawyer_flag: false,
    priceable: true,
    ai_cost_base_usd: 0.38,
    base_anchor_usd: 349,
    human_fee_usd: 1250,
  },
  visitor: {
    visa_type: 'visitor',
    complexity_tier: 'low',
    compressed_review_hours: 0.25,
    lawyer_flag: false,
    priceable: true,
    ai_cost_base_usd: 0.2,
    base_anchor_usd: 149,
    human_fee_usd: 500,
  },
  investor: {
    visa_type: 'investor',
    complexity_tier: 'high',
    compressed_review_hours: 4.0,
    lawyer_flag: true,
    priceable: true,
    ai_cost_base_usd: 0.55,
    base_anchor_usd: 1799,
    human_fee_usd: 5000,
  },
  refugee_humanitarian: {
    visa_type: 'refugee_humanitarian',
    complexity_tier: 'high',
    compressed_review_hours: 4.0,
    lawyer_flag: true,
    priceable: false,
    ai_cost_base_usd: 0.55,
    base_anchor_usd: 0,
    human_fee_usd: 5000,
  },
};

// Canada-anchored market reference (08 §1 ai cost, §2 anchors, 06 human fee).
const MARKET: Record<string, PricingMarketInputs> = {
  work_permit: { ai_cost_base: 0.38, anchor: 349, human_fee: 1250 },
  visitor: { ai_cost_base: 0.2, anchor: 149, human_fee: 500 },
  investor: { ai_cost_base: 0.55, anchor: 1799, human_fee: 5000 },
  refugee_humanitarian: { ai_cost_base: 0.55, anchor: 0, human_fee: 0 },
};

function input(
  visa: string,
  overrides: Partial<PricingEngineInput> = {},
): PricingEngineInput {
  return {
    constants: CONSTANTS,
    visaTier: TIERS[visa],
    countryFactor: CA,
    market: MARKET[visa],
    demand: 1.0,
    ...overrides,
  };
}

describe('computeQuote — profit-core tiers (08 §2 Canada anchors)', () => {
  it('Canada work-permit → ~$349 @ ~60% margin', () => {
    const q = computeQuote(input('work_permit'));
    expect(q.price).toBe(349);
    expect(q.gross_margin).toBeGreaterThanOrEqual(0.58);
    expect(q.gross_margin).toBeLessThanOrEqual(0.62);
    expect(q.flags).not.toContain('excluded');
    expect(q.breakdown.payout).toBeCloseTo(126.56, 1); // 0.75h × $125 × 1.35
  });

  it('Canada visitor → ~$149 @ ~68% margin', () => {
    const q = computeQuote(input('visitor'));
    expect(q.price).toBe(149);
    expect(q.gross_margin).toBeGreaterThanOrEqual(0.66);
    expect(q.gross_margin).toBeLessThanOrEqual(0.7);
  });
});

describe('computeQuote — high tier (07 §5 / 08 §2)', () => {
  it('investor → lawyer_flag + margin_at_risk + thin margin, priced at anchor', () => {
    const q = computeQuote(input('investor'));
    expect(q.price).toBe(1799);
    expect(q.flags).toContain('lawyer_flag');
    expect(q.flags).toContain('margin_at_risk');
    expect(q.gross_margin).toBeGreaterThanOrEqual(0.18);
    expect(q.gross_margin).toBeLessThanOrEqual(0.28);
  });

  it('refugee/humanitarian → excluded, no price', () => {
    const q = computeQuote(input('refugee_humanitarian'));
    expect(q.price).toBeNull();
    expect(q.flags).toContain('excluded');
    expect(q.gross_margin).toBeNull();
  });
});

describe('computeQuote — guardrails & invariants', () => {
  it('round_psych produces a …9 ending for every priceable quote', () => {
    for (const visa of ['work_permit', 'visitor', 'investor']) {
      const q = computeQuote(input(visa));
      expect(q.price! % 10).toBe(9);
    }
  });

  it('never returns a non-lawyer price below the cost floor', () => {
    // Cheap-origin shape: tiny anchor below the floor, non-lawyer tier → hold the floor + flag.
    const q = computeQuote(
      input('work_permit', {
        market: { ai_cost_base: 0.38, anchor: 120, human_fee: 300 },
      }),
    );
    expect(q.price!).toBeGreaterThanOrEqual(q.band.floor);
    expect(q.flags).toContain('margin_at_risk');
  });

  it('is deterministic given a config snapshot', () => {
    expect(computeQuote(input('work_permit'))).toEqual(
      computeQuote(input('work_permit')),
    );
  });

  it('demand multiplier scales the recommended price (bounded surge)', () => {
    const base = computeQuote(input('work_permit', { demand: 1.0 })).price!;
    const hot = computeQuote(input('work_permit', { demand: 1.15 })).price!;
    expect(hot).toBeGreaterThan(base);
  });

  it('does not re-apply ppp — corridor scaling is resolved upstream in marketInputsFor', () => {
    // The engine receives an already-corridor-resolved anchor/human_fee; ppp_factor on
    // the country row is informational here. Same market inputs ⇒ same price regardless of ppp.
    const p1 = computeQuote(
      input('work_permit', { countryFactor: { ...CA, ppp_factor: 1.0 } }),
    ).price;
    const p2 = computeQuote(
      input('work_permit', { countryFactor: { ...CA, ppp_factor: 1.5 } }),
    ).price;
    expect(p2).toBe(p1);
  });
});

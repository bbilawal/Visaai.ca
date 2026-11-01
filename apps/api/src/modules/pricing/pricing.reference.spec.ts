import { marketInputsFor } from './pricing.reference';
import type { PricingCountryFactor, PricingVisaTier } from './pricing.engine';

const WORK_PERMIT: PricingVisaTier = {
  visa_type: 'work_permit',
  complexity_tier: 'med',
  compressed_review_hours: 0.75,
  lawyer_flag: false,
  priceable: true,
  ai_cost_base_usd: 0.38,
  base_anchor_usd: 349,
  human_fee_usd: 1250,
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

const US: PricingCountryFactor = {
  ...CA,
  country_code: 'US',
  ppp_factor: 1.3,
  reviewer_rate_usd: 197,
  price_band_min: 200,
  price_band_max: 800,
};

describe('marketInputsFor — Canada anchor + PPP scaling', () => {
  it('uses the raw Canada anchor for CA (anchor market, ppp=1)', () => {
    const m = marketInputsFor(WORK_PERMIT, CA);
    expect(m.anchor).toBe(349);
    expect(m.ai_cost_base).toBe(0.38); // med tier (08 §1)
    expect(m.human_fee).toBe(1250); // med tier × ppp 1.0 (06)
  });

  it('scales the Canada anchor by PPP into the destination band for non-CA', () => {
    const m = marketInputsFor(WORK_PERMIT, US);
    expect(m.anchor).toBeCloseTo(349 * 1.3, 5); // 453.7, within US band [200,800]
    expect(m.human_fee).toBeCloseTo(1250 * 1.3, 5);
  });

  it('clamps a scaled anchor that would exceed the country band', () => {
    const tinyBand: PricingCountryFactor = {
      ...US,
      price_band_min: 200,
      price_band_max: 400,
    };
    const m = marketInputsFor(WORK_PERMIT, tinyBand);
    expect(m.anchor).toBe(400); // 453.7 clamped down to band max
  });
});

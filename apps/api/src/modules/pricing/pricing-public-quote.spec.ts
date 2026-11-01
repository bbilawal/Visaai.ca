import { PricingService } from './pricing.service';
import type { IPricingRepository } from './pricing.repository';
import type {
  PricingConstants,
  PricingCountryFactor,
  PricingVisaTier,
} from './pricing.engine';

const DB_CONSTANTS: PricingConstants = {
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

const REFUGEE: PricingVisaTier = {
  visa_type: 'refugee_humanitarian',
  complexity_tier: 'high',
  compressed_review_hours: 4.0,
  lawyer_flag: true,
  priceable: false,
  ai_cost_base_usd: 0.55,
  base_anchor_usd: 0,
  human_fee_usd: 5000,
};

const INVESTOR: PricingVisaTier = {
  ...REFUGEE,
  visa_type: 'investor',
  priceable: true,
  base_anchor_usd: 1799,
};

function makeRepo(
  overrides: Partial<IPricingRepository> = {},
): IPricingRepository {
  const notImpl = (name: string) => () => {
    throw new Error(`unexpected repo call: ${name}`);
  };
  return {
    getConstants: jest.fn().mockResolvedValue(DB_CONSTANTS),
    getVisaTier: notImpl('getVisaTier'),
    getCountryFactor: jest.fn().mockResolvedValue(CA),
    listPriceableVisaTiers: notImpl('listPriceableVisaTiers'),
    listPriceableCountries: notImpl('listPriceableCountries'),
    upsertQuotes: notImpl('upsertQuotes'),
    insertQuoteAudit: notImpl('insertQuoteAudit'),
    getQuote: jest.fn().mockResolvedValue(null),
    listQuotes: notImpl('listQuotes'),
    updateConstant: notImpl('updateConstant'),
    updateVisaTier: notImpl('updateVisaTier'),
    updateCountryFactor: notImpl('updateCountryFactor'),
    ...overrides,
  };
}

describe('PricingService.getPublicQuote', () => {
  it('serves a cache hit as a public payload with NO internal margin/cogs/band', async () => {
    const repo = makeRepo({
      getQuote: jest.fn().mockResolvedValue({
        visa_type: 'work_permit',
        country_code: 'CA',
        recommended_price: 349,
        floor_price: 305,
        ceiling_price: 188,
        gross_margin: 0.61,
        total_cogs: 137,
        breakdown: {},
        flags: [],
      }),
    });
    const q = await new PricingService(repo).getPublicQuote(
      'work_permit',
      'CA',
    );

    expect(q).toMatchObject({
      visa_type: 'work_permit',
      country_code: 'CA',
      price: 349,
      currency: 'USD',
    });
    expect(q).toHaveProperty('gov_fee_note');
    expect(q).not.toHaveProperty('gross_margin');
    expect(q).not.toHaveProperty('total_cogs');
    expect(q).not.toHaveProperty('floor_price');
    expect(q).not.toHaveProperty('band');
  });

  it('returns a clear excluded response for a non-priceable visa (not a 500)', async () => {
    const repo = makeRepo({
      getQuote: jest.fn().mockResolvedValue(null),
      getVisaTier: jest.fn().mockResolvedValue(REFUGEE),
    });
    const q = await new PricingService(repo).getPublicQuote(
      'refugee_humanitarian',
      'CA',
    );
    expect(q).toMatchObject({ excluded: true });
    expect(q).toHaveProperty('reason');
    expect(q).not.toHaveProperty('price');
  });

  it('treats a v1-deferred high-tier (lawyer) quote as excluded for the public', async () => {
    const repo = makeRepo({
      getQuote: jest.fn().mockResolvedValue(null),
      getVisaTier: jest.fn().mockResolvedValue(INVESTOR),
    });
    const q = await new PricingService(repo).getPublicQuote('investor', 'CA');
    expect(q).toMatchObject({ excluded: true });
  });
});

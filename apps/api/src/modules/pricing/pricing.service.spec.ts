import { NotFoundException } from '@nestjs/common';
import { PricingService } from './pricing.service';
import type { IPricingRepository } from './pricing.repository';
import type {
  DbPricingConstants,
  PricingCountryFactor,
  PricingVisaTier,
} from './pricing.engine';

const DB_CONSTANTS: DbPricingConstants = {
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

/** Hand-rolled repo fake (assignment.service.spec style) — unexercised paths throw loud. */
function makeRepo(
  overrides: Partial<IPricingRepository> = {},
): IPricingRepository {
  const notImpl = (name: string) => () => {
    throw new Error(`unexpected repo call: ${name}`);
  };
  return {
    getConstants: jest.fn().mockResolvedValue(DB_CONSTANTS),
    getVisaTier: jest.fn().mockResolvedValue(WORK_PERMIT),
    getCountryFactor: jest.fn().mockResolvedValue(CA),
    listPriceableVisaTiers: notImpl('listPriceableVisaTiers'),
    listPriceableCountries: notImpl('listPriceableCountries'),
    upsertQuotes: notImpl('upsertQuotes'),
    insertQuoteAudit: notImpl('insertQuoteAudit'),
    getQuote: notImpl('getQuote'),
    listQuotes: notImpl('listQuotes'),
    updateConstant: notImpl('updateConstant'),
    updateVisaTier: notImpl('updateVisaTier'),
    updateCountryFactor: notImpl('updateCountryFactor'),
    ...overrides,
  };
}

describe('PricingService.quote', () => {
  it('resolves config from the repo and prices a Canada work-permit at $349', async () => {
    const service = new PricingService(makeRepo());
    const q = await service.quote('work_permit', 'CA');
    expect(q.price).toBe(349);
    expect(q.gross_margin).toBeGreaterThanOrEqual(0.58);
    expect(q.gross_margin).toBeLessThanOrEqual(0.62);
  });

  it('404s on an unknown visa type', async () => {
    const service = new PricingService(
      makeRepo({ getVisaTier: jest.fn().mockResolvedValue(null) }),
    );
    await expect(service.quote('made_up', 'CA')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('404s on an unknown country', async () => {
    const service = new PricingService(
      makeRepo({ getCountryFactor: jest.fn().mockResolvedValue(null) }),
    );
    await expect(service.quote('work_permit', 'ZZ')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

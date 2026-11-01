import { PricingRecomputeService } from './pricing-recompute.service';
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

const VISITOR: PricingVisaTier = {
  visa_type: 'visitor',
  complexity_tier: 'low',
  compressed_review_hours: 0.25,
  lawyer_flag: false,
  priceable: true,
  ai_cost_base_usd: 0.2,
  base_anchor_usd: 149,
  human_fee_usd: 500,
};

// High-tier lawyer SKU: priceable but v1-deferred (07 §5 / roadmap) — must NOT be cached.
const INVESTOR: PricingVisaTier = {
  visa_type: 'investor',
  complexity_tier: 'high',
  compressed_review_hours: 4.0,
  lawyer_flag: true,
  priceable: true,
  ai_cost_base_usd: 0.55,
  base_anchor_usd: 1799,
  human_fee_usd: 5000,
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
    getCountryFactor: notImpl('getCountryFactor'),
    listPriceableVisaTiers: jest
      .fn()
      .mockResolvedValue([WORK_PERMIT, VISITOR, INVESTOR]),
    listPriceableCountries: jest.fn().mockResolvedValue([CA]),
    upsertQuotes: jest.fn().mockResolvedValue(undefined),
    insertQuoteAudit: jest.fn().mockResolvedValue(undefined),
    getQuote: notImpl('getQuote'),
    listQuotes: notImpl('listQuotes'),
    updateConstant: notImpl('updateConstant'),
    updateVisaTier: notImpl('updateVisaTier'),
    updateCountryFactor: notImpl('updateCountryFactor'),
    ...overrides,
  };
}

describe('PricingRecomputeService.recomputeAll', () => {
  it('materializes one quote per priceable visa×country and writes audit rows', async () => {
    const repo = makeRepo();
    const svc = new PricingRecomputeService(repo, new PricingService(repo));

    const res = await svc.recomputeAll();

    // work_permit + visitor materialize; investor (lawyer_flag, v1-deferred) is skipped.
    expect(res.quotes).toBe(2);
    expect(repo.upsertQuotes).toHaveBeenCalledTimes(1);
    const rows = (repo.upsertQuotes as jest.Mock).mock.calls[0][0];
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          visa_type: 'work_permit',
          country_code: 'CA',
          recommended_price: 349,
        }),
        expect.objectContaining({
          visa_type: 'visitor',
          country_code: 'CA',
          recommended_price: 149,
        }),
      ]),
    );
    expect(
      rows.some((r: { visa_type: string }) => r.visa_type === 'investor'),
    ).toBe(false);
    expect(repo.insertQuoteAudit).toHaveBeenCalledTimes(1);
    expect((repo.insertQuoteAudit as jest.Mock).mock.calls[0][0]).toHaveLength(
      2,
    );
    expect(
      (repo.insertQuoteAudit as jest.Mock).mock.calls[0][0][0],
    ).toMatchObject({
      event: 'recompute',
    });
  });

  it('skips excluded (null-price) quotes', async () => {
    const ORIGIN: PricingCountryFactor = {
      ...CA,
      country_code: 'IN',
      priceable: false,
    };
    const repo = makeRepo({
      listPriceableCountries: jest.fn().mockResolvedValue([CA, ORIGIN]),
    });
    const svc = new PricingRecomputeService(repo, new PricingService(repo));

    const res = await svc.recomputeAll();

    // 2 visas × 2 countries computed, but the non-priceable corridor is excluded → 2 written.
    expect(res.quotes).toBe(2);
    const rows = (repo.upsertQuotes as jest.Mock).mock.calls[0][0];
    expect(
      rows.every((r: { country_code: string }) => r.country_code === 'CA'),
    ).toBe(true);
  });
});

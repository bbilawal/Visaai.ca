import { BadRequestException } from '@nestjs/common';
import { PricingService, checkoutBlockReason } from './pricing.service';
import type { IPricingRepository } from './pricing.repository';
import type {
  PricingConstants,
  PricingCountryFactor,
  PricingQuote,
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
const REFUGEE: PricingVisaTier = {
  ...WORK_PERMIT,
  visa_type: 'refugee_humanitarian',
  complexity_tier: 'high',
  lawyer_flag: true,
  priceable: false,
  base_anchor_usd: 0,
};
const INVESTOR: PricingVisaTier = {
  ...REFUGEE,
  visa_type: 'investor',
  priceable: true,
  base_anchor_usd: 1799,
};

function quote(over: Partial<PricingQuote>): PricingQuote {
  return {
    visa_type: 'work_permit',
    country_code: 'CA',
    price: 349,
    band: { floor: 305, ceiling: 188 },
    gross_margin: 0.61,
    total_cogs: 137,
    breakdown: {} as never,
    flags: [],
    ...over,
  };
}

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
    insertQuoteAudit: jest.fn().mockResolvedValue(undefined),
    getQuote: notImpl('getQuote'),
    listQuotes: notImpl('listQuotes'),
    updateConstant: notImpl('updateConstant'),
    updateVisaTier: notImpl('updateVisaTier'),
    updateCountryFactor: notImpl('updateCountryFactor'),
    ...overrides,
  };
}

describe('checkoutBlockReason — the server-side floor gate (pure)', () => {
  it('allows a clean sellable quote', () => {
    expect(checkoutBlockReason(quote({}))).toBeNull();
  });
  it('blocks an excluded (null-price) quote', () => {
    expect(
      checkoutBlockReason(
        quote({ price: null, gross_margin: null, flags: ['excluded'] }),
      ),
    ).toBeTruthy();
  });
  it('blocks a lawyer/high-tier quote (v1-deferred)', () => {
    expect(
      checkoutBlockReason(
        quote({
          price: 1799,
          gross_margin: 0.22,
          flags: ['lawyer_flag', 'margin_at_risk'],
        }),
      ),
    ).toBeTruthy();
  });
  it('blocks any below-floor margin', () => {
    expect(checkoutBlockReason(quote({ gross_margin: 0.4 }))).toBeTruthy();
  });
  it('allows non-lawyer margin_at_risk priced at the floor (== min margin)', () => {
    expect(
      checkoutBlockReason(
        quote({ price: 479, gross_margin: 0.55, flags: ['margin_at_risk'] }),
      ),
    ).toBeNull();
  });
});

describe('PricingService.getCheckoutQuote — gate + audit', () => {
  it('returns a server-priced quote and writes a shown audit row', async () => {
    const repo = makeRepo();
    const q = await new PricingService(repo).getCheckoutQuote(
      'work_permit',
      'CA',
      'u-1',
    );

    expect(q).toMatchObject({ price: 349, currency: 'USD' });
    expect(q).not.toHaveProperty('gross_margin');
    expect(repo.insertQuoteAudit).toHaveBeenCalledTimes(1);
    expect(
      (repo.insertQuoteAudit as jest.Mock).mock.calls[0][0][0],
    ).toMatchObject({
      visa_type: 'work_permit',
      country_code: 'CA',
      recommended_price: 349,
      event: 'shown',
      shown_to_user: 'u-1',
    });
  });

  it('blocks an excluded visa with a BadRequest and writes no audit', async () => {
    const repo = makeRepo({
      getVisaTier: jest.fn().mockResolvedValue(REFUGEE),
    });
    await expect(
      new PricingService(repo).getCheckoutQuote(
        'refugee_humanitarian',
        'CA',
        'u-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.insertQuoteAudit).not.toHaveBeenCalled();
  });

  it('blocks a high-tier lawyer SKU at checkout', async () => {
    const repo = makeRepo({
      getVisaTier: jest.fn().mockResolvedValue(INVESTOR),
    });
    await expect(
      new PricingService(repo).getCheckoutQuote('investor', 'CA', 'u-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.insertQuoteAudit).not.toHaveBeenCalled();
  });
});

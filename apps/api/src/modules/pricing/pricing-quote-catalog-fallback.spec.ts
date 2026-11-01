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

const GB: PricingCountryFactor = { ...CA, country_code: 'GB' };

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

// Priceable but v1-deferred: never part of the sellable catalog.
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
    listPriceableCountries: jest.fn().mockResolvedValue([CA, GB]),
    upsertQuotes: notImpl('upsertQuotes'),
    insertQuoteAudit: notImpl('insertQuoteAudit'),
    getQuote: notImpl('getQuote'),
    listQuotes: jest.fn().mockResolvedValue([]),
    updateConstant: notImpl('updateConstant'),
    updateVisaTier: notImpl('updateVisaTier'),
    updateCountryFactor: notImpl('updateCountryFactor'),
    ...overrides,
  };
}

describe('PricingService.listPublicQuotes — empty-cache fallback', () => {
  it('serves the materialized cache verbatim when it is populated', async () => {
    const listPriceableVisaTiers = jest.fn();
    const repo = makeRepo({
      listQuotes: jest.fn().mockResolvedValue([
        {
          visa_type: 'work_permit',
          country_code: 'CA',
          recommended_price: 349,
          floor_price: 305,
          ceiling_price: 600,
          gross_margin: 0.61,
          total_cogs: 137,
          breakdown: {},
          flags: [],
        },
      ]),
      listPriceableVisaTiers,
    });

    const quotes = await new PricingService(repo).listPublicQuotes();

    expect(quotes).toEqual([
      expect.objectContaining({
        visa_type: 'work_permit',
        country_code: 'CA',
        price: 349,
        currency: 'USD',
      }),
    ]);
    // No recompute when the cache can answer.
    expect(listPriceableVisaTiers).not.toHaveBeenCalled();
  });

  it('computes the catalog on demand when pricing_quotes is empty', async () => {
    const quotes = await new PricingService(makeRepo()).listPublicQuotes();

    // 2 sellable visas x 2 countries; the lawyer SKU is excluded.
    expect(quotes).toHaveLength(4);
    expect(quotes.map((q) => q.visa_type)).not.toContain('investor');
    for (const q of quotes) {
      expect(q.price).toBeGreaterThan(0);
      expect(q.currency).toBe('USD');
      expect(q).toHaveProperty('gov_fee_note');
    }
  });

  it('never leaks internal economics through the fallback', async () => {
    const [q] = await new PricingService(makeRepo()).listPublicQuotes();

    expect(q).not.toHaveProperty('gross_margin');
    expect(q).not.toHaveProperty('total_cogs');
    expect(q).not.toHaveProperty('floor_price');
    expect(q).not.toHaveProperty('breakdown');
    expect(q).not.toHaveProperty('band');
  });

  it('stays a read-only path — the fallback writes nothing', async () => {
    const upsertQuotes = jest.fn();
    const insertQuoteAudit = jest.fn();
    await new PricingService(
      makeRepo({ upsertQuotes, insertQuoteAudit }),
    ).listPublicQuotes();

    expect(upsertQuotes).not.toHaveBeenCalled();
    expect(insertQuoteAudit).not.toHaveBeenCalled();
  });

  it('returns an empty list rather than throwing when there is nothing sellable', async () => {
    const repo = makeRepo({
      listPriceableVisaTiers: jest.fn().mockResolvedValue([INVESTOR]),
    });

    await expect(new PricingService(repo).listPublicQuotes()).resolves.toEqual(
      [],
    );
  });
});

import { PricingService } from './pricing.service';
import type { IPricingRepository } from './pricing.repository';
import type {
  DbPricingConstants,
  PricingCountryFactor,
  PricingVisaTier,
} from './pricing.engine';
import { AnalyticsEventBus } from '../analytics/analytics-event-bus';
import type { AnalyticsEvent } from '../analytics/events/catalog';

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

/** Hand-rolled repo fake (pricing.service.spec.ts template). */
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

describe('PricingService — quote.generated only on purchase paths', () => {
  it('getCheckoutQuote emits quote.generated ONCE with the authed user_id + non-PII props', async () => {
    const analytics = new AnalyticsEventBus();
    const events: AnalyticsEvent[] = [];
    analytics.events$.subscribe((e) => events.push(e));

    const repo = makeRepo({
      // checkout recomputes via quote(), then writes a 'shown' audit row.
      insertQuoteAudit: jest.fn().mockResolvedValue(undefined),
    });
    const service = new PricingService(repo, analytics);
    const result = await service.getCheckoutQuote(
      'work_permit',
      'CA',
      'user-1',
    );

    expect(result.price).toBe(349);
    const quoteEvents = events.filter((e) => e.name === 'quote.generated');
    expect(quoteEvents).toHaveLength(1);
    expect(quoteEvents[0]).toMatchObject({
      name: 'quote.generated',
      user_id: 'user-1',
      application_id: null,
      props: { country: 'CA', visa_type: 'work_permit', amount_cents: 34900 },
    });
    // No margin/cogs/breakdown leaked into analytics props.
    expect(Object.keys(quoteEvents[0].props)).toEqual([
      'country',
      'visa_type',
      'amount_cents',
    ]);
  });

  it('quoteForDiscount emits quote.generated once (user_id null on this path)', async () => {
    const analytics = new AnalyticsEventBus();
    const events: AnalyticsEvent[] = [];
    analytics.events$.subscribe((e) => events.push(e));

    const service = new PricingService(makeRepo(), analytics);
    await service.quoteForDiscount('work_permit', 'CA');

    const quoteEvents = events.filter((e) => e.name === 'quote.generated');
    expect(quoteEvents).toHaveLength(1);
    expect(quoteEvents[0]).toMatchObject({
      name: 'quote.generated',
      user_id: null,
      props: { country: 'CA', visa_type: 'work_permit', amount_cents: 34900 },
    });
  });

  it('getPublicQuote does NOT emit on the cache-miss compute path (public price peek)', async () => {
    const analytics = new AnalyticsEventBus();
    const events: AnalyticsEvent[] = [];
    analytics.events$.subscribe((e) => events.push(e));

    // Cache miss -> getPublicQuote falls through to quote() to classify/price.
    const repo = makeRepo({ getQuote: jest.fn().mockResolvedValue(null) });
    const service = new PricingService(repo, analytics);
    const result = await service.getPublicQuote('work_permit', 'CA');

    expect(result).toMatchObject({ visa_type: 'work_permit', price: 349 });
    expect(events.filter((e) => e.name === 'quote.generated')).toHaveLength(0);
  });

  it('the bare quote() compute does NOT emit (shared read-safe path)', async () => {
    const analytics = new AnalyticsEventBus();
    const events: AnalyticsEvent[] = [];
    analytics.events$.subscribe((e) => events.push(e));

    const service = new PricingService(makeRepo(), analytics);
    const q = await service.quote('work_permit', 'CA');

    expect(q.price).toBe(349);
    expect(events.filter((e) => e.name === 'quote.generated')).toHaveLength(0);
  });

  it('does not throw when the analytics bus is omitted (Optional-safety)', async () => {
    const repo = makeRepo({
      insertQuoteAudit: jest.fn().mockResolvedValue(undefined),
    });
    const service = new PricingService(repo);
    await expect(
      service.getCheckoutQuote('work_permit', 'CA', 'user-1'),
    ).resolves.toEqual(expect.objectContaining({ price: 349 }));
  });
});

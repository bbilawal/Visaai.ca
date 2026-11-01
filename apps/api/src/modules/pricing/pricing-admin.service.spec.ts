import { PricingAdminService } from './pricing-admin.service';
import type { IPricingRepository } from './pricing.repository';
import type { PricingRecomputeService } from './pricing-recompute.service';

function makeRepo(
  overrides: Partial<IPricingRepository> = {},
): IPricingRepository {
  const notImpl = (name: string) => () => {
    throw new Error(`unexpected repo call: ${name}`);
  };
  return {
    getConstants: notImpl('getConstants'),
    getVisaTier: notImpl('getVisaTier'),
    getCountryFactor: notImpl('getCountryFactor'),
    listPriceableVisaTiers: notImpl('listPriceableVisaTiers'),
    listPriceableCountries: notImpl('listPriceableCountries'),
    upsertQuotes: notImpl('upsertQuotes'),
    insertQuoteAudit: notImpl('insertQuoteAudit'),
    getQuote: notImpl('getQuote'),
    listQuotes: notImpl('listQuotes'),
    updateConstant: jest.fn().mockResolvedValue(undefined),
    updateVisaTier: jest.fn().mockResolvedValue(undefined),
    updateCountryFactor: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeRecompute() {
  return {
    recomputeAll: jest.fn().mockResolvedValue({ computed: 182, quotes: 140 }),
  } as unknown as PricingRecomputeService;
}

describe('PricingAdminService — config edits trigger recompute', () => {
  it('updateConstant writes the value then rebuilds the quote cache', async () => {
    const repo = makeRepo();
    const recompute = makeRecompute();
    const svc = new PricingAdminService(repo, recompute);

    const res = await svc.updateConstant('min_margin', 0.6);

    expect(repo.updateConstant).toHaveBeenCalledWith('min_margin', 0.6);
    expect(recompute.recomputeAll).toHaveBeenCalledTimes(1);
    expect(res).toMatchObject({ recomputed: 140 });
  });

  it('updateVisaTier patches the row then recomputes', async () => {
    const repo = makeRepo();
    const recompute = makeRecompute();
    const svc = new PricingAdminService(repo, recompute);

    await svc.updateVisaTier('work_permit', { base_anchor_usd: 399 });

    expect(repo.updateVisaTier).toHaveBeenCalledWith('work_permit', {
      base_anchor_usd: 399,
    });
    expect(recompute.recomputeAll).toHaveBeenCalledTimes(1);
  });

  it('updateCountryFactor patches the row then recomputes', async () => {
    const repo = makeRepo();
    const recompute = makeRecompute();
    const svc = new PricingAdminService(repo, recompute);

    await svc.updateCountryFactor('US', { ppp_factor: 1.35 });

    expect(repo.updateCountryFactor).toHaveBeenCalledWith('US', {
      ppp_factor: 1.35,
    });
    expect(recompute.recomputeAll).toHaveBeenCalledTimes(1);
  });
});

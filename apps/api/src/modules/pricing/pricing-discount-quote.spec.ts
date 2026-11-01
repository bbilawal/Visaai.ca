import { PricingService } from './pricing.service';

function makeRepo(over: any = {}) {
  return {
    getConstants: jest.fn().mockResolvedValue({
      min_margin: 0.55,
      target_margin: 0.7,
      premium_margin: 0.8,
    }),
    getVisaTier: jest.fn(),
    getCountryFactor: jest.fn(),
    getQuote: jest.fn(),
    insertQuoteAudit: jest.fn(),
    listQuotes: jest.fn(),
    ...over,
  };
}

describe('PricingService.quoteForDiscount', () => {
  it('returns list cents, cogs cents, and min margin', async () => {
    const svc = new PricingService(makeRepo());
    jest.spyOn(svc, 'quote').mockResolvedValue({
      price: 349,
      total_cogs: 138,
      gross_margin: 0.6,
      flags: [],
    } as any);
    const r = await svc.quoteForDiscount('trv', 'CA');
    expect(r).toEqual({ listCents: 34900, cogsCents: 13800, minMargin: 0.55 });
  });

  it('throws when the corridor is not sellable', async () => {
    const svc = new PricingService(makeRepo());
    jest.spyOn(svc, 'quote').mockResolvedValue({
      price: null,
      total_cogs: 100,
      gross_margin: null,
      flags: ['excluded'],
    } as any);
    await expect(svc.quoteForDiscount('x', 'CA')).rejects.toThrow();
  });
});

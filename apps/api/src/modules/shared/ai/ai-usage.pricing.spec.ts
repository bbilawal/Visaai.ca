import { priceUsage } from './ai-usage.pricing';

describe('priceUsage — per-model cost from 04 §1 rates', () => {
  it('prices gpt-4o token usage (2.50 in / 10.00 out per 1M)', () => {
    // (1000×2.50 + 500×10.00) / 1e6 = 0.0075
    expect(priceUsage('gpt-4o', 1000, 500)).toBeCloseTo(0.0075, 6);
  });

  it('prices gpt-4o-mini far cheaper (0.15 / 0.60)', () => {
    // (1000×0.15 + 500×0.60) / 1e6 = 0.00045
    expect(priceUsage('gpt-4o-mini', 1000, 500)).toBeCloseTo(0.00045, 6);
  });

  it('prices per-page OCR vendors by units, not tokens', () => {
    expect(priceUsage('azure-di', 0, 0, 5)).toBeCloseTo(5 * 0.0015, 6);
  });

  it('returns 0 for an unknown model (never throws — metering must not break calls)', () => {
    expect(priceUsage('mystery-model', 1000, 1000)).toBe(0);
  });
});

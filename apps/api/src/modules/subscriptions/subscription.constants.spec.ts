import { SUB_PLAN_RANK } from '../entitlement/entitlement.service';
import {
  PLAN_CREDIT_CAP,
  parsePriceCatalog,
  resolvePriceId,
  planFromPriceId,
} from './subscription.constants';

const json = JSON.stringify({
  base: { month: 'price_bm', year: 'price_by' },
  pro: { month: 'price_pm', year: 'price_py' },
  premium: { month: 'price_prm', year: 'price_pry' },
});

describe('subscription.constants', () => {
  it('caps match the frozen contract', () => {
    expect(PLAN_CREDIT_CAP).toEqual({ base: 0, pro: 1, premium: 2 });
  });

  // ARCH-003: SUB_PLAN_RANK moved to entitlement.service (its only consumer).
  // The frozen value is still asserted, from its new home.
  it('a subscription still grants exactly copilot rank', () => {
    expect(SUB_PLAN_RANK).toBe(2);
  });

  it('parses + resolves a price id', () => {
    const cat = parsePriceCatalog(json)!;
    expect(resolvePriceId(cat, 'pro', 'year')).toBe('price_py');
  });

  it('reverse-maps a price id to plan+interval', () => {
    const cat = parsePriceCatalog(json)!;
    expect(planFromPriceId(cat, 'price_prm')).toEqual({
      plan: 'premium',
      interval: 'month',
    });
    expect(planFromPriceId(cat, 'price_unknown')).toBeNull();
  });

  it('parsePriceCatalog returns null on missing/invalid json', () => {
    expect(parsePriceCatalog(undefined)).toBeNull();
    expect(parsePriceCatalog('not json')).toBeNull();
  });
});

import { ADDON_PRICES, type AddonSku } from './addon.constants';

describe('addon.constants', () => {
  it('defines flat cent prices for each SKU', () => {
    expect(ADDON_PRICES.addon_document_review.amount).toBe(7900);
    expect(ADDON_PRICES.addon_rush_sla.amount).toBe(9900);
    expect(ADDON_PRICES.addon_premium_upgrade.amount).toBe(30000);
  });
  it('every SKU has a label', () => {
    (Object.keys(ADDON_PRICES) as AddonSku[]).forEach((k) =>
      expect(ADDON_PRICES[k].label.length).toBeGreaterThan(0),
    );
  });
});

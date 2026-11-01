import { BadRequestException } from '@nestjs/common';
import { DiscountService } from './discount.service';

function makePricing(listCents: number, cogsCents: number, minMargin = 0.55) {
  return {
    quoteForDiscount: jest
      .fn()
      .mockResolvedValue({ listCents, cogsCents, minMargin }),
  } as any;
}
function makeRepo(coupon: any) {
  return {
    getActiveByCode: jest.fn().mockResolvedValue(coupon),
    insertRedemption: jest.fn().mockResolvedValue({ id: 'red_1' }),
  } as any;
}
const percent = (n: number, over: any = {}) => ({
  id: 'c1',
  code: 'X',
  kind: 'percent',
  percent_off: n,
  amount_off_cents: null,
  applies_to: 'processing_fee',
  max_redemptions: null,
  redeemed_count: 0,
  valid_from: '2000-01-01',
  valid_until: null,
  active: true,
  ...over,
});
const base = {
  visaType: 'trv',
  country: 'CA',
  code: 'X',
  userId: 'u1',
  applicationId: 'a1',
  feature: 'processing_fee' as const,
};

describe('DiscountService.applyDiscount', () => {
  it('accepts a discount that stays above the floor', async () => {
    const repo = makeRepo(percent(10));
    const svc = new DiscountService(makePricing(34900, 13800), repo);
    const r = await svc.applyDiscount(base);
    expect(r.discountedCents).toBe(31410);
    expect(repo.insertRedemption).toHaveBeenCalledWith(
      expect.objectContaining({ floorOk: true }),
    );
  });

  it('rejects a discount that breaches the 55% floor (FAMILY20 worked example)', async () => {
    const svc = new DiscountService(
      makePricing(34900, 13800),
      makeRepo(percent(20)),
    );
    await expect(svc.applyDiscount(base)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects an unknown/expired/inactive code', async () => {
    const svc = new DiscountService(makePricing(34900, 13800), makeRepo(null));
    await expect(svc.applyDiscount(base)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects when max_redemptions reached', async () => {
    const svc = new DiscountService(
      makePricing(34900, 13800),
      makeRepo(percent(5, { max_redemptions: 10, redeemed_count: 10 })),
    );
    await expect(svc.applyDiscount(base)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects when applies_to does not match the feature', async () => {
    const svc = new DiscountService(
      makePricing(34900, 13800),
      makeRepo(percent(5, { applies_to: 'subscription' })),
    );
    await expect(svc.applyDiscount(base)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('addon feature uses override list + zero cogs (flat-priced)', async () => {
    const repo = makeRepo(percent(10, { applies_to: 'addon' }));
    const svc = new DiscountService(makePricing(0, 0), repo);
    const r = await svc.applyDiscount({
      ...base,
      feature: 'addon',
      listCentsOverride: 7900,
      cogsCentsOverride: 0,
    });
    expect(r.discountedCents).toBe(7110);
  });
});

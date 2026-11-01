import { BadRequestException } from '@nestjs/common';
import { DiscountService } from '../src/modules/discounts/discount.service';

// Guardrail is the crux: prove a below-floor coupon is rejected and an above-floor one is accepted + ledgered.
describe('one-time payments — discount guardrail (e2e)', () => {
  function repo(coupon: any) {
    const redemptions: any[] = [];
    return {
      redemptions,
      getActiveByCode: async () => coupon,
      insertRedemption: async (r: any) => {
        redemptions.push(r);
        return { id: 'red_' + redemptions.length };
      },
    } as any;
  }
  const pricing = {
    quoteForDiscount: async () => ({
      listCents: 34900,
      cogsCents: 13800,
      minMargin: 0.55,
    }),
  } as any;
  const coupon = (pct: number) => ({
    id: 'c1',
    code: 'X',
    kind: 'percent',
    percent_off: pct,
    amount_off_cents: null,
    applies_to: 'processing_fee',
    max_redemptions: null,
    redeemed_count: 0,
    valid_from: '2000-01-01',
    valid_until: null,
    active: true,
  });
  const args = {
    visaType: 'trv',
    country: 'CA',
    code: 'X',
    userId: 'u1',
    applicationId: 'a1',
    feature: 'processing_fee' as const,
  };

  it('accepts 10% (margin 56%) and writes a floor_ok ledger row', async () => {
    const r = repo(coupon(10));
    const svc = new DiscountService(pricing, r);
    const out = await svc.applyDiscount(args);
    expect(out.discountedCents).toBe(31410);
    expect(r.redemptions[0].floorOk).toBe(true);
  });

  it('rejects 20% (margin 50.6% < 55%) — nothing charged, no ledger row', async () => {
    const r = repo(coupon(20));
    const svc = new DiscountService(pricing, r);
    await expect(svc.applyDiscount(args)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(r.redemptions).toHaveLength(0);
  });
});

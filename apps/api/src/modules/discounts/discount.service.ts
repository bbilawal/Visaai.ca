import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { PricingService } from '../pricing/pricing.service';
import {
  DISCOUNTS_REPOSITORY,
  type CouponRow,
  type IDiscountsRepository,
} from './discounts.repository';

@Injectable()
export class DiscountService {
  constructor(
    private readonly pricing: PricingService,
    @Inject(DISCOUNTS_REPOSITORY) private readonly repo: IDiscountsRepository,
  ) {}

  async applyDiscount(input: {
    visaType: string;
    country: string;
    code: string;
    userId: string;
    applicationId: string | null;
    feature: 'processing_fee' | 'addon';
    listCentsOverride?: number;
    cogsCentsOverride?: number;
  }): Promise<{
    discountedCents: number;
    couponId: string;
    redemptionId: string;
    discountCents: number;
    listCents: number;
  }> {
    // 1. List price + COGS + floor. Add-ons pass overrides (flat, cogs 0).
    let listCents: number;
    let cogsCents: number;
    let minMargin: number;
    if (input.feature === 'addon') {
      listCents = input.listCentsOverride ?? 0;
      cogsCents = input.cogsCentsOverride ?? 0;
      minMargin = 0; // flat-priced add-on: any positive charge clears the (n/a) floor
    } else {
      const q = await this.pricing.quoteForDiscount(
        input.visaType,
        input.country,
      );
      listCents = q.listCents;
      cogsCents = q.cogsCents;
      minMargin = q.minMargin;
    }

    // 2. Coupon validity.
    const coupon = await this.repo.getActiveByCode(input.code);
    this.assertValid(coupon, input.feature);
    const c = coupon as CouponRow;

    // 3. Discount amount.
    const discountCents =
      c.kind === 'percent'
        ? Math.round((listCents * (c.percent_off as number)) / 100)
        : (c.amount_off_cents as number);
    const discountedCents = Math.max(0, listCents - discountCents);

    // 4. HARD GUARDRAIL — recompute margin on the discounted price.
    if (discountedCents <= cogsCents) {
      throw new BadRequestException('Discount would sell below cost');
    }
    const marginPrime = (discountedCents - cogsCents) / discountedCents;
    if (marginPrime < minMargin) {
      throw new BadRequestException('Discount would breach the margin floor');
    }

    // 5. Ledger row (payment linked later on success).
    const { id: redemptionId } = await this.repo.insertRedemption({
      couponId: c.id,
      userId: input.userId,
      applicationId: input.applicationId,
      listPriceCents: listCents,
      discountCents,
      chargedPriceCents: discountedCents,
      resultingMargin: Number(marginPrime.toFixed(4)),
      floorOk: true,
    });

    return {
      discountedCents,
      couponId: c.id,
      redemptionId,
      discountCents,
      listCents,
    };
  }

  /** Atomic redemption counter bump on payment success (max_redemptions guard). */
  async redeem(couponId: string): Promise<boolean> {
    return this.repo.redeem(couponId);
  }

  /** Link a redemption ledger row to the resulting payment. */
  async linkRedemptionPayment(
    redemptionId: string,
    paymentId: string,
  ): Promise<void> {
    return this.repo.linkRedemptionPayment(redemptionId, paymentId);
  }

  private assertValid(
    coupon: CouponRow | null,
    feature: 'processing_fee' | 'addon',
  ): void {
    if (!coupon || !coupon.active)
      throw new BadRequestException('Invalid coupon code');
    const now = Date.now();
    if (coupon.valid_from && new Date(coupon.valid_from).getTime() > now) {
      throw new BadRequestException('Coupon not yet valid');
    }
    if (coupon.valid_until && new Date(coupon.valid_until).getTime() < now) {
      throw new BadRequestException('Coupon expired');
    }
    if (
      coupon.max_redemptions !== null &&
      coupon.redeemed_count >= coupon.max_redemptions
    ) {
      throw new BadRequestException('Coupon fully redeemed');
    }
    if (coupon.applies_to !== 'any' && coupon.applies_to !== feature) {
      throw new BadRequestException('Coupon not applicable to this purchase');
    }
  }
}

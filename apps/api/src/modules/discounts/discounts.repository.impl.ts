import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../shared/supabase/supabase.service';
import type {
  CouponRow,
  CreateCouponRow,
  IDiscountsRepository,
  RedemptionInput,
} from './discounts.repository';

@Injectable()
export class DiscountsRepository implements IDiscountsRepository {
  constructor(private readonly supabase: SupabaseService) {}

  async getActiveByCode(code: string): Promise<CouponRow | null> {
    const { data } = await this.supabase.admin
      .from('coupons')
      .select('*')
      .eq('code', code)
      .eq('active', true)
      .maybeSingle();
    return (data as CouponRow) ?? null;
  }

  async createCoupon(row: CreateCouponRow): Promise<{ id: string }> {
    const { data, error } = await this.supabase.admin
      .from('coupons')
      .insert({
        code: row.code,
        stripe_coupon_id: row.stripeCouponId,
        kind: row.kind,
        percent_off: row.percentOff ?? null,
        amount_off_cents: row.amountOffCents ?? null,
        applies_to: row.appliesTo,
        max_redemptions: row.maxRedemptions ?? null,
        valid_until: row.validUntil ?? null,
      })
      .select('id')
      .single();
    if (error) {
      throw new Error(
        (error as { message?: string }).message ?? 'coupon insert failed',
      );
    }
    return { id: data.id };
  }

  async insertRedemption(input: RedemptionInput): Promise<{ id: string }> {
    const { data, error } = await this.supabase.admin
      .from('discount_redemptions')
      .insert({
        coupon_id: input.couponId,
        user_id: input.userId,
        application_id: input.applicationId,
        list_price_cents: input.listPriceCents,
        discount_cents: input.discountCents,
        charged_price_cents: input.chargedPriceCents,
        resulting_margin: input.resultingMargin,
        floor_ok: input.floorOk,
      })
      .select('id')
      .single();
    if (error) {
      throw new Error(
        (error as { message?: string }).message ?? 'redemption insert failed',
      );
    }
    return { id: data.id };
  }

  async redeem(couponId: string): Promise<boolean> {
    const { data, error } = await this.supabase.admin.rpc('redeem_coupon', {
      p_coupon_id: couponId,
    });
    if (error) return false;
    return data === true;
  }

  async linkRedemptionPayment(
    redemptionId: string,
    paymentId: string,
  ): Promise<void> {
    await this.supabase.admin
      .from('discount_redemptions')
      .update({ payment_id: paymentId })
      .eq('id', redemptionId);
  }
}

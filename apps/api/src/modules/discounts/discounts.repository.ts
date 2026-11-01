export const DISCOUNTS_REPOSITORY = Symbol('DISCOUNTS_REPOSITORY');

export type CouponKind = 'percent' | 'amount';
export type CouponAppliesTo =
  | 'processing_fee'
  | 'addon'
  | 'subscription'
  | 'any';

export interface CouponRow {
  id: string;
  code: string;
  stripe_coupon_id: string | null;
  kind: CouponKind;
  percent_off: number | null;
  amount_off_cents: number | null;
  currency: string;
  applies_to: CouponAppliesTo;
  max_redemptions: number | null;
  redeemed_count: number;
  valid_from: string;
  valid_until: string | null;
  active: boolean;
}

export interface CreateCouponRow {
  code: string;
  stripeCouponId: string;
  kind: CouponKind;
  percentOff?: number;
  amountOffCents?: number;
  appliesTo: CouponAppliesTo;
  maxRedemptions?: number;
  validUntil?: string;
}

export interface RedemptionInput {
  couponId: string;
  userId: string;
  applicationId: string | null;
  listPriceCents: number;
  discountCents: number;
  chargedPriceCents: number;
  resultingMargin: number;
  floorOk: boolean;
}

export interface IDiscountsRepository {
  getActiveByCode(code: string): Promise<CouponRow | null>;
  createCoupon(row: CreateCouponRow): Promise<{ id: string }>;
  insertRedemption(input: RedemptionInput): Promise<{ id: string }>;
  redeem(couponId: string): Promise<boolean>;
  linkRedemptionPayment(redemptionId: string, paymentId: string): Promise<void>;
}

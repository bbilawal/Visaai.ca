import { Body, Controller, Inject, Post, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard';
import { RolesGuard, RequireRole } from '../auth/roles.guard';
import {
  PAYMENT_PROVIDER,
  type PaymentProvider,
} from '../shared/payments/payment-provider.port';
import { z } from 'zod';
import { parseBody } from '../../common/zod-body';

/**
 * API-002: coupons move money. percentOff/amountOffCents were plain optional
 * numbers, so a negative or fractional value reached Stripe unchallenged.
 */
const CreateCouponDto = z
  .object({
    code: z.string().min(1).max(64),
    kind: z.enum(['percent', 'amount']),
    percentOff: z.number().int().min(1).max(100).optional(),
    amountOffCents: z.number().int().positive().optional(),
    appliesTo: z.enum(['processing_fee', 'addon', 'subscription', 'any']),
    maxRedemptions: z.number().int().positive().optional(),
    validUntil: z.string().datetime({ offset: true }).optional(),
  })
  .refine(
    (b) =>
      b.kind === 'percent' ? b.percentOff != null : b.amountOffCents != null,
    {
      message:
        "kind 'percent' requires percentOff; kind 'amount' requires amountOffCents",
    },
  );

import {
  DISCOUNTS_REPOSITORY,
  type CouponAppliesTo,
  type CouponKind,
  type IDiscountsRepository,
} from './discounts.repository';

interface CreateCouponBody {
  code: string;
  kind: CouponKind;
  percentOff?: number;
  amountOffCents?: number;
  appliesTo: CouponAppliesTo;
  maxRedemptions?: number;
  validUntil?: string;
}

@Controller('admin/coupons')
@UseGuards(JwtGuard, RolesGuard)
@RequireRole('admin')
export class CouponAdminController {
  constructor(
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    @Inject(DISCOUNTS_REPOSITORY) private readonly repo: IDiscountsRepository,
  ) {}

  @Post()
  async create(@Body() rawBody: unknown): Promise<{ id: string }> {
    const body: CreateCouponBody = parseBody(CreateCouponDto, rawBody);
    const { id: stripeCouponId } = await this.provider.createCoupon({
      kind: body.kind,
      percentOff: body.percentOff,
      amountOffCents: body.amountOffCents,
    });
    return this.repo.createCoupon({
      code: body.code,
      stripeCouponId,
      kind: body.kind,
      percentOff: body.percentOff,
      amountOffCents: body.amountOffCents,
      appliesTo: body.appliesTo,
      maxRedemptions: body.maxRedemptions,
      validUntil: body.validUntil,
    });
  }
}

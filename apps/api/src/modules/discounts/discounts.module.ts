import { Module } from '@nestjs/common';
import { PricingModule } from '../pricing/pricing.module';
import { DiscountService } from './discount.service';
import { DISCOUNTS_REPOSITORY } from './discounts.repository';
import { DiscountsRepository } from './discounts.repository.impl';
import { CouponAdminController } from './discounts.admin.controller';

@Module({
  imports: [PricingModule], // PricingService for the floor guardrail
  controllers: [CouponAdminController],
  providers: [
    DiscountService,
    DiscountsRepository,
    { provide: DISCOUNTS_REPOSITORY, useExisting: DiscountsRepository },
  ],
  exports: [DiscountService, DISCOUNTS_REPOSITORY],
})
export class DiscountsModule {}

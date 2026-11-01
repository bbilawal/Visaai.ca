import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PRICING_RECOMPUTE_QUEUE } from '../shared/queue/queue.constants';
import { PricingController } from './pricing.controller';
import { PricingService } from './pricing.service';
import { PricingAdminService } from './pricing-admin.service';
import { PricingRepository } from './pricing.repository.impl';
import { PRICING_REPOSITORY } from './pricing.repository';
import { PricingRecomputeService } from './pricing-recompute.service';
import { PricingRecomputeScheduler } from './pricing-recompute.scheduler';
import { PricingRecomputeProcessor } from './pricing-recompute.processor';

/**
 * Dynamic pricing engine (PRICE-2) + nightly recompute (PRICE-3) + quote API and
 * admin config CRUD (PRICE-4). SupabaseService is provided globally (@Global).
 * Exports PricingService for the checkout floor gate (PRICE-6/11).
 */
@Module({
  imports: [BullModule.registerQueue({ name: PRICING_RECOMPUTE_QUEUE })],
  controllers: [PricingController],
  providers: [
    PricingService,
    PricingAdminService,
    { provide: PRICING_REPOSITORY, useClass: PricingRepository },
    PricingRecomputeService,
    PricingRecomputeScheduler,
    PricingRecomputeProcessor,
  ],
  exports: [PricingService, PricingRecomputeService],
})
export class PricingModule {}

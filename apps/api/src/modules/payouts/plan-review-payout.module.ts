import { Module } from '@nestjs/common';
import { CommissionModule } from '../commission/commission.module';
import { PlanReviewPayoutService } from './plan-review-payout.service';

/**
 * Deliberately separate from PayoutsModule.
 *
 * ConsultantModule needs to credit an Expert-plan review when a decision is
 * submitted, but importing the whole PayoutsModule to get it would drag the
 * Stripe gateway, the BullMQ sweep queue and PaymentWebhookService into every
 * graph that boots the consultant review path — including the Gate 2 DI smoke
 * test, which composes a minimal graph on purpose and correctly refuses to
 * resolve PaymentWebhookService.
 *
 * The crediting service needs only SupabaseService (@Global) and
 * CommissionService, so it gets a module sized to that.
 */
@Module({
  imports: [CommissionModule],
  providers: [PlanReviewPayoutService],
  exports: [PlanReviewPayoutService],
})
export class PlanReviewPayoutModule {}

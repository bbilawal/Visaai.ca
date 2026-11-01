import { Module, OnModuleInit } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PAYOUTS_SWEEP_QUEUE } from '../shared/queue/queue.constants';
import { PayoutsController } from './payouts.controller';
import { PayoutsAdminController } from './payouts-admin.controller';
import { ConnectService } from './connect.service';
import { PayoutsService } from './payouts.service';
import { PayoutTaxService } from './payout-tax.service';
import { PAYOUTS_REPOSITORY } from './payouts.repository';
import { PayoutsRepository } from './payouts.repository.impl';
import { PAYOUTS_STRIPE, PayoutsStripeGateway } from './payouts.stripe';
import { PayoutsSweepScheduler } from './payouts-sweep.scheduler';
import { PayoutsSweepProcessor } from './payouts-sweep.processor';
import { PaymentWebhookService } from '../shared/payments/payment-webhook.service';

/**
 * Stripe Connect + payouts (consultant-marketplace M4 / PAY-1..6 + SP4).
 * SupabaseService + FieldCryptoService + auth guards resolve from @Global scope.
 * Exports ConnectService so BillingModule can sync `account.updated`. Registers
 * the `transfer.reversed` handler on the shared payment webhook dispatcher.
 */
@Module({
  imports: [BullModule.registerQueue({ name: PAYOUTS_SWEEP_QUEUE })],
  controllers: [PayoutsController, PayoutsAdminController],
  providers: [
    ConnectService,
    PayoutsService,
    PayoutTaxService,
    { provide: PAYOUTS_REPOSITORY, useClass: PayoutsRepository },
    { provide: PAYOUTS_STRIPE, useClass: PayoutsStripeGateway },
    PayoutsSweepScheduler,
    PayoutsSweepProcessor,
  ],
  exports: [ConnectService],
})
export class PayoutsModule implements OnModuleInit {
  constructor(
    private readonly payouts: PayoutsService,
    private readonly webhook: PaymentWebhookService,
  ) {}

  onModuleInit(): void {
    this.webhook.registerHandlers({
      onTransferReversed: (ev) =>
        this.payouts.handleTransferReversed(ev.providerObjectId),
    });
  }
}

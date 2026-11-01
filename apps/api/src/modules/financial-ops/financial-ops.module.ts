import { Module, OnModuleInit } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { DUNNING_QUEUE } from '../shared/queue/queue.constants';
import { PaymentWebhookService } from '../shared/payments/payment-webhook.service';
import { FINANCIAL_OPS_REPOSITORY } from './financial-ops.repository';
import { FinancialOpsRepository } from './financial-ops.repository.impl';
import { RefundService } from './refund.service';
import { DisputeService } from './dispute.service';
import { PaymentFailedService } from './payment-failed.service';
import { DunningService } from './dunning.service';
import { FinancialReportService } from './financial-report.service';
import { DunningProcessor } from './dunning.processor';
import { DunningScheduler } from './dunning.scheduler';
import { FinancialOpsController } from './financial-ops.controller';

@Module({
  imports: [BullModule.registerQueue({ name: DUNNING_QUEUE })],
  controllers: [FinancialOpsController],
  providers: [
    { provide: FINANCIAL_OPS_REPOSITORY, useClass: FinancialOpsRepository },
    RefundService,
    DisputeService,
    PaymentFailedService,
    DunningService,
    FinancialReportService,
    DunningProcessor,
    DunningScheduler,
  ],
  exports: [FINANCIAL_OPS_REPOSITORY, FinancialReportService],
})
export class FinancialOpsModule implements OnModuleInit {
  constructor(
    private readonly webhook: PaymentWebhookService,
    private readonly refunds: RefundService,
    private readonly disputes: DisputeService,
    private readonly paymentFailed: PaymentFailedService,
  ) {}

  onModuleInit(): void {
    this.webhook.registerHandlers({
      onRefundCreated: (ev) => this.refunds.onRefundCreated(ev),
      onDisputeCreated: (ev) => this.disputes.onDisputeCreated(ev),
      onPaymentFailed: (ev) => this.paymentFailed.onPaymentFailed(ev),
    });
  }
}

import { Module } from '@nestjs/common';
import { FinancialOpsModule } from '../financial-ops/financial-ops.module';
import { BillingAnalyticsController } from './billing-analytics.controller';
import { BillingAnalyticsService } from './billing-analytics.service';
import { BILLING_ANALYTICS_REPOSITORY } from './billing-analytics.repository';
import { BillingAnalyticsRepository } from './billing-analytics.repository.impl';

@Module({
  imports: [FinancialOpsModule], // FinancialReportService for CSV export
  controllers: [BillingAnalyticsController],
  providers: [
    BillingAnalyticsService,
    {
      provide: BILLING_ANALYTICS_REPOSITORY,
      useClass: BillingAnalyticsRepository,
    },
  ],
  exports: [BillingAnalyticsService], // consumed by analytics-metrics (SP-B) for MRR/ARR reuse
})
export class BillingAnalyticsModule {}

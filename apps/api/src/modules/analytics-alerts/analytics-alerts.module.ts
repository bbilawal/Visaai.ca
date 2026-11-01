import { Module } from '@nestjs/common';
import { AnalyticsMetricsModule } from '../analytics-metrics/analytics-metrics.module';
import { AnalyticsApiModule } from '../analytics-api/analytics-api.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ANALYTICS_ALERTS_REPOSITORY } from './analytics-alerts.repository';
import { SupabaseAnalyticsAlertsRepository } from './analytics-alerts.repository.impl';
import { AlertEvaluatorService } from './alert-evaluator.service';
import { ALERT_NOTIFIER } from './alert-notifier.ports';
import { SpineAlertNotifier } from './alert-notifier.impl';
import { AlertRunProcessor } from './alert-run.processor';
import { AlertScheduler } from './alert-schedule.scheduler';
import { AlertsController } from './alerts.controller';

@Module({
  imports: [AnalyticsMetricsModule, AnalyticsApiModule, NotificationsModule],
  controllers: [AlertsController],
  providers: [
    {
      provide: ANALYTICS_ALERTS_REPOSITORY,
      useClass: SupabaseAnalyticsAlertsRepository,
    },
    AlertEvaluatorService,
    SpineAlertNotifier,
    { provide: ALERT_NOTIFIER, useExisting: SpineAlertNotifier },
    AlertRunProcessor,
    AlertScheduler,
  ],
})
export class AnalyticsAlertsModule {}

import { Inject, Injectable, Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { ANALYTICS_ALERTS_QUEUE } from '../shared/queue/queue.constants';
import {
  ANALYTICS_ALERTS_REPOSITORY,
  type IAnalyticsAlertsRepository,
} from './analytics-alerts.repository';
import { AlertEvaluatorService } from './alert-evaluator.service';
import { ALERT_NOTIFIER, type AlertNotifier } from './alert-notifier.ports';
import { transition } from './eval/alert.state';
import { formatAlertMessage } from './eval/alert.message';

@Injectable()
@Processor(ANALYTICS_ALERTS_QUEUE)
export class AlertRunProcessor extends WorkerHost {
  private readonly log = new Logger(AlertRunProcessor.name);
  constructor(
    @Inject(ANALYTICS_ALERTS_REPOSITORY)
    private readonly repo: IAnalyticsAlertsRepository,
    private readonly evaluator: AlertEvaluatorService,
    @Inject(ALERT_NOTIFIER) private readonly notifier: AlertNotifier,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name !== 'tick') return;
    const now = new Date().toISOString();
    const rules = await this.repo.listDueRules(new Date());
    for (const rule of rules) {
      try {
        const { breached, actual } = await this.evaluator.evaluate(rule);

        // Could not evaluate. Record that the attempt happened and leave the
        // state alone: treating "unknown" as "not breached" would walk a firing
        // rule back to ok and send a recovery notice for a problem nobody has
        // fixed. A stale breached state is the honest one — it says the last
        // thing we actually knew.
        if (breached === null) {
          await this.repo.updateState(rule.id, {
            state: rule.state,
            lastValue: rule.lastValue,
            lastEvaluatedAt: now,
            lastTransitionAt: rule.lastTransitionAt,
          });
          continue;
        }

        const { next, fire } = transition(rule.state, breached);
        await this.repo.updateState(rule.id, {
          state: next,
          lastValue: actual,
          lastEvaluatedAt: now,
          lastTransitionAt: fire ? now : rule.lastTransitionAt,
        });
        if (fire) {
          const message = formatAlertMessage(rule.name, fire, actual);
          await this.repo.insertEvent({
            ruleId: rule.id,
            kind: fire,
            value: actual,
            message,
          });
          await this.notifier.fire({
            ruleId: rule.id,
            title: `Alert: ${rule.name}`,
            message,
            userIds: rule.notifyUserIds,
          });
        }
      } catch (e) {
        this.log.warn(`alert rule ${rule.id} failed: ${(e as Error).message}`);
      }
    }
  }
}

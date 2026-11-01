import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/configuration';
import {
  PAYMENT_PROVIDER,
  type PaymentProvider,
} from '../shared/payments/payment-provider.port';
import {
  FINANCIAL_OPS_REPOSITORY,
  type IFinancialOpsRepository,
} from './financial-ops.repository';

@Injectable()
export class DunningService {
  private readonly log = new Logger(DunningService.name);

  constructor(
    @Inject(FINANCIAL_OPS_REPOSITORY)
    private readonly repo: IFinancialOpsRepository,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    private readonly config: ConfigService<Env>,
  ) {}

  /**
   * Daily cycle: for every still-past_due subscription, open dunning if needed,
   * escalate one reminder, and cancel after DUNNING_MAX_ATTEMPTS. A dunning row
   * whose subscription is no longer past_due is reconciled by SP2's
   * subscription.updated webhook; the escalation here only touches still-past_due subs.
   * Reminder delivery (email) is logged in SP5; a user-facing dunning notification
   * event is deferred to the notifications catalog (SP6).
   */
  async runDailyCycle(): Promise<{ escalated: number; canceled: number }> {
    const max = this.config.get('DUNNING_MAX_ATTEMPTS', { infer: true }) ?? 4;
    const pastDue = await this.repo.listPastDueSubscriptions();
    let escalated = 0;
    let canceled = 0;

    for (const sub of pastDue) {
      await this.repo.upsertDunning(sub.id);
      const d = await this.repo.getDunning(sub.id);
      if (!d || d.status !== 'active') continue;

      if (d.attempts + 1 >= max) {
        await this.provider.cancelSubscription(sub.stripe_subscription_id, {
          atPeriodEnd: false,
        });
        await this.repo.setDunningStatus(sub.id, 'canceled');
        canceled += 1;
        this.log.warn(
          `dunning: canceled subscription ${sub.id} after ${max} attempts`,
        );
      } else {
        await this.repo.incrementDunning(sub.id);
        this.log.log(`dunning: reminder for subscription ${sub.id}`);
        escalated += 1;
      }
    }
    return { escalated, canceled };
  }
}

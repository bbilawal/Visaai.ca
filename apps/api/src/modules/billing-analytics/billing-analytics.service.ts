import { Inject, Injectable } from '@nestjs/common';
import {
  monthlyEquivCents,
  type SubPlan,
} from '../subscriptions/subscription.constants';
import { FinancialReportService } from '../financial-ops/financial-report.service';
import type { ReportDimension } from '../financial-ops/financial-ops.repository';
import {
  BILLING_ANALYTICS_REPOSITORY,
  type IBillingAnalyticsRepository,
} from './billing-analytics.repository';

export interface SubscriptionMetrics {
  active: number;
  byPlan: Record<SubPlan, number>;
  mrrCents: number;
  arrCents: number;
}

@Injectable()
export class BillingAnalyticsService {
  constructor(
    @Inject(BILLING_ANALYTICS_REPOSITORY)
    private readonly repo: IBillingAnalyticsRepository,
    private readonly reports: FinancialReportService,
  ) {}

  async subscriptionMetrics(): Promise<SubscriptionMetrics> {
    const subs = await this.repo.listActiveSubscriptions();
    const byPlan: Record<SubPlan, number> = { base: 0, pro: 0, premium: 0 };
    let mrrCents = 0;
    for (const s of subs) {
      byPlan[s.plan] = (byPlan[s.plan] ?? 0) + 1;
      mrrCents += monthlyEquivCents(s.plan, s.billing_interval);
    }
    return { active: subs.length, byPlan, mrrCents, arrCents: mrrCents * 12 };
  }

  async outstanding(): Promise<{ count: number; amountCents: number }> {
    const subs = await this.repo.listPastDueSubscriptions();
    const amountCents = subs.reduce(
      (s, x) => s + monthlyEquivCents(x.plan, x.billing_interval),
      0,
    );
    return { count: subs.length, amountCents };
  }

  listRefunds(): Promise<unknown[]> {
    return this.repo.listRefunds();
  }

  async revenueCsv(
    fromIso: string,
    toIso: string,
    by?: ReportDimension,
  ): Promise<string> {
    const { summary, breakdown } = await this.reports.report(
      fromIso,
      toIso,
      by,
    );
    const lines: string[] = [];
    lines.push('metric,key,value_cents');
    lines.push(`collected,,${summary.collectedCents}`);
    lines.push(`refunded,,${summary.refundedCents}`);
    lines.push(`net,,${summary.netCents}`);
    lines.push(`count,,${summary.count}`);
    if (breakdown) {
      for (const b of breakdown) {
        lines.push(`net_by_${by},${csvCell(b.key)},${b.netCents}`);
      }
    }
    return lines.join('\n') + '\n';
  }
}

/** Minimal CSV cell escaping (quote if it contains a comma/quote/newline). */
function csvCell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

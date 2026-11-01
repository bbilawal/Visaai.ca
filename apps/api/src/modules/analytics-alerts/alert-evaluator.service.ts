import { Injectable, Logger } from '@nestjs/common';
import { MetricsQueryService } from '../analytics-api/query/metrics-query.service';
import { resolveRange } from '../analytics-api/query/range.resolver';
import { evaluateRule } from './eval/condition.evaluator';
import type { AlertRuleRow } from './analytics-alerts.repository';
import type { MetricQuery } from '../analytics-metrics/contracts/metric.contract';

@Injectable()
export class AlertEvaluatorService {
  private readonly log = new Logger(AlertEvaluatorService.name);
  constructor(private readonly query: MetricsQueryService) {}

  /**
   * Evaluate one rule.
   *
   * `breached: null` means COULD NOT EVALUATE, and it is a distinct answer from
   * `false`. Collapsing the two is not a conservative default — it is a false
   * all-clear:
   *
   *   transition('breached', false) => { next: 'ok', fire: 'recovery' }
   *
   * So a rule that was firing, whose metric then became unresolvable — a typo
   * in metricKey, a rollup outage, a renamed metric — would transition to ok
   * and send a RECOVERY notification. The system would report the problem
   * solved at the exact moment it stopped being able to tell.
   *
   * The caller must not transition state on null.
   */
  async evaluate(
    rule: AlertRuleRow,
  ): Promise<{ breached: boolean | null; actual: number | null }> {
    const wantsDelta = rule.conditions.some(
      (c) => c.target.kind === 'delta_pct',
    );
    const { from, to } = resolveRange(rule.query, new Date());
    const q: MetricQuery & { metric?: string } = {
      from,
      to,
      grain: rule.query.grain,
      filters: rule.query.filters,
      metric: rule.metric,
      compareTo: wantsDelta ? 'prev_period' : (rule.query.compareTo ?? null),
    };
    try {
      const result = await this.query.run(rule.metricKey, q, { fresh: true });
      const { breached, actuals } = evaluateRule(
        result,
        rule.conditions,
        rule.combine,
      );
      const actual = actuals.find((a) => a !== null) ?? null;
      return { breached, actual };
    } catch (e) {
      // Error level, not warn: a rule that cannot be evaluated is not watching
      // anything, and that is exactly as serious as the condition it watches.
      this.log.error(
        `alert ${rule.id} (${rule.name}) could NOT be evaluated — it is not ` +
          `watching anything until this is fixed: ${(e as Error).message}`,
      );
      return { breached: null, actual: null };
    }
  }
}

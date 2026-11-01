import type { MetricResult } from '@visaai/types';
import type {
  Condition,
  ConditionTarget,
  Combine,
  Operator,
} from './condition.types';

export function extractTarget(
  result: MetricResult,
  target: ConditionTarget,
): number | null {
  switch (target.kind) {
    case 'total':
      return result.total;
    case 'delta_pct':
      return result.delta?.pct ?? null;
    case 'dimension':
      return (
        result.byDimension?.find((d) => d.key === target.dimVal)?.value ?? null
      );
    case 'series': {
      const vals = result.series.map((s) => s.value);
      if (vals.length === 0) return null;
      switch (target.agg) {
        case 'min':
          return Math.min(...vals);
        case 'max':
          return Math.max(...vals);
        case 'last':
          return vals[vals.length - 1];
        case 'avg':
          return vals.reduce((a, b) => a + b, 0) / vals.length;
      }
    }
  }
}

function compare(actual: number, op: Operator, value: number): boolean {
  switch (op) {
    case 'gt':
      return actual > value;
    case 'lt':
      return actual < value;
    case 'gte':
      return actual >= value;
    case 'lte':
      return actual <= value;
    case 'eq':
      return actual === value;
  }
}

export function evaluateCondition(
  result: MetricResult,
  c: Condition,
): { breached: boolean; actual: number | null } {
  const actual = extractTarget(result, c.target);
  if (actual === null) return { breached: false, actual: null };
  return { breached: compare(actual, c.op, c.value), actual };
}

export function evaluateRule(
  result: MetricResult,
  conditions: Condition[],
  combine: Combine,
): { breached: boolean; actuals: (number | null)[] } {
  const evals = conditions.map((c) => evaluateCondition(result, c));
  const actuals = evals.map((e) => e.actual);
  if (conditions.length === 0) return { breached: false, actuals };
  const breached =
    combine === 'all'
      ? evals.every((e) => e.breached)
      : evals.some((e) => e.breached);
  return { breached, actuals };
}

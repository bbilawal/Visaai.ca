import type {
  Grain,
  MetricResult,
  MetricUnit,
} from '../contracts/metric.contract';
import { bucketize } from './bucketing';
import { computeDelta } from './delta';

export function isStale(
  latestDay: string | null,
  slaMinutes: number,
  now: Date = new Date(),
): boolean {
  if (!latestDay) return true;
  const latest = new Date(`${latestDay}T23:59:59.000Z`).getTime();
  return now.getTime() - latest > slaMinutes * 60_000;
}

export function buildResult(args: {
  metric: string;
  unit: MetricUnit;
  tier: 'live' | 'rollup' | 'derived';
  rows: { day: string; value: number }[];
  from: string;
  to: string;
  grain: Grain;
  baselineRows?: { day: string; value: number }[];
  slaMinutes?: number;
  byDimension?: { key: string; value: number }[];
}): MetricResult {
  const series = bucketize(args.rows, args.from, args.to, args.grain);
  const total = args.rows.reduce((s, r) => s + r.value, 0);
  const result: MetricResult = {
    metric: args.metric,
    unit: args.unit,
    total,
    series,
    meta: { computedAt: new Date().toISOString(), tier: args.tier },
  };
  if (args.baselineRows) {
    const baseTotal = args.baselineRows.reduce((s, r) => s + r.value, 0);
    result.delta = computeDelta(total, baseTotal);
  }
  if (args.byDimension) result.byDimension = args.byDimension;
  if (args.slaMinutes != null) {
    const latest = args.rows.length
      ? args.rows
          .map((r) => r.day)
          .sort()
          .at(-1)!
      : null;
    result.meta.stale = isStale(latest, args.slaMinutes);
  }
  return result;
}

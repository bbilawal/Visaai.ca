import type { MetricService } from './contracts/metric.contract';

export const METRIC_REGISTRY = Symbol('METRIC_REGISTRY');

export function buildMetricRegistry(
  services: MetricService[],
): Map<string, MetricService> {
  const reg = new Map<string, MetricService>();
  for (const s of services) reg.set(s.key, s);
  return reg;
}

import { z } from 'zod';
import type { MetricQuery, MetricFilters } from './metric.contract';
import { InvalidQueryError, UnsupportedFilterError } from './metric.errors';

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD');

const schema = z.object({
  from: isoDate,
  to: isoDate,
  grain: z.enum(['day', 'week', 'month']),
  filters: z
    .object({
      country: z.string().optional(),
      plan: z.string().optional(),
      visa_type: z.string().optional(),
      framework_id: z.string().optional(),
      consultant_id: z.string().optional(),
    })
    .partial()
    .optional(),
  compareTo: z.enum(['prev_period', 'prev_year']).nullish(),
});

export function validateQuery(q: MetricQuery): MetricQuery {
  const parsed = schema.safeParse(q);
  if (!parsed.success)
    throw new InvalidQueryError(
      parsed.error.issues.map((i) => i.message).join('; '),
    );
  if (parsed.data.from > parsed.data.to)
    throw new InvalidQueryError('from must be <= to');
  return parsed.data as MetricQuery;
}

export function assertFiltersSupported(
  metric: string,
  q: MetricQuery,
  supported: (keyof MetricFilters)[],
): void {
  const keys = Object.entries(q.filters ?? {})
    .filter(([, v]) => v != null)
    .map(([k]) => k as keyof MetricFilters);
  if (keys.length > 1) {
    throw new InvalidQueryError(
      `Metric '${metric}' supports only one filter dimension per query (v1)`,
    );
  }
  for (const k of keys)
    if (!supported.includes(k)) throw new UnsupportedFilterError(metric, k);
}

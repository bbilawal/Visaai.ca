import {
  InvalidQueryError,
  UnsupportedFilterError,
  MetricComputeError,
} from './metric.errors';

describe('metric.errors', () => {
  it('UnsupportedFilterError names the metric + filter', () => {
    const e = new UnsupportedFilterError('mrr', 'visa_type');
    expect(e.metric).toBe('mrr');
    expect(e.filterKey).toBe('visa_type');
    expect(e.message).toContain('visa_type');
    expect(e instanceof Error).toBe(true);
  });

  it('MetricComputeError carries the metric key + cause', () => {
    const cause = new Error('db down');
    const e = new MetricComputeError('churn_total', cause);
    expect(e.metricKey).toBe('churn_total');
    expect(e.cause).toBe(cause);
  });

  it('InvalidQueryError is an Error subclass', () => {
    expect(new InvalidQueryError('bad range') instanceof Error).toBe(true);
  });
});

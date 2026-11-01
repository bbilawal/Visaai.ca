export class InvalidQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidQueryError';
  }
}

export class UnsupportedFilterError extends Error {
  constructor(
    public readonly metric: string,
    public readonly filterKey: string,
  ) {
    super(`Metric '${metric}' does not support filter '${filterKey}'`);
    this.name = 'UnsupportedFilterError';
  }
}

export class MetricComputeError extends Error {
  constructor(
    public readonly metricKey: string,
    public readonly cause: unknown,
  ) {
    super(`Metric '${metricKey}' failed to compute`);
    this.name = 'MetricComputeError';
  }
}

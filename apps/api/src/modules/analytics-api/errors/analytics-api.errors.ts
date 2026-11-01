export class UnknownMetricError extends Error {
  constructor(public readonly key: string) {
    super(`Unknown metric '${key}'`);
    this.name = 'UnknownMetricError';
  }
}

export class UnsupportedExportFormatError extends Error {
  constructor(public readonly format: string) {
    super(`Unsupported export format '${format}'`);
    this.name = 'UnsupportedExportFormatError';
  }
}

export class ReportNotFoundError extends Error {
  constructor(public readonly id: string) {
    super(`Report '${id}' not found`);
    this.name = 'ReportNotFoundError';
  }
}

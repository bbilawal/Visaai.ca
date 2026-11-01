import type {
  MetricQuery,
  MetricResult,
} from '../../analytics-metrics/contracts/metric.contract';

export interface ExportInput {
  key: string;
  metric: string;
  query: MetricQuery;
  result: MetricResult;
  title: string;
}
export interface ExportFile {
  buffer: Buffer;
  contentType: string;
  filename: string;
}
export interface MetricExporter {
  readonly format: 'csv' | 'xlsx' | 'pdf';
  render(input: ExportInput): Promise<ExportFile>;
}

export function baseFilename(i: ExportInput, ext: string): string {
  return `${i.key}-${i.metric}-${i.query.from}_${i.query.to}.${ext}`;
}

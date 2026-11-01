import { Injectable } from '@nestjs/common';
import type {
  MetricExporter,
  ExportInput,
  ExportFile,
} from './metric-exporter.contract';
import { baseFilename } from './metric-exporter.contract';

@Injectable()
export class CsvExporter implements MetricExporter {
  readonly format = 'csv' as const;

  async render(input: ExportInput): Promise<ExportFile> {
    const { result } = input;
    const rows = [
      'section,label,value',
      `total,,${result.total}`,
      ...result.series.map((s) => `${s.bucket},${s.value}`),
      ...(result.byDimension ?? []).map((d) => `dim_${d.key},,${d.value}`),
    ];
    return {
      buffer: Buffer.from(rows.join('\n'), 'utf8'),
      contentType: 'text/csv',
      filename: baseFilename(input, 'csv'),
    };
  }
}

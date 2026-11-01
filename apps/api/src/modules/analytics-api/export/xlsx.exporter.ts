import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import type {
  MetricExporter,
  ExportInput,
  ExportFile,
} from './metric-exporter.contract';
import { baseFilename } from './metric-exporter.contract';

@Injectable()
export class XlsxExporter implements MetricExporter {
  readonly format = 'xlsx' as const;

  async render(input: ExportInput): Promise<ExportFile> {
    const { result } = input;
    const wb = new ExcelJS.Workbook();
    const summary = wb.addWorksheet('Summary');
    summary.addRows([
      ['metric', result.metric],
      ['unit', result.unit],
      ['total', result.total],
      ['delta_pct', result.delta?.pct ?? ''],
      ['from', input.query.from],
      ['to', input.query.to],
      ['grain', input.query.grain],
      ['stale', result.meta.stale ?? false],
      ['computedAt', result.meta.computedAt],
    ]);
    const series = wb.addWorksheet('Series');
    series.addRow(['bucket', 'value']);
    result.series.forEach((s) => series.addRow([s.bucket, s.value]));
    if (result.byDimension?.length) {
      const dim = wb.addWorksheet('ByDimension');
      dim.addRow(['key', 'value']);
      result.byDimension.forEach((d) => dim.addRow([d.key, d.value]));
    }
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    return {
      buffer,
      contentType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      filename: baseFilename(input, 'xlsx'),
    };
  }
}

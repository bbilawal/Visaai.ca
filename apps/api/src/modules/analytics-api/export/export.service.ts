import { Injectable } from '@nestjs/common';
import { CsvExporter } from './csv.exporter';
import { XlsxExporter } from './xlsx.exporter';
import { PdfExporter } from './pdf.exporter';
import type {
  ExportInput,
  ExportFile,
  MetricExporter,
} from './metric-exporter.contract';
import { UnsupportedExportFormatError } from '../errors/analytics-api.errors';

@Injectable()
export class ExportService {
  private readonly byFormat: Record<string, MetricExporter>;
  constructor(csv: CsvExporter, xlsx: XlsxExporter, pdf: PdfExporter) {
    this.byFormat = { csv, xlsx, pdf };
  }
  async render(format: string, input: ExportInput): Promise<ExportFile> {
    const exporter = this.byFormat[format];
    if (!exporter) throw new UnsupportedExportFormatError(format);
    return exporter.render(input);
  }
}

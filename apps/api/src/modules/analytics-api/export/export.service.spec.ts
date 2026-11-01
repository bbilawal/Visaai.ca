import { ExportService } from './export.service';
import { CsvExporter } from './csv.exporter';
import { XlsxExporter } from './xlsx.exporter';
import { PdfExporter } from './pdf.exporter';
import { UnsupportedExportFormatError } from '../errors/analytics-api.errors';

const input = {
  key: 'financial',
  metric: 'mrr',
  title: 'MRR',
  query: { from: '2026-07-01', to: '2026-07-31', grain: 'day' as const },
  result: {
    metric: 'mrr',
    unit: 'cents' as const,
    total: 1,
    series: [],
    meta: { computedAt: 'x', tier: 'live' as const },
  },
};

describe('ExportService', () => {
  const svc = new ExportService(
    new CsvExporter(),
    new XlsxExporter(),
    new PdfExporter(),
  );
  it('dispatches by format', async () => {
    expect((await svc.render('csv', input)).contentType).toBe('text/csv');
    expect((await svc.render('pdf', input)).contentType).toBe(
      'application/pdf',
    );
  });
  it('throws on unknown format', async () => {
    await expect(svc.render('json' as any, input)).rejects.toThrow(
      UnsupportedExportFormatError,
    );
  });
});

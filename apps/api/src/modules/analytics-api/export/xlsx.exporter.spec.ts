import ExcelJS from 'exceljs';
import { XlsxExporter } from './xlsx.exporter';

const input = {
  key: 'financial',
  metric: 'mrr',
  title: 'MRR',
  query: { from: '2026-07-01', to: '2026-07-31', grain: 'day' as const },
  result: {
    metric: 'mrr',
    unit: 'cents' as const,
    total: 1500,
    series: [{ bucket: '2026-07-01', value: 1000 }],
    meta: { computedAt: 'x', tier: 'live' as const },
  },
};

describe('XlsxExporter', () => {
  it('produces a workbook with Summary + Series sheets', async () => {
    const f = await new XlsxExporter().render(input);
    expect(f.filename.endsWith('.xlsx')).toBe(true);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(f.buffer as any);
    expect(wb.getWorksheet('Summary')).toBeDefined();
    expect(wb.getWorksheet('Series')).toBeDefined();
  });
});

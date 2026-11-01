import { PdfExporter } from './pdf.exporter';

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

describe('PdfExporter', () => {
  it('produces a non-empty PDF buffer with the %PDF header', async () => {
    const f = await new PdfExporter().render(input);
    expect(f.contentType).toBe('application/pdf');
    expect(f.filename.endsWith('.pdf')).toBe(true);
    expect(f.buffer.length).toBeGreaterThan(100);
    expect(f.buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });
});

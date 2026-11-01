import { CsvExporter } from './csv.exporter';

const input = {
  key: 'financial',
  metric: 'mrr',
  title: 'MRR',
  query: { from: '2026-07-01', to: '2026-07-31', grain: 'day' as const },
  result: {
    metric: 'mrr',
    unit: 'cents' as const,
    total: 1500,
    series: [
      { bucket: '2026-07-01', value: 1000 },
      { bucket: '2026-07-02', value: 500 },
    ],
    meta: { computedAt: 'x', tier: 'live' as const },
  },
};

describe('CsvExporter', () => {
  it('emits total + series rows as CSV', async () => {
    const f = await new CsvExporter().render(input);
    const text = f.buffer.toString('utf8');
    expect(f.contentType).toBe('text/csv');
    expect(f.filename).toBe('financial-mrr-2026-07-01_2026-07-31.csv');
    expect(text).toContain('total,,1500');
    expect(text).toContain('2026-07-01,1000');
    expect(text).toContain('2026-07-02,500');
  });
});

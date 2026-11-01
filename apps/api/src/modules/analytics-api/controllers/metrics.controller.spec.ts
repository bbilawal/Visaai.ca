import { MetricsController } from './metrics.controller';

const qsvc = {
  run: jest.fn().mockResolvedValue({
    metric: 'mrr',
    unit: 'cents',
    total: 5,
    series: [],
    meta: { computedAt: 'x', tier: 'live' },
  }),
  summary: jest.fn().mockResolvedValue({ financial: { total: 5 } }),
  catalog: jest
    .fn()
    .mockReturnValue([{ key: 'financial', supportedFilters: ['plan'] }]),
} as any;
const exportSvc = {
  render: jest.fn().mockResolvedValue({
    buffer: Buffer.from('x'),
    contentType: 'text/csv',
    filename: 'financial-mrr-a_b.csv',
  }),
} as any;

describe('MetricsController', () => {
  const c = new MetricsController(qsvc, exportSvc);

  it('getMetric passes key + parsed query to the service', async () => {
    const r = await c.getMetric('financial', {
      from: '2026-07-01',
      to: '2026-07-31',
      grain: 'day',
      metric: 'mrr',
      fresh: '1',
    } as any);
    expect(r.total).toBe(5);
    const [key, query, opts] = qsvc.run.mock.calls[0];
    expect(key).toBe('financial');
    expect(query.metric).toBe('mrr');
    expect(opts).toEqual({ fresh: true });
  });

  it('summary delegates', async () => {
    const out = await c.summary({
      from: '2026-07-01',
      to: '2026-07-31',
      grain: 'day',
    } as any);
    expect((out.financial as any).total).toBe(5);
  });

  it('catalog delegates', () => {
    expect(c.catalog()[0].key).toBe('financial');
  });

  it('exportMetric computes fresh + sets content-disposition', async () => {
    const res = { set: jest.fn() } as any;
    const file = await c.exportMetric(
      'financial',
      {
        from: '2026-07-01',
        to: '2026-07-31',
        grain: 'day',
        metric: 'mrr',
        format: 'csv',
      } as any,
      res,
    );
    expect(qsvc.run).toHaveBeenCalledWith('financial', expect.any(Object), {
      fresh: true,
    });
    expect(res.set).toHaveBeenCalledWith(
      expect.objectContaining({
        'Content-Disposition': expect.stringContaining('attachment'),
      }),
    );
    expect(file).toBeDefined();
  });
});

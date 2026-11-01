import { MetricsQueryService } from './metrics-query.service';
import { UnknownMetricError } from '../errors/analytics-api.errors';

const cache = { wrap: jest.fn((_k, _q, compute) => compute()) } as any; // pass-through
const q = { from: '2026-07-01', to: '2026-07-31', grain: 'day' as const };
const mk = (key: string, total: number) => ({
  key,
  supportedFilters: ['plan'],
  compute: jest.fn().mockResolvedValue({
    metric: key,
    unit: 'cents',
    total,
    series: [],
    meta: { computedAt: 'x', tier: 'live' },
  }),
});

describe('MetricsQueryService', () => {
  it('run resolves the service from the registry', async () => {
    const reg = new Map<string, any>([['financial', mk('financial', 100)]]);
    const svc = new MetricsQueryService(reg, cache);
    const r = await svc.run('financial', q);
    expect(r.total).toBe(100);
  });

  it('run throws UnknownMetricError for a missing key', async () => {
    const svc = new MetricsQueryService(new Map(), cache);
    await expect(svc.run('nope', q)).rejects.toThrow(UnknownMetricError);
  });

  it('summary returns a slot per configured key, with {error} for a failing metric', async () => {
    const good = mk('financial', 1);
    const bad = {
      key: 'growth',
      supportedFilters: [],
      compute: jest.fn().mockRejectedValue(new Error('boom')),
    };
    const reg = new Map<string, any>([
      ['financial', good],
      ['growth', bad],
    ]);
    const svc = new MetricsQueryService(reg, cache, ['financial', 'growth']);
    const out = await svc.summary(q);
    expect((out.financial as any).total).toBe(1);
    expect((out.growth as any).error).toContain('boom');
  });

  it('catalog lists keys + supportedFilters', () => {
    const reg = new Map<string, any>([['financial', mk('financial', 1)]]);
    const svc = new MetricsQueryService(reg, cache);
    expect(svc.catalog()).toEqual([
      { key: 'financial', supportedFilters: ['plan'] },
    ]);
  });
});

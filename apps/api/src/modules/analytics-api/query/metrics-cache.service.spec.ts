import { MetricsCacheService } from './metrics-cache.service';
import type { MetricResult } from '../../analytics-metrics/contracts/metric.contract';

const result: MetricResult = {
  metric: 'mrr',
  unit: 'cents',
  total: 1,
  series: [],
  meta: { computedAt: 'x', tier: 'live' },
};
const q = { from: '2026-07-01', to: '2026-07-31', grain: 'day' as const };

function memClient() {
  const store = new Map<string, string>();
  return {
    store,
    get: jest.fn(async (k: string) => store.get(k) ?? null),
    setex: jest.fn(
      async (k: string, _t: number, v: string) => void store.set(k, v),
    ),
  };
}

describe('MetricsCacheService', () => {
  it('caches: second call hits cache, compute runs once', async () => {
    const client = memClient();
    const svc = new MetricsCacheService(client, 60);
    const compute = jest.fn().mockResolvedValue(result);
    await svc.wrap('financial', q, compute);
    await svc.wrap('financial', q, compute);
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it('key is stable across filter key order', async () => {
    const client = memClient();
    const svc = new MetricsCacheService(client, 60);
    const compute = jest.fn().mockResolvedValue(result);
    await svc.wrap(
      'financial',
      { ...q, filters: { plan: 'pro', country: 'CA' } } as any,
      compute,
    );
    await svc.wrap(
      'financial',
      { ...q, filters: { country: 'CA', plan: 'pro' } } as any,
      compute,
    );
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it('fresh bypass recomputes', async () => {
    const client = memClient();
    const svc = new MetricsCacheService(client, 60);
    const compute = jest.fn().mockResolvedValue(result);
    await svc.wrap('financial', q, compute);
    await svc.wrap('financial', q, compute, { fresh: true });
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it('degrades to direct compute when redis throws', async () => {
    const client = {
      get: jest.fn().mockRejectedValue(new Error('down')),
      setex: jest.fn().mockRejectedValue(new Error('down')),
    };
    const svc = new MetricsCacheService(client, 60);
    const compute = jest.fn().mockResolvedValue(result);
    await expect(svc.wrap('financial', q, compute)).resolves.toEqual(result);
    expect(compute).toHaveBeenCalledTimes(1);
  });
});

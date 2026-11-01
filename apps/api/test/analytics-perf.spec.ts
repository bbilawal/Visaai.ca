import { MetricsQueryService } from '../src/modules/analytics-api/query/metrics-query.service';
import { MetricsCacheService } from '../src/modules/analytics-api/query/metrics-cache.service';
const passthroughCache = {
  wrap: (_k: string, _q: any, compute: any) => compute(),
} as any;

/**
 * Tracks how many computes are in flight at once, so parallelism can be
 * asserted directly instead of inferred from a stopwatch.
 */
function makeConcurrencyProbe() {
  const probe = { inFlight: 0, max: 0 };
  return probe;
}

function svcFor(
  key: string,
  delayMs: number,
  probe?: { inFlight: number; max: number },
) {
  return {
    key,
    supportedFilters: [],
    compute: jest.fn(async () => {
      if (probe) {
        probe.inFlight += 1;
        probe.max = Math.max(probe.max, probe.inFlight);
      }
      await new Promise((r) => setTimeout(r, delayMs));
      if (probe) probe.inFlight -= 1;
      return {
        metric: key,
        unit: 'count',
        total: 1,
        series: [],
        meta: { computedAt: 'x', tier: 'live' },
      };
    }),
  };
}

describe('analytics perf budgets', () => {
  it('summary over 7 keys runs them in PARALLEL, not serially', async () => {
    // This asserted wall-clock < 200ms as a proxy for parallelism, which made
    // it flaky: the suite runs across parallel jest workers, and on a loaded
    // machine a genuinely-parallel run can still exceed a 200ms stopwatch.
    // Observed failing roughly 1 run in 8.
    //
    // Measuring peak concurrency tests the actual property — all seven metrics
    // in flight at once — and is immune to how busy the host is. Serial
    // execution would peak at 1.
    const keys = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    const probe = makeConcurrencyProbe();
    const reg = new Map(keys.map((k) => [k, svcFor(k, 20, probe)]));
    const svc = new MetricsQueryService(reg as any, passthroughCache, keys);

    await svc.summary({ from: '2026-07-01', to: '2026-07-31', grain: 'day' });

    expect(probe.max).toBe(keys.length);
    expect(probe.inFlight).toBe(0); // every compute settled
  });

  it('each metric computes exactly once in summary', async () => {
    const s = svcFor('a', 0);
    const svc = new MetricsQueryService(
      new Map([['a', s]]) as any,
      passthroughCache,
      ['a'],
    );
    await svc.summary({ from: '2026-07-01', to: '2026-07-31', grain: 'day' });
    expect(s.compute).toHaveBeenCalledTimes(1);
  });

  it('cache hit short-circuits compute', async () => {
    const store = new Map<string, string>();
    const client = {
      get: async (k: string) => store.get(k) ?? null,
      setex: async (k: string, _t: number, v: string) => void store.set(k, v),
    };
    const cache = new MetricsCacheService(client, 60);
    const compute = jest.fn().mockResolvedValue({
      metric: 'x',
      unit: 'count',
      total: 1,
      series: [],
      meta: { computedAt: 'x', tier: 'live' },
    });
    const q = { from: '2026-07-01', to: '2026-07-31', grain: 'day' as const };
    await cache.wrap('k', q, compute);
    await cache.wrap('k', q, compute);
    expect(compute).toHaveBeenCalledTimes(1);
  });
});

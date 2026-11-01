import { AlertEvaluatorService } from './alert-evaluator.service';

const rule = (over: any = {}) => ({
  metricKey: 'financial',
  metric: 'mrr_trend',
  query: { rangePreset: 'mtd', grain: 'day' },
  conditions: [{ target: { kind: 'total' }, op: 'lt', value: 100000 }],
  combine: 'all',
  ...over,
});

describe('AlertEvaluatorService', () => {
  it('runs the metric fresh and reports breach', async () => {
    const query = {
      run: jest.fn().mockResolvedValue({
        metric: 'mrr',
        unit: 'cents',
        total: 84000,
        series: [],
        meta: { computedAt: 'x', tier: 'rollup' },
      }),
    } as any;
    const svc = new AlertEvaluatorService(query);
    const out = await svc.evaluate(rule());
    expect(out).toEqual({ breached: true, actual: 84000 });
    const [key, q, opts] = query.run.mock.calls[0];
    expect(key).toBe('financial');
    expect(q.metric).toBe('mrr_trend');
    expect(opts).toEqual({ fresh: true });
  });
  it('sets compareTo when a condition targets delta_pct', async () => {
    const query = {
      run: jest.fn().mockResolvedValue({
        metric: 'mrr',
        unit: 'cents',
        total: 1,
        series: [],
        delta: { baseline: 2, pct: -0.5 },
        meta: { computedAt: 'x', tier: 'rollup' },
      }),
    } as any;
    const svc = new AlertEvaluatorService(query);
    await svc.evaluate(
      rule({
        conditions: [{ target: { kind: 'delta_pct' }, op: 'lt', value: -0.1 }],
      }),
    );
    expect(query.run.mock.calls[0][1].compareTo).toBe('prev_period');
  });
  it('metric error -> breached: null, because unknown is not the same as fine', async () => {
    // This test used to assert `breached: false` under the name "never fires on
    // failure". That was only true for a rule already in the ok state: from
    // 'breached', transition(prev, false) fires a RECOVERY, so the old
    // behaviour announced that a still-broken thing had been fixed.
    const query = {
      run: jest.fn().mockRejectedValue(new Error('boom')),
    } as any;
    const svc = new AlertEvaluatorService(query);
    expect(await svc.evaluate(rule())).toEqual({
      breached: null,
      actual: null,
    });
  });
});

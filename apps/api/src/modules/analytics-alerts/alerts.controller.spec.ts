import { AlertsController } from './alerts.controller';
import { MockAnalyticsAlertsRepository } from './mock-analytics-alerts.repository';
import { AlertValidationError } from './analytics-alerts.errors';

const registry = new Map([
  ['financial', { key: 'financial', supportedFilters: [], compute: jest.fn() }],
]);
const evaluator = {
  evaluate: jest.fn().mockResolvedValue({ breached: true, actual: 84000 }),
} as any;
const goodBody = {
  name: 'MRR floor',
  metricKey: 'financial',
  metric: 'mrr_trend',
  query: { rangePreset: 'mtd', grain: 'day' },
  conditions: [{ target: { kind: 'total' }, op: 'lt', value: 100000 }],
  combine: 'all',
  recipients: [],
  notifyUserIds: ['u1'],
};

describe('AlertsController', () => {
  it('create validates + persists', async () => {
    const repo = new MockAnalyticsAlertsRepository();
    const c = new AlertsController(repo, evaluator, registry);
    const r = await c.create(goodBody as any, { id: 'u1' } as any);
    expect(r.id).toBeTruthy();
  });
  it('rejects empty conditions', async () => {
    const c = new AlertsController(
      new MockAnalyticsAlertsRepository(),
      evaluator,
      registry,
    );
    await expect(
      c.create({ ...goodBody, conditions: [] } as any, { id: 'u1' } as any),
    ).rejects.toThrow(AlertValidationError);
  });
  it('rejects an unknown metric key', async () => {
    const c = new AlertsController(
      new MockAnalyticsAlertsRepository(),
      evaluator,
      registry,
    );
    await expect(
      c.create({ ...goodBody, metricKey: 'nope' } as any, { id: 'u1' } as any),
    ).rejects.toThrow(AlertValidationError);
  });
  it('test evaluates without mutating state', async () => {
    const repo = new MockAnalyticsAlertsRepository();
    const c = new AlertsController(repo, evaluator, registry);
    const created = await c.create(goodBody as any, { id: 'u1' } as any);
    const out = await c.test(created.id);
    expect(out).toEqual({ breached: true, actual: 84000, wouldFire: true });
    expect((await repo.getRule(created.id))?.state).toBe('ok');
  });
});

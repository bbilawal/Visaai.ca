import { MockAnalyticsAlertsRepository } from './mock-analytics-alerts.repository';

describe('MockAnalyticsAlertsRepository', () => {
  it('creates a rule defaulting to state ok, and lists due (enabled) rules', async () => {
    const repo = new MockAnalyticsAlertsRepository();
    const r = await repo.createRule({
      name: 'MRR floor',
      metricKey: 'financial',
      metric: 'mrr_trend',
      query: { rangePreset: 'mtd', grain: 'day' },
      conditions: [{ target: { kind: 'total' }, op: 'lt', value: 100000 }],
      combine: 'all',
      recipients: [],
      notifyUserIds: ['u1'],
      enabled: true,
      createdBy: 'u1',
    });
    expect(r.state).toBe('ok');
    expect((await repo.listDueRules(new Date())).map((x) => x.id)).toContain(
      r.id,
    );
  });
  it('updateState transitions and insertEvent records history', async () => {
    const repo = new MockAnalyticsAlertsRepository();
    const r = await repo.createRule({
      name: 'x',
      metricKey: 'financial',
      metric: 'mrr_trend',
      query: {},
      conditions: [],
      combine: 'all',
      recipients: [],
      notifyUserIds: [],
      enabled: true,
      createdBy: 'u1',
    });
    await repo.updateState(r.id, {
      state: 'breached',
      lastValue: 5,
      lastEvaluatedAt: 't',
      lastTransitionAt: 't',
    });
    await repo.insertEvent({
      ruleId: r.id,
      kind: 'breach',
      value: 5,
      message: 'm',
    });
    expect((await repo.getRule(r.id))?.state).toBe('breached');
    expect(await repo.listEvents(r.id)).toHaveLength(1);
  });
});

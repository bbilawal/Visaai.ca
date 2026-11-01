import { MockAnalyticsReportsRepository } from './mock-analytics-reports.repository';

describe('MockAnalyticsReportsRepository', () => {
  it('creates and gets a saved report', async () => {
    const repo = new MockAnalyticsReportsRepository();
    const r = await repo.createSaved({
      name: 'MRR',
      metricKey: 'financial',
      metric: 'mrr',
      query: { rangePreset: 'mtd', grain: 'day' },
      createdBy: 'u1',
    });
    expect((await repo.getSaved(r.id))?.name).toBe('MRR');
  });

  it('lists due scheduled reports and advances next_run_at', async () => {
    const repo = new MockAnalyticsReportsRepository();
    const s = await repo.createSaved({
      name: 'x',
      metricKey: 'financial',
      metric: 'mrr',
      query: { rangePreset: 'mtd', grain: 'day' },
      createdBy: 'u1',
    });
    await repo.upsertSchedule({
      savedReportId: s.id,
      cron: '* * * * *',
      format: 'pdf',
      recipients: ['a@b.c'],
      notifyUserIds: [],
      nextRunAt: '2000-01-01T00:00:00Z',
    });
    const due = await repo.listDueSchedules(new Date('2026-07-09T00:00:00Z'));
    expect(due).toHaveLength(1);
    await repo.setNextRun(due[0].id, '2999-01-01T00:00:00Z');
    expect(
      await repo.listDueSchedules(new Date('2026-07-09T00:00:00Z')),
    ).toHaveLength(0);
  });
});

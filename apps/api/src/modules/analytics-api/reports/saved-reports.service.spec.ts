import { SavedReportsService } from './saved-reports.service';
import { MockAnalyticsReportsRepository } from './mock-analytics-reports.repository';
import { ReportNotFoundError } from '../errors/analytics-api.errors';

const query = {
  run: jest.fn().mockResolvedValue({
    metric: 'mrr',
    unit: 'cents',
    total: 42,
    series: [],
    meta: { computedAt: 'x', tier: 'live' },
  }),
} as any;

describe('SavedReportsService', () => {
  it('run resolves range, runs fresh, writes a snapshot', async () => {
    const repo = new MockAnalyticsReportsRepository();
    const svc = new SavedReportsService(repo, query);
    const saved = await svc.create({
      name: 'MRR',
      metricKey: 'financial',
      metric: 'mrr',
      query: { rangePreset: 'mtd', grain: 'day' },
      createdBy: 'u1',
    });
    const { result, runId } = await svc.run(
      saved.id,
      new Date('2026-07-09T00:00:00Z'),
    );
    expect(result.total).toBe(42);
    expect(query.run).toHaveBeenCalledWith(
      'financial',
      expect.objectContaining({ metric: 'mrr', grain: 'day' }),
      { fresh: true },
    );
    const runs = await repo.listRuns(saved.id);
    expect(runs.find((r) => r.id === runId)?.status).toBe('success');
  });

  it('run throws ReportNotFoundError for a missing id', async () => {
    const svc = new SavedReportsService(
      new MockAnalyticsReportsRepository(),
      query,
    );
    await expect(svc.run('nope', new Date())).rejects.toThrow(
      ReportNotFoundError,
    );
  });
});

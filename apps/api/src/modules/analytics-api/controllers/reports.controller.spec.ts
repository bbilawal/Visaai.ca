import { ReportsController } from './reports.controller';

const saved = {
  create: jest.fn().mockResolvedValue({ id: 'r1' }),
  list: jest.fn(),
  get: jest.fn().mockResolvedValue({ id: 'r1', name: 'MRR' }),
  update: jest.fn(),
  delete: jest.fn(),
  run: jest.fn().mockResolvedValue({
    result: { total: 1 },
    runId: 'run1',
    saved: { id: 'r1' },
  }),
} as any;
const exportSvc = {} as any;
const repo = { listRuns: jest.fn().mockResolvedValue([]) } as any;

describe('ReportsController', () => {
  const c = new ReportsController(saved, exportSvc, repo);
  it('create delegates to service with createdBy', async () => {
    await c.create(
      {
        name: 'MRR',
        metricKey: 'financial',
        metric: 'mrr',
        query: { rangePreset: 'mtd', grain: 'day' },
      },
      { id: 'u1' } as any,
    );
    expect(saved.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'MRR', createdBy: 'u1' }),
    );
  });
  it('run delegates with now', async () => {
    const out = await c.run('r1');
    expect(out.runId).toBe('run1');
  });
});

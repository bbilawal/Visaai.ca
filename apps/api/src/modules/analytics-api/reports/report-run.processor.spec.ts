import { ReportRunProcessor } from './report-run.processor';

describe('ReportRunProcessor', () => {
  const queue = { add: jest.fn().mockResolvedValue(undefined) } as any;

  it('run job: runs the report then delivers it', async () => {
    const saved = {
      run: jest.fn().mockResolvedValue({
        result: { total: 1 },
        runId: 'run1',
        saved: { id: 'r1' },
      }),
    } as any;
    const delivery = {
      deliver: jest.fn().mockResolvedValue({ delivered: true }),
    } as any;
    const repo = {
      getScheduleForReport: jest.fn().mockResolvedValue({
        id: 's1',
        format: 'pdf',
        recipients: ['a@b.c'],
        notifyUserIds: [],
      }),
    } as any;
    const proc = new ReportRunProcessor(queue, saved, delivery, repo);
    await proc.process({
      name: 'run',
      data: { savedReportId: 'r1', scheduledReportId: 's1' },
    } as any);
    expect(saved.run).toHaveBeenCalledWith('r1', expect.any(Date), 's1');
    expect(delivery.deliver).toHaveBeenCalled();
  });

  it('tick job: enqueues a run per due schedule + advances next_run_at', async () => {
    const saved = {} as any;
    const delivery = {} as any;
    const repo = {
      listDueSchedules: jest
        .fn()
        .mockResolvedValue([
          { id: 's1', savedReportId: 'r1', cron: '0 8 * * *' },
        ]),
      setNextRun: jest.fn().mockResolvedValue(undefined),
    } as any;
    queue.add.mockClear();
    const proc = new ReportRunProcessor(queue, saved, delivery, repo);
    await proc.process({ name: 'tick', data: {} } as any);
    expect(queue.add).toHaveBeenCalledWith(
      'run',
      { savedReportId: 'r1', scheduledReportId: 's1' },
      expect.any(Object),
    );
    expect(repo.setNextRun).toHaveBeenCalledWith('s1', expect.any(String));
  });
});

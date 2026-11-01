import { ReconciliationProcessor } from './reconciliation.processor';

describe('ReconciliationProcessor', () => {
  it('reconciles the prior UTC day [00:00, next 00:00)', async () => {
    const reconcile = jest
      .fn()
      .mockResolvedValue({ runId: 'r1', matched: 3, exceptions: [] });
    const proc = new ReconciliationProcessor({ reconcile } as any);

    // Freeze "now" at 2026-07-05T04:00:00Z; prior day = 2026-07-04.
    jest.useFakeTimers().setSystemTime(new Date('2026-07-05T04:00:00Z'));
    await proc.process();
    jest.useRealTimers();

    const range = reconcile.mock.calls[0][0];
    expect(range.start.toISOString()).toBe('2026-07-04T00:00:00.000Z');
    expect(range.end.toISOString()).toBe('2026-07-05T00:00:00.000Z');
  });
});

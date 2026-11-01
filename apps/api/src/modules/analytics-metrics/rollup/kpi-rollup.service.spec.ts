import { KpiRollupService } from './kpi-rollup.service';

describe('KpiRollupService.recompute', () => {
  it('dedupes churn (voluntary wins) before writing churn_total', async () => {
    const reader = {
      churnEventsSince: jest.fn().mockResolvedValue([
        { subscriptionId: 'sub_1', day: '2026-07-03', kind: 'involuntary' },
        { subscriptionId: 'sub_1', day: '2026-07-05', kind: 'voluntary' },
      ]),
      activeAtStart: jest
        .fn()
        .mockResolvedValue([{ day: '2026-07-01', dimVal: '', value: 100 }]),
      identifiedSince: jest
        .fn()
        .mockResolvedValue([{ anonymousId: 'a1', userId: 'u1' }]),
      funnelCountsSince: jest.fn().mockResolvedValue([]),
      mrrSnapshot: jest
        .fn()
        .mockResolvedValue([{ day: '2026-07-05', dimVal: '', value: 14700 }]),
      commissionSplitsSince: jest.fn().mockResolvedValue([]),
    } as any;
    const writer = {
      upsertMetricDaily: jest.fn().mockResolvedValue(undefined),
      upsertFunnelDaily: jest.fn().mockResolvedValue(undefined),
      upsertIdentityLinks: jest.fn().mockResolvedValue(undefined),
    } as any;

    const svc = new KpiRollupService(reader, writer);
    const out = await svc.recompute(3);

    const churnRows = writer.upsertMetricDaily.mock.calls
      .flatMap((c: any[]) => c[0])
      .filter((r: any) => r.metric === 'churn_total');
    expect(churnRows).toEqual([
      {
        metric: 'churn_total',
        day: '2026-07-05',
        dimKey: '',
        dimVal: '',
        value: 1,
      },
    ]);
    expect(writer.upsertIdentityLinks).toHaveBeenCalledWith([
      { anonymousId: 'a1', userId: 'u1' },
    ]);
    expect(out.identityLinks).toBe(1);
  });
});

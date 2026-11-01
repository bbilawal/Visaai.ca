import { KpiCohortService } from './kpi-cohort.service';

describe('KpiCohortService.recompute', () => {
  it('writes cohort rows from the reader and is idempotent by PK (upsert)', async () => {
    const rows = [
      {
        cohortMonth: '2026-06-01',
        periodIndex: 0,
        dimKey: '',
        dimVal: '',
        cohortSize: 10,
        retained: 10,
        retainedCents: 100000,
      },
    ];
    const reader = {
      subscriptionCohorts: jest.fn().mockResolvedValue(rows),
    } as any;
    const writer = {
      upsertCohorts: jest.fn().mockResolvedValue(undefined),
    } as any;
    const svc = new KpiCohortService(reader, writer);
    const n = await svc.recompute();
    expect(writer.upsertCohorts).toHaveBeenCalledWith(rows);
    expect(n).toBe(1);
  });
});

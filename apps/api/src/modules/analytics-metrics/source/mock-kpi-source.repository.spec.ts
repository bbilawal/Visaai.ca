import { MockKpiSourceRepository } from './mock-kpi-source.repository';

describe('MockKpiSourceRepository', () => {
  it('filters metricDaily by metric, range, and dimKey', async () => {
    const repo = new MockKpiSourceRepository({
      metricDaily: [
        {
          metric: 'mrr',
          day: '2026-07-01',
          dimKey: '',
          dimVal: '',
          value: 1000,
        },
        {
          metric: 'mrr',
          day: '2026-08-01',
          dimKey: '',
          dimVal: '',
          value: 2000,
        },
        {
          metric: 'mrr',
          day: '2026-07-01',
          dimKey: 'plan',
          dimVal: 'pro',
          value: 400,
        },
      ],
    });
    const out = await repo.queryMetricDaily(
      'mrr',
      '2026-07-01',
      '2026-07-31',
      '',
    );
    expect(out).toEqual([{ day: '2026-07-01', dimVal: '', value: 1000 }]);
  });

  it('returns empty when nothing matches', async () => {
    const repo = new MockKpiSourceRepository({});
    expect(
      await repo.queryFunnelDaily('approval', '2026-07-01', '2026-07-31', ''),
    ).toEqual([]);
  });

  it('filters retention cohorts by dimKey + cohort month range', async () => {
    const repo = new MockKpiSourceRepository({
      retentionCohort: [
        {
          cohortMonth: '2026-06-01',
          periodIndex: 0,
          dimKey: '',
          dimVal: '',
          cohortSize: 10,
          retained: 10,
          retainedCents: 100000,
        },
      ],
    });
    const out = await repo.queryRetentionCohort('2026-06-01', '2026-07-31', '');
    expect(out).toHaveLength(1);
    expect(out[0].retainedCents).toBe(100000);
  });
});

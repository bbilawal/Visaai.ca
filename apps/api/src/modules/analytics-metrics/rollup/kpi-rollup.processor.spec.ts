import { KpiRollupProcessor } from './kpi-rollup.processor';

describe('KpiRollupProcessor', () => {
  it('calls recompute with the configured lookback', async () => {
    const rollup = {
      recompute: jest
        .fn()
        .mockResolvedValue({ metricRows: 3, funnelRows: 0, identityLinks: 1 }),
    } as any;
    const config = { get: jest.fn().mockReturnValue(3) } as any;
    const proc = new KpiRollupProcessor(rollup, config);
    await proc.process();
    expect(rollup.recompute).toHaveBeenCalledWith(3);
  });
});

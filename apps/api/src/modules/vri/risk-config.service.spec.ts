import { RiskConfigService } from './risk-config.service';
import type { IRiskConfigRepository } from './risk-config.repository';
import { DEFAULT_RISK_WEIGHTS, DEFAULT_THRESHOLDS } from './risk-config.types';

/** Hand-rolled repo fake (pricing.service.spec style). */
function makeRepo(
  overrides: Partial<IRiskConfigRepository> = {},
): IRiskConfigRepository {
  return {
    getWeights: jest.fn().mockResolvedValue(DEFAULT_RISK_WEIGHTS),
    getThresholds: jest.fn().mockResolvedValue(DEFAULT_THRESHOLDS),
    updateWeight: jest.fn().mockResolvedValue(undefined),
    updateThreshold: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('RiskConfigService.getSnapshot', () => {
  it('loads weights + thresholds from the repo', async () => {
    const repo = makeRepo({
      getWeights: jest
        .fn()
        .mockResolvedValue({ ...DEFAULT_RISK_WEIGHTS, documentation_pct: 0.3 }),
      getThresholds: jest
        .fn()
        .mockResolvedValue({ ...DEFAULT_THRESHOLDS, escalate_below: 40 }),
    });
    const service = new RiskConfigService(repo);

    const snap = await service.getSnapshot();
    expect(snap.weights.documentation_pct).toBe(0.3);
    expect(snap.thresholds.escalate_below).toBe(40);
    expect(snap.thresholds.weak_threshold).toBe(70);
  });

  it('falls back to defaults for any MISSING row (partial config)', async () => {
    const service = new RiskConfigService(
      makeRepo({
        getWeights: jest.fn().mockResolvedValue({ financial_pct: 0.5 }),
        getThresholds: jest.fn().mockResolvedValue({}),
      }),
    );

    const snap = await service.getSnapshot();
    // present key honored…
    expect(snap.weights.financial_pct).toBe(0.5);
    // …missing keys fall back to the hardcoded defaults
    expect(snap.weights.documentation_pct).toBe(
      DEFAULT_RISK_WEIGHTS.documentation_pct,
    );
    expect(snap.thresholds).toEqual(DEFAULT_THRESHOLDS);
  });

  it('NEVER crashes the pipeline: a DB error yields the default snapshot', async () => {
    const service = new RiskConfigService(
      makeRepo({
        getWeights: jest.fn().mockRejectedValue(new Error('db down')),
      }),
    );

    const snap = await service.getSnapshot();
    expect(snap.weights).toEqual(DEFAULT_RISK_WEIGHTS);
    expect(snap.thresholds).toEqual(DEFAULT_THRESHOLDS);
  });

  it('caches reads, and re-reads after an admin write invalidates the cache', async () => {
    const getWeights = jest.fn().mockResolvedValue(DEFAULT_RISK_WEIGHTS);
    const getThresholds = jest.fn().mockResolvedValue(DEFAULT_THRESHOLDS);
    const updateWeight = jest.fn().mockResolvedValue(undefined);
    const service = new RiskConfigService(
      makeRepo({ getWeights, getThresholds, updateWeight }),
    );

    await service.getSnapshot();
    await service.getSnapshot();
    expect(getWeights).toHaveBeenCalledTimes(1); // second read served from cache

    await service.updateWeight('documentation', 0.3); // invalidates + re-reads
    expect(updateWeight).toHaveBeenCalledWith('documentation', 0.3);
    expect(getWeights).toHaveBeenCalledTimes(2);
  });
});

import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  RISK_CONFIG_REPOSITORY,
  type IRiskConfigRepository,
} from './risk-config.repository';
import {
  DEFAULT_RISK_SNAPSHOT,
  DEFAULT_RISK_WEIGHTS,
  DEFAULT_THRESHOLDS,
  type EscalationThresholds,
  type RiskConfigSnapshot,
  type RiskDimension,
  type RiskWeights,
} from './risk-config.types';

/**
 * Loads the risk-config snapshot (weights + escalation thresholds) the VRI graph
 * consumes, with:
 *  - an in-memory TTL cache (config is edited rarely; reads happen per calculate()),
 *  - a per-key fallback to the hardcoded DEFAULT_* so a missing row — or an
 *    unreachable DB — never crashes the pipeline (it just scores as before).
 *
 * Mirrors the pricing config-from-DB pattern; the snapshot is a pure input to the
 * (still pure) scoring math. Admin writes invalidate the cache so edits take effect
 * on the next calculate() with no deploy.
 */
@Injectable()
export class RiskConfigService {
  private readonly logger = new Logger(RiskConfigService.name);
  private static readonly TTL_MS = 60_000;
  private cache: { snapshot: RiskConfigSnapshot; expires: number } | null =
    null;

  constructor(
    @Inject(RISK_CONFIG_REPOSITORY)
    private readonly repo: IRiskConfigRepository,
  ) {}

  /** Resolve the active config snapshot (cached). Always returns a complete,
   *  type-safe snapshot — defaults fill any gap. */
  async getSnapshot(): Promise<RiskConfigSnapshot> {
    if (this.cache && this.cache.expires > Date.now()) {
      return this.cache.snapshot;
    }

    let snapshot: RiskConfigSnapshot;
    try {
      const [weights, thresholds] = await Promise.all([
        this.repo.getWeights(),
        this.repo.getThresholds(),
      ]);
      snapshot = {
        weights: mergeWeights(weights),
        thresholds: mergeThresholds(thresholds),
      };
    } catch (err) {
      // Never let a config read break scoring — fall back to the old constants.
      this.logger.warn(
        `risk-config load failed; using defaults: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      snapshot = DEFAULT_RISK_SNAPSHOT;
    }

    this.cache = { snapshot, expires: Date.now() + RiskConfigService.TTL_MS };
    return snapshot;
  }

  async updateWeight(
    dimension: RiskDimension,
    value: number,
  ): Promise<{
    ok: true;
    weights: RiskWeights;
  }> {
    await this.repo.updateWeight(dimension, value);
    this.invalidate();
    const { weights } = await this.getSnapshot();
    return { ok: true, weights };
  }

  async updateThreshold(
    key: string,
    value: number,
  ): Promise<{
    ok: true;
    thresholds: EscalationThresholds;
  }> {
    await this.repo.updateThreshold(key, value);
    this.invalidate();
    const { thresholds } = await this.getSnapshot();
    return { ok: true, thresholds };
  }

  /** Drop the cache so the next getSnapshot() re-reads the DB. */
  invalidate(): void {
    this.cache = null;
  }
}

function mergeWeights(p: Partial<RiskWeights>): RiskWeights {
  return {
    documentation_pct:
      p.documentation_pct ?? DEFAULT_RISK_WEIGHTS.documentation_pct,
    financial_pct: p.financial_pct ?? DEFAULT_RISK_WEIGHTS.financial_pct,
    home_ties_pct: p.home_ties_pct ?? DEFAULT_RISK_WEIGHTS.home_ties_pct,
    consistency_pct: p.consistency_pct ?? DEFAULT_RISK_WEIGHTS.consistency_pct,
    employment_pct: p.employment_pct ?? DEFAULT_RISK_WEIGHTS.employment_pct,
    travel_history_pct:
      p.travel_history_pct ?? DEFAULT_RISK_WEIGHTS.travel_history_pct,
  };
}

function mergeThresholds(
  p: Partial<EscalationThresholds>,
): EscalationThresholds {
  return {
    weak_threshold: p.weak_threshold ?? DEFAULT_THRESHOLDS.weak_threshold,
    escalate_below: p.escalate_below ?? DEFAULT_THRESHOLDS.escalate_below,
    max_revisions: p.max_revisions ?? DEFAULT_THRESHOLDS.max_revisions,
  };
}

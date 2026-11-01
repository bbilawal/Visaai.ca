import type { FactorScores, VriState } from '../vri.state';
import { decideEscalation } from '../escalation';
import {
  DEFAULT_RISK_WEIGHTS,
  DEFAULT_THRESHOLDS,
  type EscalationThresholds,
  type RiskWeights,
} from '../../risk-config.types';

/**
 * Pure weighted aggregate. The MATH is unchanged from the old hardcoded version —
 * only the weights are now an explicit input (resolved from config upstream).
 * With `weights === DEFAULT_RISK_WEIGHTS` this is byte-for-byte the old behavior.
 */
export function computeOverallScore(
  scores: FactorScores,
  weights: RiskWeights,
  unassessed: readonly (keyof FactorScores)[] = [],
): number {
  const keys = Object.keys(weights) as (keyof FactorScores)[];
  const skip = new Set(unassessed);
  const scored = keys.filter((k) => !skip.has(k));

  // Every factor unassessed => nothing was measured. 0 is the only honest
  // answer; inventing a midpoint would be the same class of defect this
  // function was changed to remove.
  if (scored.length === 0) return 0;

  // FAKE-002: renormalise over the factors that were actually assessed, so an
  // unmeasured dimension neither adds unearned points nor silently drags the
  // score down by contributing its weight at zero. With no unassessed factors
  // the divisor is 1 and this is byte-for-byte the original weighted sum.
  const totalWeight = scored.reduce((sum, k) => sum + weights[k], 0);
  if (totalWeight <= 0) return 0;

  const overall = Math.round(
    scored.reduce((sum, k) => sum + scores[k] * weights[k], 0) / totalWeight,
  );
  return Math.max(0, Math.min(100, overall));
}

/**
 * Aggregate node factory. Inputs (weights + thresholds) come from config; the math
 * stays pure. Also runs the auto-escalate-on-low-score decision so the save node
 * can persist the flag.
 */
export function makeAggregateScoreNode(
  weights: RiskWeights = DEFAULT_RISK_WEIGHTS,
  thresholds: EscalationThresholds = DEFAULT_THRESHOLDS,
) {
  return async function aggregateScore(
    state: VriState,
  ): Promise<Partial<VriState>> {
    const overallScore = computeOverallScore(
      state.scores,
      weights,
      state.unassessedFactors ?? [],
    );
    const { escalate, reason } = decideEscalation(overallScore, thresholds);
    return { overallScore, escalate, escalationReason: reason };
  };
}

/**
 * Risk-config types + safe defaults (module-local; not in @visaai/types by design —
 * these are scoring internals that should not leak to the web client).
 *
 * The defaults reproduce the values that were previously hardcoded:
 *   - DEFAULT_RISK_WEIGHTS  === aggregate-score.ts WEIGHTS
 *   - DEFAULT_THRESHOLDS.weak_threshold === generate-recommendations.ts WEAK_THRESHOLD
 * They are the fallback the RiskConfigService uses so a missing DB row (or an
 * unreachable DB) can never crash the VRI pipeline.
 */
import type { FactorScores } from './graphs/vri.state';

/** Weights keyed by the FactorScores `*_pct` keys so they plug straight into the
 *  aggregate math with no remapping. */
export type RiskWeights = Record<keyof FactorScores, number>;

/** Admin-facing dimension names (DB `risk_weights.dimension`). */
export const RISK_DIMENSIONS = [
  'documentation',
  'financial',
  'travel_history',
  'home_ties',
  'employment',
  'consistency',
] as const;
export type RiskDimension = (typeof RISK_DIMENSIONS)[number];

/** DB dimension name -> FactorScores key (the only place the two vocabularies meet). */
export const DIMENSION_TO_SCORE_KEY: Record<RiskDimension, keyof FactorScores> =
  {
    documentation: 'documentation_pct',
    financial: 'financial_pct',
    travel_history: 'travel_history_pct',
    home_ties: 'home_ties_pct',
    employment: 'employment_pct',
    consistency: 'consistency_pct',
  };

export interface EscalationThresholds {
  /** A dimension is "weak" when its `*_pct` is below this (drives recommendations). */
  weak_threshold: number;
  /** Auto-escalate the application to a consultant when overall_score is below this. */
  escalate_below: number;
  /** Reserved: narrative self-review cap (ROADMAP M1). Not consumed by VRI yet. */
  max_revisions: number;
}

export interface RiskConfigSnapshot {
  weights: RiskWeights;
  thresholds: EscalationThresholds;
}

/** Current hardcoded weights (aggregate-score.ts). Used as fallback + seed parity. */
export const DEFAULT_RISK_WEIGHTS: RiskWeights = {
  documentation_pct: 0.25,
  financial_pct: 0.2,
  home_ties_pct: 0.2,
  consistency_pct: 0.15,
  employment_pct: 0.12,
  travel_history_pct: 0.08,
};

/** Current hardcoded thresholds. weak_threshold mirrors the old WEAK_THRESHOLD=70. */
export const DEFAULT_THRESHOLDS: EscalationThresholds = {
  weak_threshold: 70,
  escalate_below: 50,
  max_revisions: 5,
};

/** Snapshot used when no config is supplied / DB is unreachable (== old behavior). */
export const DEFAULT_RISK_SNAPSHOT: RiskConfigSnapshot = {
  weights: DEFAULT_RISK_WEIGHTS,
  thresholds: DEFAULT_THRESHOLDS,
};

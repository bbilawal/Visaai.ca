import type {
  EscalationThresholds,
  RiskDimension,
  RiskWeights,
} from './risk-config.types';

/** DI token for the risk-config repository (mirrors PRICING_REPOSITORY). */
export const RISK_CONFIG_REPOSITORY = Symbol('RISK_CONFIG_REPOSITORY');

/**
 * Reads/writes the config-driven risk tables. Reads return a Partial so the
 * service can fall back to DEFAULT_* for any missing key (never crash the
 * pipeline). All access is service-role (system path) — these tables are
 * admin-only at the RLS layer.
 */
export interface IRiskConfigRepository {
  /** Active dimension weights, keyed by FactorScores key. May be partial/empty. */
  getWeights(): Promise<Partial<RiskWeights>>;
  /** Active escalation thresholds. May be partial/empty. */
  getThresholds(): Promise<Partial<EscalationThresholds>>;
  /** Admin write: set an active dimension weight. */
  updateWeight(dimension: RiskDimension, weight: number): Promise<void>;
  /** Admin write: set an active threshold value (key/value, like pricing_constants). */
  updateThreshold(key: string, value: number): Promise<void>;
}

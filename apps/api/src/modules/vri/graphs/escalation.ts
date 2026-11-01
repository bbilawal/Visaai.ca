import type { EscalationThresholds } from '../risk-config.types';

export interface EscalationDecision {
  /** True when the application should be flagged for consultant escalation. */
  escalate: boolean;
  /** Non-numeric reason code (does not leak the exact cutoff to applicants). */
  reason: string | null;
}

/**
 * The MISSING auto-escalate-on-low-score HITL rule, as a pure function of the
 * overall score + thresholds (no DB, no clock — the pricing-engine discipline).
 *
 * When overall_score < escalate_below, the application is flagged so a consultant
 * can be assigned. The reason is a code (not the number) so it can be surfaced to
 * the applicant without revealing the threshold.
 */
export function decideEscalation(
  overallScore: number,
  thresholds: EscalationThresholds,
): EscalationDecision {
  if (overallScore < thresholds.escalate_below) {
    return { escalate: true, reason: 'low_overall_readiness' };
  }
  return { escalate: false, reason: null };
}

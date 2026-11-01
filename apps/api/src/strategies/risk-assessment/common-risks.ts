import type { RiskSignal, EvidenceRule } from '../types';

/**
 * Refusal-risk signals common to most visitor-class programs. Country/program
 * strategies reuse and extend these. Weights are advisory inputs to the VRI score.
 */
export const COMMON_RISKS: Record<string, RiskSignal> = {
  weak_home_ties: {
    id: 'weak_home_ties',
    description:
      'Insufficient ties to home country (employment, family, property)',
    weight: 0.3,
  },
  insufficient_funds: {
    id: 'insufficient_funds',
    description: 'Funds below the expected threshold for the trip',
    weight: 0.25,
  },
  inconsistent_info: {
    id: 'inconsistent_info',
    description: 'Inconsistencies between stated facts and documents',
    weight: 0.2,
  },
  unclear_purpose: {
    id: 'unclear_purpose',
    description: 'Purpose of travel not clearly established',
    weight: 0.15,
  },
  prior_refusal: {
    id: 'prior_refusal',
    description: 'Prior visa refusal not adequately addressed',
    weight: 0.1,
  },
};

export const COMMON_EVIDENCE: Record<string, EvidenceRule> = {
  employment: {
    id: 'employment',
    description: 'Employment letter + recent pay stubs',
    strengthens: 'weak_home_ties',
  },
  property: {
    id: 'property',
    description: 'Property ownership or lease',
    strengthens: 'weak_home_ties',
  },
  funds_history: {
    id: 'funds_history',
    description: '4-6 months of consistent bank history',
    strengthens: 'insufficient_funds',
  },
  itinerary: {
    id: 'itinerary',
    description: 'Detailed day-by-day itinerary',
    strengthens: 'unclear_purpose',
  },
};

export function risks(...ids: (keyof typeof COMMON_RISKS)[]): RiskSignal[] {
  return ids.map((i) => COMMON_RISKS[i]);
}
export function evidence(
  ...ids: (keyof typeof COMMON_EVIDENCE)[]
): EvidenceRule[] {
  return ids.map((i) => COMMON_EVIDENCE[i]);
}

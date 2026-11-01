import type { MatchRequest } from '@visaai/types';
import type { MatchCandidate } from './matching.engine';

export const MATCHING_REPOSITORY = Symbol('MATCHING_REPOSITORY');

/** Application context needed to build a MatchRequest + authorize the caller. */
export interface MatchContext {
  ownerUserId: string;
  request: MatchRequest;
}

export interface IMatchingRepository {
  /** Build the MatchRequest + owner for an application; null if not found. */
  getMatchContext(applicationId: string): Promise<MatchContext | null>;
  /** Active marketplace consultants with skills/availability + live case load. */
  listActiveCandidates(): Promise<MatchCandidate[]>;
  /** pricing_visa_tiers.lawyer_flag for a visa (false if unknown). */
  getVisaLawyerFlag(visaType: string | null): Promise<boolean>;
}

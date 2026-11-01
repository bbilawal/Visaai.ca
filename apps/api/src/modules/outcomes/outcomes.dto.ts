import { z } from 'zod';

/**
 * API-001: this route accepted `@Body()` typed only as a TypeScript interface,
 * which is erased at runtime — so nothing validated it. An invalid `outcome`
 * reached the database and was rejected by the CHECK constraint, surfacing as a
 * 500 after a round-trip instead of a 400 the client could act on.
 *
 * Follows the repository's existing zod DTO idiom (see matching.dto.ts /
 * privacy.controller.ts); the codebase does not use class-validator.
 */

export const OUTCOME_VALUES = [
  'approved',
  'refused',
  'withdrawn',
  'pending',
] as const;

/** Fixed list so refusal_reasons never carries free-text PII. */
export const REFUSAL_REASON_CODES = [
  'insufficient_funds',
  'weak_home_ties',
  'travel_history',
  'purpose_unclear',
  'inconsistent_info',
  'incomplete_docs',
  'other',
] as const;

export const ReportOutcomeDto = z.object({
  outcome: z.enum(OUTCOME_VALUES),
  // Date-only (YYYY-MM-DD); the column is a `date`.
  decidedAt: z.string().date().nullish(),
  // Rejected outright rather than silently filtered: a caller sending an
  // unknown code has a bug or is probing, and should be told.
  refusalReasons: z.array(z.enum(REFUSAL_REASON_CODES)).max(20).optional(),
});

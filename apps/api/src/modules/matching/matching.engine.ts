/**
 * Matching engine — pure implementation of VISAAIDocs/features/case-assignment/MATCHING.md.
 * Ranks consultant candidates for an application. PROPOSES ONLY — never mutates
 * assignment state. No DB, no clock; deterministic (mirrors pricing/commission).
 */
import type { ConsultantMatch, MatchRequest } from '@visaai/types';

/** A scorable candidate, assembled by the repository from marketplace tables. */
export interface MatchCandidate {
  consultant_id: string; // consultant_profiles.id
  rating_avg: number;
  rating_count: number;
  hourly_rate_usd: number | null;
  years_experience: number | null;
  max_active_cases: number;
  license_verified: boolean;
  active_cases: number;
  accepting_new: boolean;
  visa_types: string[];
  languages: string[];
  countries_supported: string[];
}

export interface MatchWeights {
  visa_fit: number;
  country_fit: number;
  language_fit: number;
  rating: number;
  availability: number;
  complexity_fit: number;
}

/** Default component weights — must sum to 1.0 (MATCHING.md §3). */
export const DEFAULT_WEIGHTS: MatchWeights = {
  visa_fit: 0.3,
  country_fit: 0.1,
  language_fit: 0.15,
  rating: 0.2,
  availability: 0.15,
  complexity_fit: 0.1,
};

export interface RankOptions {
  /** pricing_visa_tiers.lawyer_flag for the request's visa — gates unlicensed. */
  lawyerFlag?: boolean;
  weights?: MatchWeights;
}

function round4(n: number): number {
  return Math.round((n + Number.EPSILON) * 1e4) / 1e4;
}

/** Caller-supplied weights must sum to ~1.0 (guards config mistakes). */
export function assertWeightsValid(w: MatchWeights): void {
  const sum =
    w.visa_fit +
    w.country_fit +
    w.language_fit +
    w.rating +
    w.availability +
    w.complexity_fit;
  if (Math.abs(sum - 1) > 1e-6)
    throw new Error(`match weights must sum to 1.0 (got ${sum})`);
}

/** Map a 0..1 complexity to a min years-experience band; reward in/over band. */
function complexityFit(
  complexity: number | null,
  yearsExperience: number | null,
  lawyerFlag: boolean,
  licenseVerified: boolean,
): number {
  // Lawyer-flagged visas require a verified license, regardless of experience.
  if (lawyerFlag && !licenseVerified) return 0;
  if (complexity == null) return 1; // neutral when unknown
  const threshold = complexity > 0.66 ? 7 : complexity >= 0.33 ? 3 : 0;
  const ye = yearsExperience ?? 0;
  if (ye >= threshold) return 1;
  if (ye >= threshold - 2) return 0.5;
  return 0.2;
}

function languageFit(req: MatchRequest, c: MatchCandidate): number {
  if (req.user_language && c.languages.includes(req.user_language)) return 1;
  if (c.languages.includes('en')) return 0.5; // lingua-franca fallback
  return 0.2;
}

/** True if the candidate clears the hard filters (MATCHING.md §2). */
export function passesHardFilters(
  c: MatchCandidate,
  req: MatchRequest,
): boolean {
  if (!c.accepting_new) return false;
  if (c.max_active_cases > 0 && c.active_cases >= c.max_active_cases)
    return false;
  // null destination => no country filter (rank globally; flagged upstream).
  if (
    req.destination_country &&
    !c.countries_supported.includes(req.destination_country)
  )
    return false;
  return true;
}

/** Score a single candidate (rank filled by the caller after sorting). */
export function scoreCandidate(
  c: MatchCandidate,
  req: MatchRequest,
  opts: RankOptions = {},
): ConsultantMatch {
  const w = opts.weights ?? DEFAULT_WEIGHTS;
  const lawyerFlag = opts.lawyerFlag ?? false;

  const breakdown = {
    visa_fit: req.visa_type && c.visa_types.includes(req.visa_type) ? 1 : 0.3,
    country_fit:
      req.destination_country &&
      c.countries_supported.includes(req.destination_country)
        ? 1
        : 0,
    language_fit: languageFit(req, c),
    rating: c.rating_count > 0 ? c.rating_avg / 5 : 0.6, // cold-start neutral
    availability:
      c.max_active_cases > 0
        ? Math.max(0, 1 - c.active_cases / c.max_active_cases)
        : 0,
    complexity_fit: complexityFit(
      req.complexity_score,
      c.years_experience,
      lawyerFlag,
      c.license_verified,
    ),
  };

  const score =
    w.visa_fit * breakdown.visa_fit +
    w.country_fit * breakdown.country_fit +
    w.language_fit * breakdown.language_fit +
    w.rating * breakdown.rating +
    w.availability * breakdown.availability +
    w.complexity_fit * breakdown.complexity_fit;

  return {
    consultant_id: c.consultant_id,
    score: round4(score),
    breakdown,
    rank: 0,
  };
}

/** Free capacity (used as a tie-break). */
function freeCapacity(c: MatchCandidate): number {
  return c.max_active_cases - c.active_cases;
}

/**
 * Filter + score + rank. Tie-break (MATCHING.md §3): score → rating_avg →
 * free capacity → lower hourly_rate → years_experience. Returns ranked desc.
 */
export function rankCandidates(
  candidates: MatchCandidate[],
  req: MatchRequest,
  opts: RankOptions = {},
): ConsultantMatch[] {
  if (opts.weights) assertWeightsValid(opts.weights);

  const byId = new Map(candidates.map((c) => [c.consultant_id, c]));
  const scored = candidates
    .filter((c) => passesHardFilters(c, req))
    .map((c) => scoreCandidate(c, req, opts));

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const ca = byId.get(a.consultant_id)!;
    const cb = byId.get(b.consultant_id)!;
    if (cb.rating_avg !== ca.rating_avg) return cb.rating_avg - ca.rating_avg;
    if (freeCapacity(cb) !== freeCapacity(ca))
      return freeCapacity(cb) - freeCapacity(ca);
    const ra = ca.hourly_rate_usd ?? Infinity;
    const rb = cb.hourly_rate_usd ?? Infinity;
    if (ra !== rb) return ra - rb; // cheaper first
    return (cb.years_experience ?? 0) - (ca.years_experience ?? 0);
  });

  return scored.map((m, i) => ({ ...m, rank: i + 1 }));
}

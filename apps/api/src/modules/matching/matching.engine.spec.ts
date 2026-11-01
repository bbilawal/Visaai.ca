import type { MatchRequest } from '@visaai/types';
import {
  rankCandidates,
  scoreCandidate,
  passesHardFilters,
  assertWeightsValid,
  DEFAULT_WEIGHTS,
  type MatchCandidate,
} from './matching.engine';

function cand(p: Partial<MatchCandidate> = {}): MatchCandidate {
  return {
    consultant_id: p.consultant_id ?? 'c1',
    rating_avg: p.rating_avg ?? 4,
    rating_count: p.rating_count ?? 10,
    hourly_rate_usd: p.hourly_rate_usd ?? 100,
    years_experience: p.years_experience ?? 5,
    max_active_cases: p.max_active_cases ?? 10,
    license_verified: p.license_verified ?? false,
    active_cases: p.active_cases ?? 0,
    accepting_new: p.accepting_new ?? true,
    visa_types: p.visa_types ?? ['student'],
    languages: p.languages ?? ['en'],
    countries_supported: p.countries_supported ?? ['CA'],
  };
}

const REQ: MatchRequest = {
  visa_type: 'student',
  destination_country: 'CA',
  user_language: 'en',
  complexity_score: 0.2,
};

describe('matching.engine — hard filters', () => {
  it('drops not-accepting, at-capacity, and country-ineligible', () => {
    expect(passesHardFilters(cand({ accepting_new: false }), REQ)).toBe(false);
    expect(
      passesHardFilters(cand({ active_cases: 10, max_active_cases: 10 }), REQ),
    ).toBe(false);
    expect(passesHardFilters(cand({ countries_supported: ['US'] }), REQ)).toBe(
      false,
    );
    expect(passesHardFilters(cand(), REQ)).toBe(true);
  });

  it('no country filter when request has no destination', () => {
    expect(
      passesHardFilters(cand({ countries_supported: ['US'] }), {
        ...REQ,
        destination_country: null,
      }),
    ).toBe(true);
  });
});

describe('matching.engine — scoreCandidate', () => {
  it('perfect match scores high; breakdown is explainable', () => {
    const m = scoreCandidate(cand({ rating_avg: 5 }), REQ);
    expect(m.breakdown.visa_fit).toBe(1);
    expect(m.breakdown.country_fit).toBe(1);
    expect(m.breakdown.language_fit).toBe(1);
    expect(m.breakdown.rating).toBe(1);
    expect(m.breakdown.availability).toBe(1);
    expect(m.score).toBeGreaterThan(0.9);
  });

  it('visa mismatch falls to generalist 0.3', () => {
    expect(
      scoreCandidate(cand({ visa_types: ['work'] }), REQ).breakdown.visa_fit,
    ).toBe(0.3);
  });

  it('language fallback: en=0.5, none=0.2', () => {
    expect(
      scoreCandidate(cand({ languages: ['en'] }), {
        ...REQ,
        user_language: 'fr',
      }).breakdown.language_fit,
    ).toBe(0.5);
    expect(
      scoreCandidate(cand({ languages: ['es'] }), {
        ...REQ,
        user_language: 'fr',
      }).breakdown.language_fit,
    ).toBe(0.2);
  });

  it('cold-start rating is neutral 0.6', () => {
    expect(
      scoreCandidate(cand({ rating_count: 0, rating_avg: 0 }), REQ).breakdown
        .rating,
    ).toBe(0.6);
  });

  it('availability reflects free capacity', () => {
    expect(
      scoreCandidate(cand({ active_cases: 5, max_active_cases: 10 }), REQ)
        .breakdown.availability,
    ).toBe(0.5);
  });

  it('lawyer-flagged visa gates unlicensed consultants to complexity_fit 0', () => {
    const m = scoreCandidate(cand({ license_verified: false }), REQ, {
      lawyerFlag: true,
    });
    expect(m.breakdown.complexity_fit).toBe(0);
    const ok = scoreCandidate(cand({ license_verified: true }), REQ, {
      lawyerFlag: true,
    });
    expect(ok.breakdown.complexity_fit).toBe(1);
  });

  it('complexity band rewards seniority; juniors penalized on hard cases', () => {
    const hard = { ...REQ, complexity_score: 0.9 };
    expect(
      scoreCandidate(cand({ years_experience: 8 }), hard).breakdown
        .complexity_fit,
    ).toBe(1);
    expect(
      scoreCandidate(cand({ years_experience: 6 }), hard).breakdown
        .complexity_fit,
    ).toBe(0.5);
    expect(
      scoreCandidate(cand({ years_experience: 1 }), hard).breakdown
        .complexity_fit,
    ).toBe(0.2);
  });
});

describe('matching.engine — rankCandidates', () => {
  it('ranks by score desc and assigns 1..n', () => {
    const best = cand({
      consultant_id: 'best',
      rating_avg: 5,
      visa_types: ['student'],
    });
    const worse = cand({
      consultant_id: 'worse',
      rating_avg: 2,
      visa_types: ['work'],
    });
    const out = rankCandidates([worse, best], REQ);
    expect(out.map((m) => m.consultant_id)).toEqual(['best', 'worse']);
    expect(out.map((m) => m.rank)).toEqual([1, 2]);
  });

  it('excludes hard-filtered candidates', () => {
    const out = rankCandidates(
      [cand({ consultant_id: 'x', accepting_new: false })],
      REQ,
    );
    expect(out).toEqual([]);
  });

  it('tie-break: equal score -> higher rating, then cheaper rate', () => {
    const a = cand({ consultant_id: 'a', rating_avg: 4, hourly_rate_usd: 200 });
    const b = cand({ consultant_id: 'b', rating_avg: 4, hourly_rate_usd: 100 });
    const out = rankCandidates([a, b], REQ);
    expect(out[0].consultant_id).toBe('b'); // cheaper wins the tie
  });

  it('rejects weights that do not sum to 1', () => {
    expect(() =>
      rankCandidates([cand()], REQ, {
        weights: { ...DEFAULT_WEIGHTS, visa_fit: 0.9 },
      }),
    ).toThrow();
    expect(() => assertWeightsValid(DEFAULT_WEIGHTS)).not.toThrow();
  });
});

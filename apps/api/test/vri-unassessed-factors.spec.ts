import { computeOverallScore } from '../src/modules/vri/graphs/nodes/aggregate-score';
import { DEFAULT_RISK_WEIGHTS } from '../src/modules/vri/risk-config.types';
import { scoreConsistency } from '../src/modules/vri/graphs/scoring/score-consistency';
import { scoreDocumentation } from '../src/modules/vri/graphs/scoring/score-documentation';
import { makeGenerateRecommendationsNode } from '../src/modules/vri/graphs/nodes/generate-recommendations';
import type {
  FactorScores,
  VriState,
} from '../src/modules/vri/graphs/vri.state';

/**
 * FAKE-002 regression cover.
 *
 * `scoreConsistency` used to return `consistency_pct: 100` when there were no
 * cross-verifications at all — a perfect score for a check that never ran. The
 * user saw "Consistency: 100%" on their readiness breakdown, and the factor's
 * 0.15 weight added 15 unearned points to the overall VRI score, which decides
 * whether an application is auto-escalated for consultant review (below 50).
 *
 * An unperformed check is neither a pass nor a fail. It is now excluded from the
 * weighted aggregate, with the remaining weights renormalised.
 */

const ALL: FactorScores = {
  documentation_pct: 60,
  financial_pct: 60,
  travel_history_pct: 60,
  home_ties_pct: 60,
  employment_pct: 60,
  consistency_pct: 60,
};

const state = (over: Partial<VriState['data']>): VriState =>
  ({
    data: { crossVerifications: [], checklistItems: [], ...over },
  }) as VriState;

describe('FAKE-002 — an unperformed check is not scored', () => {
  describe('scoreConsistency', () => {
    it('does NOT return 100 when no cross-verification ran', async () => {
      const out = await scoreConsistency(state({ crossVerifications: [] }));
      expect(out.scores!.consistency_pct).not.toBe(100);
      expect(out.unassessedFactors).toEqual(['consistency_pct']);
    });

    it('still scores normally when cross-verifications exist', async () => {
      const out = await scoreConsistency(
        state({
          crossVerifications: [
            { result: 'match' },
            { result: 'match' },
            { result: 'mismatch' },
          ],
        } as Partial<VriState['data']>),
      );
      // 3 total, 1 mismatch -> (3 - 2) / 3 = 33%
      expect(out.scores!.consistency_pct).toBe(33);
      expect(out.unassessedFactors ?? []).toEqual([]);
    });
  });

  describe('scoreDocumentation', () => {
    it('marks itself unassessed when nothing was required', async () => {
      const out = await scoreDocumentation(state({ checklistItems: [] }));
      expect(out.unassessedFactors).toEqual(['documentation_pct']);
    });
  });

  describe('computeOverallScore', () => {
    it('is unchanged when every factor was assessed', () => {
      // The default weights sum to exactly 1.0, so the renormalising divisor is
      // 1 and this must stay byte-for-byte the original weighted sum.
      expect(computeOverallScore(ALL, DEFAULT_RISK_WEIGHTS)).toBe(60);
      expect(computeOverallScore(ALL, DEFAULT_RISK_WEIGHTS, [])).toBe(60);
    });

    it('excludes an unassessed factor rather than counting it', () => {
      // consistency at 0 would drag a 60-across-the-board score down to 51 if
      // it were counted; excluded, the score stays 60.
      const scores = { ...ALL, consistency_pct: 0 };
      expect(computeOverallScore(scores, DEFAULT_RISK_WEIGHTS)).toBe(51);
      expect(
        computeOverallScore(scores, DEFAULT_RISK_WEIGHTS, ['consistency_pct']),
      ).toBe(60);
    });

    it('no longer awards the 15 unearned points the old code did', () => {
      // OLD behaviour: consistency fabricated as 100 while everything else is 40.
      const old = computeOverallScore(
        {
          ...ALL,
          documentation_pct: 40,
          financial_pct: 40,
          travel_history_pct: 40,
          home_ties_pct: 40,
          employment_pct: 40,
          consistency_pct: 100,
        },
        DEFAULT_RISK_WEIGHTS,
      );
      // NEW behaviour: consistency excluded entirely.
      const now = computeOverallScore(
        {
          ...ALL,
          documentation_pct: 40,
          financial_pct: 40,
          travel_history_pct: 40,
          home_ties_pct: 40,
          employment_pct: 40,
          consistency_pct: 0,
        },
        DEFAULT_RISK_WEIGHTS,
        ['consistency_pct'],
      );
      expect(old).toBe(49);
      expect(now).toBe(40);
      // The unearned 9 points here are what could push an application above the
      // escalate_below: 50 line without any consistency check having run.
      expect(old).toBeGreaterThan(now);
    });

    it('can flip an escalation decision — the reason this matters', () => {
      // escalate_below is 50. Everything measured sits at 45.
      const measured = 45;
      const scores: FactorScores = {
        documentation_pct: measured,
        financial_pct: measured,
        travel_history_pct: measured,
        home_ties_pct: measured,
        employment_pct: measured,
        consistency_pct: 100, // fabricated
      };
      const withFabrication = computeOverallScore(scores, DEFAULT_RISK_WEIGHTS);
      const honest = computeOverallScore(
        { ...scores, consistency_pct: 0 },
        DEFAULT_RISK_WEIGHTS,
        ['consistency_pct'],
      );
      expect(withFabrication).toBeGreaterThanOrEqual(50); // would NOT escalate
      expect(honest).toBeLessThan(50); // DOES escalate
    });

    it('does not advise on a factor that was never assessed', async () => {
      // The inverse defect: consistency now stores 0, which sits below the
      // weak threshold of 70. Without the exclusion the engine would tell the
      // user to "improve Application Consistency" for a check that never ran.
      const invoke = jest.fn().mockResolvedValue({ content: '[]' });
      const node = makeGenerateRecommendationsNode(
        { invoke } as never,
        null,
        70,
      );
      await node({
        scores: {
          ...ALL,
          documentation_pct: 90,
          financial_pct: 90,
          travel_history_pct: 90,
          home_ties_pct: 90,
          employment_pct: 90,
          consistency_pct: 0,
        },
        unassessedFactors: ['consistency_pct'],
        data: { profile: {} },
      } as never);
      // Every assessed factor is strong, so the only candidate was the
      // unassessed one — the LLM must not be consulted at all.
      expect(invoke).not.toHaveBeenCalled();
    });

    it('returns 0 when nothing at all was assessed', () => {
      expect(
        computeOverallScore(
          ALL,
          DEFAULT_RISK_WEIGHTS,
          Object.keys(DEFAULT_RISK_WEIGHTS) as (keyof FactorScores)[],
        ),
      ).toBe(0);
    });
  });
});

import { DEFAULT_RISK_WEIGHTS, routeRiskWeights } from './risk-config.types';
import { makeAggregateScoreNode } from './graphs/nodes/aggregate-score';
import { makeGenerateRecommendationsNode } from './graphs/nodes/generate-recommendations';
import type { VriState } from './graphs/vri.state';
import type { ChatOpenAI } from '@langchain/openai';

/**
 * Readiness weights per route (dry run 2026-10-16).
 *
 * The global weights put 40% of the score on funds and home ties — the two
 * things a visitor-visa officer weighs. IRCC's eTA form asks about neither, so
 * an eTA applicant was told to strengthen proof of funds they will never be
 * asked for, and scored down for not having it.
 */
const ETA = 'ca-electronic-travel-authorization-eta';

describe('routeRiskWeights', () => {
  it('zeroes funds and home ties for an eTA', () => {
    const w = routeRiskWeights(DEFAULT_RISK_WEIGHTS, 'CA', ETA);
    expect(w.financial_pct).toBe(0);
    expect(w.home_ties_pct).toBe(0);
    expect(w.documentation_pct).toBe(DEFAULT_RISK_WEIGHTS.documentation_pct);
  });

  it('leaves every other route on the configured weights', () => {
    expect(
      routeRiskWeights(
        DEFAULT_RISK_WEIGHTS,
        'CA',
        'ca-visitor-visa-temporary-resident-visa',
      ),
    ).toEqual(DEFAULT_RISK_WEIGHTS);
    expect(routeRiskWeights(DEFAULT_RISK_WEIGHTS, null, null)).toEqual(
      DEFAULT_RISK_WEIGHTS,
    );
  });
});

const SCORES = {
  documentation_pct: 90,
  financial_pct: 0,
  travel_history_pct: 90,
  home_ties_pct: 0,
  employment_pct: 90,
  consistency_pct: 90,
};

function state(visaaiId: string | null): VriState {
  return {
    applicationId: 'a',
    data: {
      profile: {},
      checklistItems: [],
      documents: [],
      verifications: [],
      crossVerifications: [],
      destinationCountry: 'CA',
      currentVisaType: null,
      visaaiId,
    },
    scores: SCORES,
    unassessedFactors: [],
    factorEvidence: {},
  } as unknown as VriState;
}

describe('aggregate + recommendations on an eTA', () => {
  it('does not score an eTA down for funds or home ties', async () => {
    const out = await makeAggregateScoreNode()(state(ETA));
    expect(out.overallScore).toBe(90);
  });

  it('still does for a visitor visa', async () => {
    const out = await makeAggregateScoreNode()(state('ca-visitor-visa'));
    expect(out.overallScore).toBeLessThan(90);
  });

  it('never recommends strengthening funds or home ties on an eTA', async () => {
    const llm = {
      invoke: jest.fn().mockResolvedValue({ content: '[]' }),
    } as unknown as ChatOpenAI;
    const out = await makeGenerateRecommendationsNode(llm, null)(state(ETA));
    const factors = (out.recommendations ?? []).map((r) => r.factor);
    expect(factors).not.toContain('financial_pct');
    expect(factors).not.toContain('home_ties_pct');
    expect((llm.invoke as jest.Mock).mock.calls).toHaveLength(0);
  });
});

import { computeOverallScore, makeAggregateScoreNode } from './aggregate-score';
import type { FactorScores, VriState } from '../vri.state';
import {
  DEFAULT_RISK_WEIGHTS,
  DEFAULT_THRESHOLDS,
  type RiskWeights,
} from '../../risk-config.types';

// The ORIGINAL hardcoded weights, inlined as an oracle to prove parity.
const OLD_WEIGHTS = {
  documentation_pct: 0.25,
  financial_pct: 0.2,
  home_ties_pct: 0.2,
  consistency_pct: 0.15,
  employment_pct: 0.12,
  travel_history_pct: 0.08,
};

function oldAggregate(s: FactorScores): number {
  const overall = Math.round(
    s.documentation_pct * OLD_WEIGHTS.documentation_pct +
      s.financial_pct * OLD_WEIGHTS.financial_pct +
      s.home_ties_pct * OLD_WEIGHTS.home_ties_pct +
      s.consistency_pct * OLD_WEIGHTS.consistency_pct +
      s.employment_pct * OLD_WEIGHTS.employment_pct +
      s.travel_history_pct * OLD_WEIGHTS.travel_history_pct,
  );
  return Math.max(0, Math.min(100, overall));
}

const SAMPLES: FactorScores[] = [
  {
    documentation_pct: 80,
    financial_pct: 60,
    travel_history_pct: 44,
    home_ties_pct: 70,
    employment_pct: 75,
    consistency_pct: 100,
  },
  {
    documentation_pct: 0,
    financial_pct: 0,
    travel_history_pct: 30,
    home_ties_pct: 0,
    employment_pct: 0,
    consistency_pct: 100,
  },
  {
    documentation_pct: 100,
    financial_pct: 100,
    travel_history_pct: 100,
    home_ties_pct: 100,
    employment_pct: 100,
    consistency_pct: 100,
  },
];

function stateWith(scores: FactorScores): VriState {
  return { scores } as VriState;
}

describe('computeOverallScore — parity with the old hardcoded weights', () => {
  it.each(SAMPLES)('matches the old WEIGHTS math for %j', (scores) => {
    expect(computeOverallScore(scores, DEFAULT_RISK_WEIGHTS)).toBe(
      oldAggregate(scores),
    );
  });

  it('clamps to 0..100', () => {
    const heavy: RiskWeights = {
      documentation_pct: 1,
      financial_pct: 1,
      home_ties_pct: 1,
      consistency_pct: 1,
      employment_pct: 1,
      travel_history_pct: 1,
    };
    expect(computeOverallScore(SAMPLES[2], heavy)).toBe(100);
  });

  it('honors reconfigured weights (config drives the score)', () => {
    const onlyDocs: RiskWeights = {
      documentation_pct: 1,
      financial_pct: 0,
      home_ties_pct: 0,
      consistency_pct: 0,
      employment_pct: 0,
      travel_history_pct: 0,
    };
    expect(computeOverallScore(SAMPLES[0], onlyDocs)).toBe(80);
  });
});

describe('makeAggregateScoreNode — escalate-below trigger', () => {
  it('flags escalation when overall < escalate_below', async () => {
    const node = makeAggregateScoreNode(DEFAULT_RISK_WEIGHTS, {
      ...DEFAULT_THRESHOLDS,
      escalate_below: 50,
    });
    // SAMPLES[1] aggregates to a low score (well under 50).
    const out = await node(stateWith(SAMPLES[1]));
    expect(out.overallScore).toBeLessThan(50);
    expect(out.escalate).toBe(true);
    expect(out.escalationReason).toBe('low_overall_readiness');
  });

  it('does NOT escalate when overall >= escalate_below', async () => {
    const node = makeAggregateScoreNode(DEFAULT_RISK_WEIGHTS, {
      ...DEFAULT_THRESHOLDS,
      escalate_below: 50,
    });
    const out = await node(stateWith(SAMPLES[2])); // perfect scores -> 100
    expect(out.overallScore).toBeGreaterThanOrEqual(50);
    expect(out.escalate).toBe(false);
    expect(out.escalationReason).toBeNull();
  });
});

describe('makeAggregateScoreNode — factors the route does not weigh', () => {
  const route = (visaaiId: string) =>
    ({
      ...stateWith(SAMPLES[2]),
      data: { destinationCountry: 'CA', visaaiId },
    }) as unknown as VriState;

  it('Express Entry: home ties and travel history are not assessed (prod 2026-10-19)', async () => {
    const out = await makeAggregateScoreNode()(route('ca-express-entry'));
    expect(out.unassessedFactors).toEqual(
      expect.arrayContaining(['home_ties_pct', 'travel_history_pct']),
    );
    expect(out.unassessedFactors).not.toContain('financial_pct');
  });

  it('a route with every factor weighted adds nothing', async () => {
    const out = await makeAggregateScoreNode()(
      route('ca-visitor-visa-temporary-resident-visa'),
    );
    expect(out.unassessedFactors).toBeUndefined();
  });
});

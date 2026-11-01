import {
  assertFixtureIsSafe,
  evaluateTier,
  formatRecommendation,
  recommendTier,
  type CaseRunner,
  type EvalCase,
} from './eval-harness';
import { AI_TASKS } from '../task-registry';
import type { ModelTier } from '../task-registry';

const cases: EvalCase[] = [
  {
    id: 'c1',
    input: 'passport scan',
    expected: 'passport',
    rationale: 'the common case',
  },
  {
    id: 'c2',
    input: 'bank statement',
    expected: 'bank_statement',
    rationale: 'multi-page financial doc',
  },
  {
    id: 'c3',
    input: 'employment letter',
    expected: 'employment_letter',
    rationale: 'easily confused with a payslip',
  },
  {
    id: 'c4',
    input: 'payslip',
    expected: 'pay_stub',
    rationale: 'the confusion partner for c3',
  },
];

const exactScore = (out: unknown, expected: unknown) => out === expected;

/** A runner whose accuracy depends on the tier, so tier selection is testable. */
function runnerWithAccuracy(
  accuracyByTier: Partial<Record<ModelTier, number>>,
): CaseRunner {
  let n = 0;
  return async (_task, tier, _input) => {
    const accuracy = accuracyByTier[tier] ?? 0;
    // Deterministic: the first `accuracy * cases.length` calls are right.
    const idx = n++ % cases.length;
    const correct = idx < Math.round(accuracy * cases.length);
    return {
      output: correct ? cases[idx].expected : 'wrong_label',
      inputTokens: 500,
      outputTokens: 20,
      latencyMs: tier === 'frontier' ? 900 : 200,
    };
  };
}

describe('evaluateTier', () => {
  it('reports the pass rate and whether it clears the task threshold', async () => {
    const r = await evaluateTier(
      'document_classification',
      'nano',
      cases,
      runnerWithAccuracy({ nano: 1 }),
      exactScore,
    );
    expect(r.passed).toBe(4);
    expect(r.passRate).toBe(1);
    expect(r.meetsThreshold).toBe(true);
    expect(r.model).toBe('gpt-5.6-luna');
  });

  it('fails a tier below the task threshold', async () => {
    // document_classification requires 0.95; 50% is nowhere near.
    const r = await evaluateTier(
      'document_classification',
      'nano',
      cases,
      runnerWithAccuracy({ nano: 0.5 }),
      exactScore,
    );
    expect(r.meetsThreshold).toBe(false);
  });

  it('never counts a structural failure as a pass', async () => {
    // Unparseable output that happens to contain the right substring is not a
    // correct answer.
    const runner: CaseRunner = async () => ({
      output: 'passport',
      inputTokens: 10,
      outputTokens: 1,
      latencyMs: 5,
      structuralFailure: 'response was not valid JSON',
    });
    const r = await evaluateTier(
      'document_classification',
      'nano',
      cases,
      runner,
      exactScore,
    );
    expect(r.passed).toBe(0);
    expect(r.structuralFailures).toBe(4);
  });

  it('counts a thrown call as a failed case rather than crashing the run', async () => {
    // A tier that times out on a third of the set has told you something
    // important about itself and must still be reported.
    const runner: CaseRunner = async (_t, _tier, input) => {
      if (input === 'payslip') throw new Error('timeout');
      return {
        output: 'passport',
        inputTokens: 1,
        outputTokens: 1,
        latencyMs: 1,
      };
    };
    const r = await evaluateTier(
      'document_classification',
      'nano',
      cases,
      runner,
      exactScore,
    );
    expect(r.cases).toBe(4);
    expect(r.structuralFailures).toBe(1);
  });

  it('prices each case with the tier’s actual model rate', async () => {
    const nano = await evaluateTier(
      'document_classification',
      'nano',
      cases,
      runnerWithAccuracy({ nano: 1 }),
      exactScore,
    );
    const frontier = await evaluateTier(
      'document_classification',
      'frontier',
      cases,
      runnerWithAccuracy({ frontier: 1 }),
      exactScore,
    );
    // Same tokens, different model: sol costs strictly more than luna.
    expect(frontier.costPerCaseUsd).toBeGreaterThan(nano.costPerCaseUsd);
  });

  it('reports latency percentiles', async () => {
    const r = await evaluateTier(
      'document_classification',
      'frontier',
      cases,
      runnerWithAccuracy({ frontier: 1 }),
      exactScore,
    );
    expect(r.p50LatencyMs).toBe(900);
    expect(r.p95LatencyMs).toBe(900);
  });
});

describe('recommendTier', () => {
  it('picks the CHEAPEST tier that passes, not the best-scoring one', async () => {
    // nano and frontier both clear the bar. Choosing frontier because it
    // scored higher would be paying 25x for a difference the threshold says
    // does not matter.
    const rec = await recommendTier(
      'document_classification',
      cases,
      runnerWithAccuracy({ nano: 1, small: 1, balanced: 1, frontier: 1 }),
      exactScore,
    );
    expect(rec.recommendedTier).toBe('nano');
  });

  it('never recommends a cheaper tier that failed its threshold', async () => {
    // This is rule 24 made enforceable: cheap is only considered among tiers
    // that already passed.
    const rec = await recommendTier(
      'document_classification',
      cases,
      runnerWithAccuracy({ nano: 0.25, small: 0.5, balanced: 1, frontier: 1 }),
      exactScore,
    );
    expect(rec.recommendedTier).toBe('balanced');
    expect(rec.verdict).toContain('UPGRADE');
  });

  it('recommends nothing when no tier clears the threshold', async () => {
    const rec = await recommendTier(
      'document_classification',
      cases,
      runnerWithAccuracy({
        nano: 0.25,
        small: 0.25,
        balanced: 0.5,
        frontier: 0.5,
      }),
      exactScore,
    );
    expect(rec.recommendedTier).toBeNull();
    expect(rec.verdict).toContain('Do not route this task automatically');
  });

  it('reports the per-case saving when a downgrade is justified', async () => {
    const rec = await recommendTier(
      'user_draft_generation', // configured 'balanced'
      cases,
      runnerWithAccuracy({ nano: 1, small: 1, balanced: 1, frontier: 1 }),
      exactScore,
    );
    expect(rec.recommendedTier).toBe('nano');
    expect(rec.costDeltaPerCaseUsd).toBeGreaterThan(0);
    expect(rec.verdict).toContain('Downgrade is justified by measurement');
  });

  it('says so plainly when the configured tier is already right', async () => {
    const rec = await recommendTier(
      'document_classification', // configured 'nano'
      cases,
      runnerWithAccuracy({ nano: 1, small: 1, balanced: 1, frontier: 1 }),
      exactScore,
    );
    expect(rec.verdict).toContain('already the cheapest');
  });

  it('evaluates every tier, so the report shows what was rejected and why', async () => {
    const rec = await recommendTier(
      'document_classification',
      cases,
      runnerWithAccuracy({ nano: 1 }),
      exactScore,
    );
    expect(rec.reports).toHaveLength(4);
    expect(rec.reports.filter((r) => !r.meetsThreshold)).toHaveLength(3);
  });
});

describe('assertFixtureIsSafe', () => {
  it('accepts synthetic fixtures', () => {
    expect(() =>
      assertFixtureIsSafe(
        [
          {
            id: 'a',
            input: 'Jane Doe, jane@example.com',
            expected: 'ok',
            rationale: 'x',
          },
        ],
        'safe',
      ),
    ).not.toThrow();
  });

  it('refuses a passport MRZ', () => {
    expect(() =>
      assertFixtureIsSafe(
        [
          {
            id: 'a',
            input: 'P<GBRSMITH<<JOHN<<<<<<<<<<<<<<<<<<<<<<<<<<<<',
            expected: 'passport',
            rationale: 'x',
          },
        ],
        'mrz',
      ),
    ).toThrow(/machine-readable zone/);
  });

  it('refuses card- or account-length digit runs', () => {
    expect(() =>
      assertFixtureIsSafe(
        [
          {
            id: 'a',
            input: 'acct 4539148803436467',
            expected: 'x',
            rationale: 'x',
          },
        ],
        'card',
      ),
    ).toThrow(/account-length number/);
  });

  it('refuses an IBAN and an SSN', () => {
    expect(() =>
      assertFixtureIsSafe(
        [
          {
            id: 'a',
            input: 'GB29NWBK60161331926819',
            expected: 'x',
            rationale: 'x',
          },
        ],
        'iban',
      ),
    ).toThrow(/IBAN/);
    expect(() =>
      assertFixtureIsSafe(
        [{ id: 'a', input: '123-45-6789', expected: 'x', rationale: 'x' }],
        'ssn',
      ),
    ).toThrow(/social security/);
  });

  it('refuses a real-looking email domain but allows example.com', () => {
    expect(() =>
      assertFixtureIsSafe(
        [
          {
            id: 'a',
            input: 'someone@gmail.com',
            expected: 'x',
            rationale: 'x',
          },
        ],
        'email',
      ),
    ).toThrow(/email domain/);
    expect(() =>
      assertFixtureIsSafe(
        [
          {
            id: 'a',
            input: 'someone@example.com',
            expected: 'x',
            rationale: 'x',
          },
        ],
        'email',
      ),
    ).not.toThrow();
  });
});

describe('formatRecommendation', () => {
  it('renders a table with every tier and the verdict', async () => {
    const rec = await recommendTier(
      'document_classification',
      cases,
      runnerWithAccuracy({ nano: 1, small: 1, balanced: 1, frontier: 1 }),
      exactScore,
    );
    const md = formatRecommendation(rec);
    expect(md).toContain('| nano |');
    expect(md).toContain('| frontier |');
    expect(md).toContain('gpt-5.6-luna');
    expect(md).toContain(AI_TASKS.document_classification.name);
  });
});

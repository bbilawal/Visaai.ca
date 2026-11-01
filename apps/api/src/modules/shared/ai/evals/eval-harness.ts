import { AI_TASKS, type AiTaskName, type ModelTier } from '../task-registry';
import { TIER_ORDER, resolveModel } from '../model-policy';
import { priceUsageDetailed } from '../ai-usage.pricing';

/**
 * The eval harness.
 *
 * WHY IT EXISTS: the spec's rule 17 is "use the cheapest model that passes
 * measured quality thresholds", and rule 24 is "never switch to a cheaper model
 * solely because it costs less". Both are unenforceable without a way to
 * measure a task at a tier. This is that way.
 *
 * WHAT IT IS NOT: a benchmark of the model. It measures ONE VisaAI task against
 * fixtures drawn from that task's real inputs, scored by that task's own
 * definition of correct. A model that scores 0.99 on someone's leaderboard and
 * 0.71 on document_classification is a bad model for document_classification.
 *
 * FIXTURES ARE SYNTHETIC OR DE-IDENTIFIED, ALWAYS. These tasks run over
 * passports, bank statements and family records. A fixture set built from real
 * uploads would put customer identity documents into a file that gets copied
 * onto laptops and into CI logs. The fixture loader refuses anything carrying
 * the marker of real data (see assertFixtureIsSafe).
 */

export interface EvalCase<TInput = unknown, TExpected = unknown> {
  /** Stable id, so a regression can be pointed at. */
  id: string;
  input: TInput;
  expected: TExpected;
  /** Why this case is in the set — the failure it is here to catch. */
  rationale: string;
}

export interface EvalRunResult {
  caseId: string;
  passed: boolean;
  /** Populated when the model returned something unparseable or off-schema. */
  structuralFailure?: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  latencyMs: number;
  costUsd: number;
}

export interface TierReport {
  task: AiTaskName;
  tier: ModelTier;
  model: string;
  cases: number;
  passed: number;
  passRate: number;
  meetsThreshold: boolean;
  totalCostUsd: number;
  costPerCaseUsd: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  avgInputTokens: number;
  avgOutputTokens: number;
  structuralFailures: number;
  /**
   * Ids of the cases this tier got wrong, excluding structural failures.
   *
   * Without these the report can say a task scores 70% but not WHICH 30%, so
   * the only available response is to change the tier — which is exactly the
   * move the harness exists to discourage. Naming the cases makes "look at the
   * failures" a possible next step instead of a vague one.
   */
  failedCaseIds: string[];
  /**
   * One representative structural-failure message, when there were any.
   *
   * The count alone is actively misleading. A run where every call fails —
   * wrong model id, bad key, network — reports 0% pass on every tier and
   * concludes "no tier met the threshold; improve your prompt", which sends
   * someone off to fix a prompt that was never evaluated. The message is what
   * distinguishes "the model was wrong" from "the model never answered".
   */
  sampleStructuralFailure?: string;
}

export interface TaskRecommendation {
  task: AiTaskName;
  threshold: number;
  /** Cheapest tier that met the threshold, or null if none did. */
  recommendedTier: ModelTier | null;
  currentTier: ModelTier;
  /** Positive = the recommendation is cheaper than what is configured. */
  costDeltaPerCaseUsd: number | null;
  reports: TierReport[];
  /** Plain-language explanation, for the cost report. */
  verdict: string;
}

/** Runs one case against one model and reports what happened. */
export type CaseRunner = (
  task: AiTaskName,
  tier: ModelTier,
  input: unknown,
  /**
   * The case's `expected`, so a runner can build the prompt the way production
   * does. Field extraction derives its prompt from the document type, which
   * lives on the case — without this the suite could only send a fixed string
   * that no production path uses.
   */
  expected?: unknown,
) => Promise<{
  output: unknown;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
  latencyMs: number;
  structuralFailure?: string;
}>;

/** Task-specific scoring. Returns true when the output is acceptable. */
export type Scorer = (output: unknown, expected: unknown) => boolean;

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(
    sorted.length - 1,
    Math.floor((p / 100) * sorted.length),
  );
  return sorted[idx];
}

export async function evaluateTier(
  task: AiTaskName,
  tier: ModelTier,
  cases: EvalCase[],
  run: CaseRunner,
  score: Scorer,
): Promise<TierReport> {
  const spec = AI_TASKS[task];
  const model = resolveModel(tier).model;
  const results: EvalRunResult[] = [];

  for (const c of cases) {
    const started = Date.now();
    try {
      const r = await run(task, tier, c.input, c.expected);
      const cached = r.cachedInputTokens ?? 0;
      results.push({
        caseId: c.id,
        // A structural failure is never a pass, regardless of what the scorer
        // makes of the output. Unparseable JSON that happens to contain the
        // right substring is not a correct answer.
        passed: r.structuralFailure ? false : score(r.output, c.expected),
        structuralFailure: r.structuralFailure,
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
        cachedInputTokens: cached,
        latencyMs: r.latencyMs,
        costUsd: priceUsageDetailed(model, {
          inputTokens: r.inputTokens,
          outputTokens: r.outputTokens,
          cachedInputTokens: cached,
        }),
      });
    } catch (err) {
      // A thrown call is a failed case, not a crashed run. A tier that times
      // out on a third of the set has told you something important about
      // itself and must still be reported.
      results.push({
        caseId: c.id,
        passed: false,
        structuralFailure: err instanceof Error ? err.message : 'threw',
        inputTokens: 0,
        outputTokens: 0,
        cachedInputTokens: 0,
        latencyMs: Date.now() - started,
        costUsd: 0,
      });
    }
  }

  const passed = results.filter((r) => r.passed).length;
  const latencies = results.map((r) => r.latencyMs).sort((a, b) => a - b);
  const totalCost = results.reduce((s, r) => s + r.costUsd, 0);
  const passRate = results.length === 0 ? 0 : passed / results.length;

  return {
    task,
    tier,
    model,
    cases: results.length,
    passed,
    passRate,
    meetsThreshold: passRate >= spec.qualityThreshold,
    totalCostUsd: Math.round(totalCost * 1e6) / 1e6,
    costPerCaseUsd:
      results.length === 0
        ? 0
        : Math.round((totalCost / results.length) * 1e6) / 1e6,
    p50LatencyMs: percentile(latencies, 50),
    p95LatencyMs: percentile(latencies, 95),
    avgInputTokens:
      results.length === 0
        ? 0
        : Math.round(
            results.reduce((s, r) => s + r.inputTokens, 0) / results.length,
          ),
    avgOutputTokens:
      results.length === 0
        ? 0
        : Math.round(
            results.reduce((s, r) => s + r.outputTokens, 0) / results.length,
          ),
    structuralFailures: results.filter((r) => r.structuralFailure).length,
    failedCaseIds: results
      .filter((r) => !r.passed && !r.structuralFailure)
      .map((r) => r.caseId),
    sampleStructuralFailure: results.find((r) => r.structuralFailure)
      ?.structuralFailure,
  };
}

/**
 * Run a task across every tier and recommend the cheapest that clears its
 * threshold.
 *
 * The ORDER of the two conditions is the whole point. "Cheapest" is only
 * considered among tiers that already passed; a tier that fails its threshold
 * is not a candidate at any price. This is the mechanism that makes rule 24
 * ("never switch to a cheaper model solely because it costs less") an
 * enforceable property rather than a good intention.
 */
export async function recommendTier(
  task: AiTaskName,
  cases: EvalCase[],
  run: CaseRunner,
  score: Scorer,
  tiers: ModelTier[] = TIER_ORDER,
): Promise<TaskRecommendation> {
  const spec = AI_TASKS[task];
  const reports: TierReport[] = [];
  for (const tier of tiers) {
    reports.push(await evaluateTier(task, tier, cases, run, score));
  }

  // TIER_ORDER is cheapest-first, so the first passing tier is the cheapest
  // passing tier.
  const passing = reports.filter((r) => r.meetsThreshold);
  const winner = passing[0] ?? null;
  const current = reports.find((r) => r.tier === spec.defaultTier) ?? null;

  const costDelta =
    winner && current ? current.costPerCaseUsd - winner.costPerCaseUsd : null;

  let verdict: string;
  if (!winner) {
    verdict =
      `No tier met the ${(spec.qualityThreshold * 100).toFixed(0)}% threshold ` +
      `(best: ${(Math.max(...reports.map((r) => r.passRate)) * 100).toFixed(1)}%). ` +
      `Do not route this task automatically — it needs a better prompt, a better ` +
      `schema, or human review.`;
  } else if (winner.tier === spec.defaultTier) {
    verdict =
      `Configured tier '${spec.defaultTier}' is already the cheapest that passes ` +
      `(${(winner.passRate * 100).toFixed(1)}% vs ${(spec.qualityThreshold * 100).toFixed(0)}% required).`;
  } else if (
    TIER_ORDER.indexOf(winner.tier) < TIER_ORDER.indexOf(spec.defaultTier)
  ) {
    verdict =
      `'${winner.tier}' passes at ${(winner.passRate * 100).toFixed(1)}% and costs ` +
      `$${winner.costPerCaseUsd.toFixed(6)}/case vs $${current?.costPerCaseUsd.toFixed(6)} ` +
      `on the configured '${spec.defaultTier}'. Downgrade is justified by measurement.`;
  } else {
    verdict =
      `The configured tier '${spec.defaultTier}' FAILS its threshold ` +
      `(${(current?.passRate ?? 0) * 100}%). The cheapest passing tier is ` +
      `'${winner.tier}'. This is an UPGRADE and it costs more — but a task ` +
      `below its quality threshold is producing wrong answers cheaply.`;
  }

  return {
    task,
    threshold: spec.qualityThreshold,
    recommendedTier: winner?.tier ?? null,
    currentTier: spec.defaultTier,
    costDeltaPerCaseUsd:
      costDelta === null ? null : Math.round(costDelta * 1e6) / 1e6,
    reports,
    verdict,
  };
}

/**
 * Refuse a fixture set that looks like it came from real customer data.
 *
 * These tasks run over passports, bank statements and family records, and a
 * fixture file gets copied onto laptops and printed into CI logs. This is a
 * blunt check, not a classifier — it catches the careless case, which is the
 * one that actually happens: someone pastes a real OCR dump in to debug a
 * failure and forgets to take it out.
 */
export function assertFixtureIsSafe(fixtures: EvalCase[], label: string): void {
  const serialized = JSON.stringify(fixtures);
  const markers: Array<[RegExp, string]> = [
    // A real MRZ line from a passport scan.
    [/P<[A-Z]{3}[A-Z<]{20,}/, 'a passport machine-readable zone'],
    // Long digit runs typical of an account or card number.
    [/\b\d{13,19}\b/, 'a card- or account-length number'],
    [/\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/, 'an IBAN'],
    [/\b\d{3}-\d{2}-\d{4}\b/, 'a US social security number'],
    [
      /@(?!example\.(com|org|net))[a-z0-9-]+\.[a-z]{2,}/i,
      'a non-example email domain',
    ],
  ];
  for (const [pattern, what] of markers) {
    if (pattern.test(serialized)) {
      throw new Error(
        `eval fixture set "${label}" appears to contain ${what}. Fixtures must be ` +
          `synthetic or de-identified — a set built from real uploads puts customer ` +
          `identity documents into a file that ends up in CI logs.`,
      );
    }
  }
}

/**
 * Say out loud when a run failed structurally rather than substantively.
 *
 * Emitted ABOVE the verdict, because when every case fails to execute the
 * verdict is meaningless and must not be read as a result.
 */
function structuralFailureNote(rec: TaskRecommendation): string[] {
  const withFailures = rec.reports.filter((r) => r.structuralFailures > 0);
  if (withFailures.length === 0) return [];

  const allFailed = rec.reports.every((r) => r.structuralFailures === r.cases);
  const sample = withFailures.find(
    (r) => r.sampleStructuralFailure,
  )?.sampleStructuralFailure;

  const lines = allFailed
    ? [
        '> **This run produced no measurement.** Every case on every tier failed',
        '> to execute, so the 0% pass rates below are not model quality — nothing',
        '> was scored. Fix the error and re-run before drawing any conclusion.',
      ]
    : [
        `> **${withFailures.reduce((n, r) => n + r.structuralFailures, 0)} case(s)`,
        '> failed to execute** and were counted as failures. Pass rates are',
        '> therefore a floor, not a measurement.',
      ];

  if (sample) lines.push('>', `> First error: \`${sample}\``);
  return [...lines, ''];
}

/**
 * Name the cases each tier got wrong.
 *
 * A tier that fails the SAME cases as every other tier is telling you the task
 * is not model-limited — no amount of spend will fix a case that frontier gets
 * wrong too. That is the single most useful thing this report can say, and it
 * is invisible from pass rates alone.
 */
function failedCaseNote(rec: TaskRecommendation): string[] {
  const withFailures = rec.reports.filter((r) => r.failedCaseIds.length > 0);
  if (withFailures.length === 0) return [];

  const lines = withFailures.map(
    (r) => `> - \`${r.tier}\`: ${r.failedCaseIds.join(', ')}`,
  );

  // Cases every tier gets wrong, including the most capable one.
  const universal = rec.reports[0].failedCaseIds.filter((id) =>
    rec.reports.every((r) => r.failedCaseIds.includes(id)),
  );
  if (universal.length > 0 && rec.reports.length > 1) {
    lines.push(
      '>',
      `> **Every tier fails: ${universal.join(', ')}.** A case the most capable`,
      '> tier also gets wrong is not a routing problem. Fix the prompt, the',
      '> schema, or the fixture before considering a more expensive tier.',
    );
  }

  return ['> **Failed cases**', ...lines, ''];
}

/** Markdown table of a recommendation, for docs/ai/AI_EVALS.md. */
export function formatRecommendation(rec: TaskRecommendation): string {
  const rows = rec.reports
    .map(
      (r) =>
        `| ${r.tier} | ${r.model} | ${r.passed}/${r.cases} | ${(r.passRate * 100).toFixed(1)}% | ` +
        `${r.meetsThreshold ? 'PASS' : 'FAIL'} | $${r.costPerCaseUsd.toFixed(6)} | ` +
        `${r.p50LatencyMs}ms | ${r.p95LatencyMs}ms | ${r.avgInputTokens} | ${r.avgOutputTokens} | ${r.structuralFailures} |`,
    )
    .join('\n');

  return [
    `### ${rec.task}`,
    '',
    `Threshold: ${(rec.threshold * 100).toFixed(0)}% · Configured tier: \`${rec.currentTier}\` · ` +
      `Recommended: \`${rec.recommendedTier ?? 'none — do not auto-route'}\``,
    '',
    '| Tier | Model | Passed | Pass rate | Verdict | $/case | p50 | p95 | avg in | avg out | structural fails |',
    '|---|---|---|---|---|---|---|---|---|---|---|',
    rows,
    '',
    ...structuralFailureNote(rec),
    ...failedCaseNote(rec),
    rec.verdict,
    '',
  ].join('\n');
}

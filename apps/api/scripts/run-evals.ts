/**
 * Run an eval suite against the live OpenAI API and print the tier
 * recommendation as markdown.
 *
 * This is the last piece between "the harness exists" and "the tiers in
 * MODEL_ROUTING.md are measured". Everything else is built; the only remaining
 * input is a funded key.
 *
 *   OPENAI_API_KEY=sk-... npx ts-node -P tsconfig.json scripts/run-evals.ts document_classification
 *   OPENAI_API_KEY=sk-... npx ts-node -P tsconfig.json scripts/run-evals.ts --all
 *
 * Paste the output into docs/ai/AI_COST_REPORT.md. It costs real money — every
 * case runs against every tier — so the per-suite form is the default and
 * --all is opt-in.
 */
import { chatModelForTask } from '../src/modules/shared/ai/model-factory';
import {
  assertFixtureIsSafe,
  formatRecommendation,
  recommendTier,
  type CaseRunner,
  type EvalCase,
  type Scorer,
} from '../src/modules/shared/ai/evals/eval-harness';
import { DOCUMENT_CLASSIFICATION_CASES } from '../src/modules/shared/ai/evals/fixtures/document-classification';
import {
  FIELD_EXTRACTION_CASES,
  type FieldExtractionCase,
} from '../src/modules/shared/ai/evals/fixtures/field-extraction';
import { extractionPromptFor } from '../src/modules/documents/ocr/extraction-schema';
import type { AiTaskName } from '../src/modules/shared/ai/task-registry';

const KNOWN_TYPES = [
  'passport',
  'national_id',
  'bank_statement',
  'bank_letter',
  'employment_letter',
  'pay_stub',
  'unknown',
];

interface Suite {
  task: AiTaskName;
  cases: EvalCase[];
  /** Fixed system prompt, for suites where every case shares one. */
  system?: string;
  /**
   * Per-case system prompt. Used where production builds the prompt from the
   * case itself — field extraction derives it from the document type, so a
   * single fixed string could not represent what the product sends.
   */
  systemFor?: (expected: never) => string;
  score: Scorer;
}

/**
 * Exact match after normalization. Deliberately strict: "passport " and
 * "Passport" are the same answer, but "identity document" is not, and a scorer
 * that accepts near-misses would report a classifier as passing while it feeds
 * the wrong label into a checklist.
 */
const exactLabel: Scorer = (out, expected) =>
  String(out).trim().toLowerCase() === String(expected).trim().toLowerCase();

/**
 * Field-level scoring. Every field must match, INCLUDING the nulls — a case
 * whose expected expiry is null fails if the model invented one, which is the
 * whole reason those cases exist.
 */
/**
 * Compare only the keys the case actually asserts.
 *
 * A passport has eleven production keys; a case about date formats is not
 * trying to pin `sex` or `place_of_birth`. Scoring every key would fail cases
 * for fields they were never about, which is how a suite ends up measuring
 * noise.
 */
const allFields: Scorer = (out, expected) => {
  if (!out || typeof out !== 'object') return false;
  const got = out as Record<string, unknown>;
  const want = (expected as FieldExtractionCase).expected;
  return Object.keys(want).every((k) => {
    const a = want[k];
    const b = got[k];
    if (a === null) return b === null || b === undefined || b === '';
    return String(b ?? '').trim().toLowerCase() === String(a).trim().toLowerCase();
  });
};

const SUITES: Record<string, Suite> = {
  document_classification: {
    task: 'document_classification',
    cases: DOCUMENT_CLASSIFICATION_CASES,
    system:
      `Classify the document into exactly one of: ${KNOWN_TYPES.join(', ')}.\n` +
      `Answer with the label only, no punctuation and no explanation.\n` +
      `If it is not one of those types, or the text is empty or unreadable, answer "unknown". ` +
      `Never guess the nearest label — a wrong label marks a visa checklist item satisfied.`,
    score: exactLabel,
  },
  field_extraction: {
    task: 'field_extraction',
    cases: FIELD_EXTRACTION_CASES,
    /**
     * THE PRODUCTION PROMPT, per case, not a hand-written stand-in.
     *
     * This suite used to send a bespoke five-field instruction that no code
     * path in the product sends, so its scores described a prompt that did not
     * exist. `extractionPromptFor()` is the same function
     * documents/graphs/nodes/derive-fields.ts calls, over the same typed
     * schema, so a number produced here is a statement about production.
     *
     * Only the "JSON object only" line is appended, because the eval parses the
     * reply directly while production goes through LangChain structured output.
     * That is a transport difference, not a change to the instruction.
     */
    systemFor: (c: FieldExtractionCase) =>
      `${extractionPromptFor(c.documentType)}\nAnswer with the JSON object only.`,
    score: allFields,
  },
};

function makeRunner(suite: Suite): CaseRunner {
  return async (task, tier, input, expected) => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OPENAI_API_KEY is required');

    const model = chatModelForTask(task, { apiKey, tier });
    const started = Date.now();

    const res = await model.invoke([
      {
        role: 'system',
        content: suite.systemFor
          ? (suite.systemFor as (e: unknown) => string)(expected)
          : (suite.system ?? ''),
      },
      { role: 'user', content: String(input) },
    ]);

    const latencyMs = Date.now() - started;
    const text = typeof res.content === 'string' ? res.content : JSON.stringify(res.content);
    const usage = (res as { usage_metadata?: { input_tokens?: number; output_tokens?: number } })
      .usage_metadata;

    // Structured tasks parse here so a malformed response is reported as a
    // STRUCTURAL failure rather than scored as a wrong answer — the harness
    // treats those differently, and conflating them hides a schema problem.
    let output: unknown = text.trim();
    let structuralFailure: string | undefined;
    if (suite.task === 'field_extraction') {
      try {
        const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
        output = JSON.parse((fenced?.[1] ?? text).trim());
      } catch {
        structuralFailure = 'response was not valid JSON';
      }
    }

    return {
      output,
      inputTokens: usage?.input_tokens ?? 0,
      outputTokens: usage?.output_tokens ?? 0,
      latencyMs,
      structuralFailure,
    };
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const names = args.includes('--all') ? Object.keys(SUITES) : args.filter((a) => !a.startsWith('--'));

  if (names.length === 0) {
    console.error(`usage: run-evals.ts <suite|--all>\nsuites: ${Object.keys(SUITES).join(', ')}`);
    process.exit(2);
  }

  const sections: string[] = [];
  for (const name of names) {
    const suite = SUITES[name];
    if (!suite) {
      console.error(`unknown suite "${name}"`);
      process.exit(2);
    }

    // Refuses to send real personal data to a third party, every run, not just
    // when the fixtures were written.
    assertFixtureIsSafe(suite.cases, name);

    process.stderr.write(`running ${name} (${suite.cases.length} cases x 4 tiers)...\n`);
    const rec = await recommendTier(suite.task, suite.cases, makeRunner(suite), suite.score);
    sections.push(formatRecommendation(rec));
    process.stderr.write(`  ${rec.verdict}\n`);
  }

  console.log(sections.join('\n'));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

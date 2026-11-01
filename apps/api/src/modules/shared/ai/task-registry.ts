/**
 * The AI task registry.
 *
 * WHY
 *
 * Before this file, every AI callsite chose its own model with a string
 * literal. `gpt-4o` and `gpt-4o-mini` appear across 12 source files
 * (visa.agents.ts, intake/graphs/*, vri/graphs/*, narrative/graphs/*,
 * prefill/graphs/*, documents/ocr/*, ai.service.ts:61). Three consequences:
 *
 *   1. Changing model strategy meant a 12-file diff, so it never happened, so
 *      every task — including one-token classification — ran on the frontier
 *      model of 2024.
 *   2. There was no place to state what a task IS: its output schema, its
 *      latency class, whether its result is cacheable, what it may cost. So
 *      none of those could be enforced.
 *   3. No task could be evaluated. "Is the cheap model good enough here?" had
 *      no unit of analysis to ask the question about.
 *
 * This registry is that unit. One entry per AI task, describing the task
 * rather than the model. Model IDs live in ONE place — `model-policy.ts` —
 * keyed by tier, so a model change is a config change and a routing change is
 * a one-line edit here.
 *
 * ADDING A TASK: add an entry, give it an eval fixture set, and route it at
 * the cheapest tier that passes its threshold. Never add a task without a
 * `qualityThreshold` — an unevaluated task is one nobody can safely downgrade.
 */

/**
 * Capability tiers, NOT model names. A tier is a promise about capability and
 * relative cost; which concrete model satisfies it is `model-policy.ts`'s
 * problem and changes when OpenAI's lineup changes.
 */
export type ModelTier =
  /** Bounded, mechanical: classification, normalization, short extraction. */
  | 'nano'
  /** Standard extraction and short generation with light reasoning. */
  | 'small'
  /** Multi-step reasoning, longer generation, user-facing prose. */
  | 'balanced'
  /** Genuinely hard reasoning where evals justify the cost. */
  | 'frontier';

/** How the task's latency is experienced, which decides batch eligibility. */
export type LatencyClass =
  /** A user is waiting on this render. Never batched. */
  | 'interactive'
  /** A job the user will come back to. Batchable. */
  | 'background'
  /** Nightly/offline. Always batch when the provider offers a discount. */
  | 'offline';

/**
 * Sensitivity of the data the task sends. Drives redaction, retention and
 * whether the provider may store the request.
 */
export type SensitivityClass =
  /** Government reference text. No personal data. */
  | 'public'
  /** Application metadata, no identity documents. */
  | 'internal'
  /** Passport/financial/identity content. Minimum retention, no storage. */
  | 'sensitive';

export interface AiTaskSpec {
  /** Stable name. Appears in ai_usage_events, dashboards, and eval fixtures. */
  name: string;
  /** What this task is for, in one line. */
  purpose: string;
  /** Tier the router tries first. */
  defaultTier: ModelTier;
  /**
   * Tier to escalate to when the default fails its structural check (invalid
   * schema, refusal, empty). Null = never escalate; fail closed instead. Null
   * is correct for tasks where a wrong answer is worse than no answer.
   */
  fallbackTier: ModelTier | null;
  /** Whether the response is consumed by code (schema-validated) or shown to a user. */
  consumer: 'machine' | 'user';
  /** Whether the task must produce JSON matching a schema. */
  structured: boolean;
  latency: LatencyClass;
  sensitivity: SensitivityClass;
  /** Hard cap on output tokens. A bounded task with no cap is a runaway bill. */
  maxOutputTokens: number;
  /** Per-request ceiling in USD; the gateway refuses above this. */
  maxCostUsd: number;
  timeoutMs: number;
  /** Attempts per provider before falling through. */
  retries: number;
  /**
   * Whether an identical (task, prompt version, model policy, input hash,
   * source version, locale) request may be served from cache.
   *
   * false for anything whose answer depends on live user facts that the cache
   * key cannot fully capture — serving a stale personalized checklist is worse
   * than paying for the call.
   */
  cacheable: boolean;
  /** Cache TTL in seconds. Ignored when cacheable is false. */
  cacheTtlSeconds: number;
  /** May run through the provider's discounted batch endpoint. */
  batchEligible: boolean;
  /** Minimum eval pass rate required to route this task at its tier. */
  qualityThreshold: number;
  /** Prompt template version. Part of the cache key: a prompt edit invalidates cache. */
  promptVersion: string;
}

/**
 * TIER RATIONALE, per task. The default is the CHEAPEST tier whose eval suite
 * passes its threshold (see docs/ai/AI_EVALS.md), not the tier that feels safe.
 */
export const AI_TASKS = {
  /**
   * Which of a fixed set of document types is this? Closed label set, short
   * input, deterministic-ish. This is the archetypal nano task: it ran on a
   * frontier model purely because nobody had a place to say otherwise.
   *
   * MEASURED 2026-08-21: 100% on all four tiers. `nano` confirmed as the
   * cheapest passing tier. Frontier costs 28x nano to return the same answers.
   */
  document_classification: {
    name: 'document_classification',
    purpose: 'Label an uploaded file as one of the known document types.',
    defaultTier: 'nano',
    fallbackTier: 'small',
    consumer: 'machine',
    structured: true,
    latency: 'background',
    sensitivity: 'sensitive',
    maxOutputTokens: 200,
    maxCostUsd: 0.01,
    timeoutMs: 20_000,
    retries: 2,
    // Same bytes, same taxonomy version → same label. Keyed on the file hash.
    cacheable: true,
    cacheTtlSeconds: 60 * 60 * 24 * 30,
    batchEligible: true,
    qualityThreshold: 0.95,
    promptVersion: 'v1',
  },

  /**
   * Pull typed fields out of an already-OCR'd document. Bounded schema.
   *
   * MEASURED 2026-08-21 against the PRODUCTION prompt: nano 100%, small 90%,
   * balanced 100%, frontier 100%, against a `qualityThreshold` of 92%.
   *
   * Default lowered `small` -> `nano` on that measurement. This is the
   * downgrade rule 24 permits and the one it forbids being confused: nano is
   * chosen because it PASSES the threshold, and is cheaper only as a
   * tie-break. It is also more accurate than the tier it replaces.
   *
   * An earlier run scored 70-80% and recommended not auto-routing at all. That
   * run was measuring a hand-written prompt in the eval runner that no code
   * path sends — see the note in evals/fixtures/field-extraction.ts. The task
   * was never the problem; the eval was.
   *
   * `small` failing `non-latin-name` while `nano` passes it is real and
   * repeatable. The two differ only by reasoning effort ('low' vs 'none'), and
   * on a dual-script name the extra reasoning talks itself into normalising
   * what the prompt asked to be copied exactly.
   */
  field_extraction: {
    name: 'field_extraction',
    purpose: 'Extract typed fields from OCR text against a fixed schema.',
    defaultTier: 'nano',
    fallbackTier: 'balanced',
    consumer: 'machine',
    structured: true,
    latency: 'background',
    sensitivity: 'sensitive',
    maxOutputTokens: 1_200,
    maxCostUsd: 0.03,
    timeoutMs: 45_000,
    retries: 2,
    cacheable: true,
    cacheTtlSeconds: 60 * 60 * 24 * 30,
    batchEligible: true,
    qualityThreshold: 0.92,
    promptVersion: 'v1',
  },

  /**
   * Turn a government page into structured requirement candidates. Long input,
   * high stakes — a bad extraction becomes a wrong visa requirement — but the
   * output is always human-reviewed before it goes active
   * (visa_source_changes), so 'balanced' is the honest tier rather than
   * frontier-for-comfort.
   */
  source_normalization: {
    name: 'source_normalization',
    purpose:
      'Normalize an official government page into requirement candidates.',
    defaultTier: 'balanced',
    fallbackTier: 'frontier',
    consumer: 'machine',
    structured: true,
    latency: 'offline',
    sensitivity: 'public',
    maxOutputTokens: 4_000,
    maxCostUsd: 0.25,
    timeoutMs: 120_000,
    retries: 2,
    // Government page bytes are immutable per version, so an unchanged version
    // never needs re-extraction. This is the single biggest cache win here:
    // the nightly sync re-reads hundreds of unchanged pages.
    cacheable: true,
    cacheTtlSeconds: 60 * 60 * 24 * 90,
    batchEligible: true,
    qualityThreshold: 0.9,
    promptVersion: 'v1',
  },

  /**
   * Classify a diff between two versions of a government page. Small closed
   * label set over a short diff — nano work, and it runs on every changed
   * source every night, so the tier matters.
   */
  change_classification: {
    name: 'change_classification',
    purpose:
      'Classify a source diff as cosmetic, editorial, material or structural.',
    defaultTier: 'nano',
    fallbackTier: 'small',
    consumer: 'machine',
    structured: true,
    latency: 'offline',
    sensitivity: 'public',
    maxOutputTokens: 600,
    maxCostUsd: 0.02,
    timeoutMs: 30_000,
    retries: 2,
    cacheable: true,
    cacheTtlSeconds: 60 * 60 * 24 * 30,
    batchEligible: true,
    qualityThreshold: 0.93,
    promptVersion: 'v1',
  },

  /**
   * Explain, in prose, why a visa was recommended. User-facing, quality-visible,
   * and short. NOT cacheable: it is personalized to the applicant's facts, and
   * the cache key cannot capture every fact that should invalidate it.
   */
  recommendation_explanation: {
    name: 'recommendation_explanation',
    purpose: 'Explain a visa recommendation in the applicant’s own terms.',
    defaultTier: 'small',
    fallbackTier: 'balanced',
    consumer: 'user',
    structured: false,
    latency: 'interactive',
    sensitivity: 'internal',
    maxOutputTokens: 500,
    maxCostUsd: 0.02,
    timeoutMs: 30_000,
    retries: 1,
    cacheable: false,
    cacheTtlSeconds: 0,
    batchEligible: false,
    qualityThreshold: 0.9,
    promptVersion: 'v1',
  },

  /**
   * Explain why a specific requirement applies. Keyed on (requirement, source
   * version, locale) — no applicant facts in the prompt, which is exactly why
   * it CAN be cached while recommendation_explanation cannot.
   */
  requirement_explanation: {
    name: 'requirement_explanation',
    purpose: 'Explain what a requirement means and why it is asked for.',
    defaultTier: 'nano',
    fallbackTier: 'small',
    consumer: 'user',
    structured: false,
    latency: 'interactive',
    sensitivity: 'public',
    maxOutputTokens: 350,
    maxCostUsd: 0.01,
    timeoutMs: 20_000,
    retries: 1,
    cacheable: true,
    cacheTtlSeconds: 60 * 60 * 24 * 30,
    batchEligible: false,
    qualityThreshold: 0.88,
    promptVersion: 'v1',
  },

  /** Is this scan legible, complete, correctly oriented? Bounded verdict. */
  document_quality_feedback: {
    name: 'document_quality_feedback',
    purpose: 'Tell the applicant whether a scan is usable and what is wrong.',
    defaultTier: 'nano',
    fallbackTier: 'small',
    consumer: 'user',
    structured: true,
    latency: 'interactive',
    sensitivity: 'sensitive',
    maxOutputTokens: 400,
    maxCostUsd: 0.015,
    timeoutMs: 25_000,
    retries: 1,
    cacheable: true,
    cacheTtlSeconds: 60 * 60 * 24 * 7,
    batchEligible: false,
    qualityThreshold: 0.9,
    promptVersion: 'v1',
  },

  /**
   * Draft a cover letter / purpose-of-travel statement from facts the applicant
   * supplied. Long user-facing prose that gets read by a caseworker — the one
   * place where output quality is worth the balanced tier. Never cached: it is
   * this applicant's letter.
   */
  user_draft_generation: {
    name: 'user_draft_generation',
    purpose:
      'Draft a truthful applicant document from facts the applicant supplied.',
    defaultTier: 'balanced',
    fallbackTier: 'frontier',
    consumer: 'user',
    structured: false,
    latency: 'interactive',
    sensitivity: 'sensitive',
    // 2048 preserves the narrative graph's existing budget exactly. Lowering it
    // during the migration would truncate letters that render correctly today.
    maxOutputTokens: 2_048,
    maxCostUsd: 0.1,
    timeoutMs: 90_000,
    retries: 1,
    cacheable: false,
    cacheTtlSeconds: 0,
    batchEligible: false,
    qualityThreshold: 0.9,
    promptVersion: 'v1',
  },

  /**
   * The question text the applicant actually reads. User-facing prose in the
   * applicant's language, so it keeps a real tier — this is the turn a person
   * judges the product by. Budget matches the intake graph's existing 1024.
   */
  intake_question_generation: {
    name: 'intake_question_generation',
    purpose: 'Write the next intake question for the applicant to read.',
    defaultTier: 'small',
    fallbackTier: 'balanced',
    consumer: 'user',
    structured: false,
    latency: 'interactive',
    sensitivity: 'internal',
    maxOutputTokens: 1_024,
    maxCostUsd: 0.02,
    timeoutMs: 30_000,
    retries: 1,
    cacheable: false,
    cacheTtlSeconds: 0,
    batchEligible: false,
    qualityThreshold: 0.9,
    promptVersion: 'v1',
  },

  /**
   * Answer -> structured facts, and checklist discovery. Behind the scenes, no
   * user reads it, bounded schema. Nothing about it justified a frontier model
   * except that there was no way to say so.
   */
  intake_answer_extraction: {
    name: 'intake_answer_extraction',
    purpose: 'Turn a free-text intake answer into typed profile facts.',
    defaultTier: 'nano',
    fallbackTier: 'small',
    consumer: 'machine',
    structured: true,
    latency: 'interactive',
    sensitivity: 'internal',
    maxOutputTokens: 1_024,
    maxCostUsd: 0.01,
    timeoutMs: 20_000,
    retries: 1,
    cacheable: false,
    cacheTtlSeconds: 0,
    batchEligible: false,
    qualityThreshold: 0.92,
    promptVersion: 'v1',
  },

  /**
   * Propose the documents and forms an applicant must gather, when the sourced
   * registry has none for their route.
   *
   * Separate from `intake_answer_extraction`, which is what it used to borrow.
   * That task turns one short answer into typed facts and is budgeted at 1,024
   * output tokens; this one emits up to 3 forms, 10 documents and 6
   * strengthening documents, each with a label, a reason, a source URL and
   * free-text specs. The two are not the same size of job, and the mismatch
   * failed closed:
   *
   *     [update-checklist:discovery] LLM error: Could not parse response
   *     content as the length limit was reached
   *
   * The applicant saw an empty document vault. Nothing surfaced the cause —
   * the error is caught and the checklist simply comes back empty.
   *
   * 12,000, not the 4,000 the schema alone implies. The tier resolves to a
   * REASONING model (gpt-5.6-luna at `reasoning.effort: 'low'`), and reasoning
   * tokens are spent from the same output budget as the answer. 4,000 was
   * enough for the payload and not for the thinking in front of it, so the call
   * still died on `length limit was reached` — the same symptom one layer down.
   *
   * The payload itself is ~3,800: 19 items at roughly 200 tokens each. The rest
   * is headroom for reasoning, and it costs nothing when unused — only tokens
   * actually emitted are billed.
   */
  intake_checklist_discovery: {
    name: 'intake_checklist_discovery',
    purpose:
      'Propose the forms and documents an applicant must gather for a route.',
    // `nano` and `small` are the SAME model (gpt-5.6-luna); the tier only
    // changes reasoning effort, and this task is recall and formatting rather
    // than reasoning. Measured against production on 2026-09-04, same prompt,
    // both returning the full 19 items: nano 10.2s, small 13.3s.
    defaultTier: 'nano',
    // Escalates rather than repeats: a truncated or unparseable structured
    // response is exactly the failure a larger model fixes, and it is what this
    // task failed on in production.
    fallbackTier: 'small',
    consumer: 'machine',
    structured: true,
    latency: 'interactive',
    sensitivity: 'internal',
    maxOutputTokens: 12_000,
    maxCostUsd: 0.1,
    timeoutMs: 45_000,
    retries: 1,
    /**
     * Cacheable, and this is the only task here for which that is a UX fix
     * rather than a cost one.
     *
     * The answer for "Canada, Express Entry, no answers yet" is the same for
     * every applicant who picks that route, and it is 31 routes' worth of
     * applicants all waiting ~20s for the identical list. Caching turns that
     * into one applicant paying it.
     *
     * The caller only consults the cache when the profile is EMPTY — see
     * update-checklist.ts. That keeps applicant answers out of a shared cache
     * and confines the entry to what is effectively public: the documents a
     * route requires.
     *
     * Seven days rather than longer: government document lists change rarely,
     * but they do change, and a stale list is a person gathering the wrong
     * paper.
     */
    cacheable: true,
    cacheTtlSeconds: 604_800,
    batchEligible: false,
    qualityThreshold: 0.9,
    promptVersion: 'v1',
  },

  /**
   * Map an application's known facts onto a specific official form's fields.
   * Structured, machine-consumed, and the widest output here — a long form has
   * many fields. 4096 was too small: a 102-field IMM 5257 hit it exactly
   * (prod 2026-10-14) and the truncated JSON parsed to nothing. ~40 tokens per
   * field → 12k covers ~250 fields; generate-fields also salvages a cut-off
   * array. Cost is ~$0.014 per 1k output tokens on the balanced tier.
   */
  form_prefill: {
    name: 'form_prefill',
    purpose: 'Map known application facts onto an official form’s fields.',
    defaultTier: 'balanced',
    fallbackTier: 'frontier',
    consumer: 'machine',
    structured: true,
    latency: 'background',
    sensitivity: 'sensitive',
    maxOutputTokens: 12_000,
    maxCostUsd: 0.3,
    timeoutMs: 120_000,
    retries: 2,
    cacheable: false,
    cacheTtlSeconds: 0,
    batchEligible: false,
    qualityThreshold: 0.92,
    promptVersion: 'v1',
  },

  /**
   * Score an application's risk/readiness. Multi-factor reasoning over the
   * whole profile, and it drives a number the applicant acts on.
   */
  vri_assessment: {
    name: 'vri_assessment',
    purpose:
      'Assess readiness factors that deterministic scoring cannot cover.',
    defaultTier: 'balanced',
    fallbackTier: 'frontier',
    consumer: 'machine',
    structured: true,
    latency: 'background',
    sensitivity: 'internal',
    maxOutputTokens: 1_500,
    maxCostUsd: 0.08,
    timeoutMs: 60_000,
    retries: 2,
    cacheable: false,
    cacheTtlSeconds: 0,
    batchEligible: false,
    qualityThreshold: 0.9,
    promptVersion: 'v1',
  },

  /**
   * Suggest candidate visa categories for an applicant's stated situation.
   * Structured output over a wide candidate set, which is why its budget is
   * the largest of the bounded tasks — 6000 matches the existing node exactly.
   */
  visa_category_suggestion: {
    name: 'visa_category_suggestion',
    purpose:
      'Suggest candidate visa categories from the applicant’s situation.',
    defaultTier: 'small',
    fallbackTier: 'balanced',
    consumer: 'machine',
    structured: true,
    latency: 'background',
    sensitivity: 'internal',
    maxOutputTokens: 6_000,
    maxCostUsd: 0.05,
    timeoutMs: 90_000,
    retries: 2,
    cacheable: false,
    cacheTtlSeconds: 0,
    batchEligible: false,
    qualityThreshold: 0.9,
    promptVersion: 'v1',
  },

  /** Translate UI/explanatory copy. Never official government wording. */
  translation_assistance: {
    name: 'translation_assistance',
    purpose: 'Translate VisaAI explanatory copy. Never official source text.',
    defaultTier: 'nano',
    fallbackTier: 'small',
    consumer: 'user',
    structured: false,
    latency: 'offline',
    sensitivity: 'public',
    maxOutputTokens: 2_000,
    maxCostUsd: 0.02,
    timeoutMs: 45_000,
    retries: 2,
    cacheable: true,
    cacheTtlSeconds: 60 * 60 * 24 * 90,
    batchEligible: true,
    qualityThreshold: 0.9,
    promptVersion: 'v1',
  },

  /**
   * Estimate visa requirements for a country/visa pair that the sourced
   * registry does not yet cover.
   *
   * NAMED FOR WHAT IT IS. This is model recall, not research: no government
   * page is read at request time. Its output is therefore ALWAYS unverified
   * and must be labelled as an estimate wherever it surfaces — it may never
   * be presented as an official requirement, and it may never overwrite a
   * sourced row in visa_requirements. The registry is authoritative; this is
   * the fallback for the gap, and the gap should shrink over time.
   */
  visa_requirement_estimate: {
    name: 'visa_requirement_estimate',
    purpose:
      'Estimate requirements for an uncovered country/visa pair. Unverified by construction.',
    defaultTier: 'small',
    fallbackTier: 'balanced',
    consumer: 'machine',
    structured: true,
    latency: 'background',
    sensitivity: 'public',
    maxOutputTokens: 600,
    maxCostUsd: 0.02,
    timeoutMs: 45_000,
    retries: 2,
    cacheable: false,
    cacheTtlSeconds: 0,
    batchEligible: false,
    qualityThreshold: 0.85,
    promptVersion: 'v1',
  },

  /**
   * Judge an applicant profile against a requirement set. Multi-factor
   * reasoning over the whole profile, and it produces the gaps and risk
   * factors the applicant acts on — the one agent in this pipeline that
   * genuinely earns the balanced tier.
   */
  profile_evaluation: {
    name: 'profile_evaluation',
    purpose: 'Evaluate an applicant profile against a visa’s requirements.',
    defaultTier: 'balanced',
    fallbackTier: 'frontier',
    consumer: 'machine',
    structured: true,
    latency: 'background',
    sensitivity: 'sensitive',
    maxOutputTokens: 800,
    maxCostUsd: 0.05,
    timeoutMs: 60_000,
    retries: 2,
    cacheable: false,
    cacheTtlSeconds: 0,
    batchEligible: false,
    qualityThreshold: 0.9,
    promptVersion: 'v1',
  },

  /** Turn a structured evaluation into the markdown the applicant reads. */
  recommendation_copy: {
    name: 'recommendation_copy',
    purpose: 'Render a structured evaluation as readable applicant guidance.',
    defaultTier: 'small',
    fallbackTier: 'balanced',
    consumer: 'user',
    structured: false,
    latency: 'background',
    sensitivity: 'internal',
    maxOutputTokens: 800,
    maxCostUsd: 0.02,
    timeoutMs: 45_000,
    retries: 2,
    cacheable: false,
    cacheTtlSeconds: 0,
    batchEligible: false,
    qualityThreshold: 0.88,
    promptVersion: 'v1',
  },

  /** Answer a product-support question from VisaAI's own help content. */
  support_assistant: {
    name: 'support_assistant',
    purpose: 'Answer a product question from VisaAI help content only.',
    defaultTier: 'small',
    fallbackTier: 'balanced',
    consumer: 'user',
    structured: false,
    latency: 'interactive',
    sensitivity: 'internal',
    maxOutputTokens: 600,
    maxCostUsd: 0.02,
    timeoutMs: 30_000,
    retries: 1,
    cacheable: false,
    cacheTtlSeconds: 0,
    batchEligible: false,
    qualityThreshold: 0.88,
    promptVersion: 'v1',
  },

  /**
   * Answer a visa question from retrieved OFFICIAL source passages only.
   *
   * The highest-stakes user-facing task in the platform: a wrong sentence here
   * is a person budgeting for the wrong fee or turning up without a required
   * document. Three properties of the spec follow from that and are not
   * tunable knobs:
   *
   *   `structured: true` — the model returns claims with per-claim citations,
   *   not prose. `answer-grounding.ts` then drops any claim whose citation does
   *   not check out. Free prose cannot be verified claim by claim, so it cannot
   *   be verified at all.
   *
   *   `sensitivity: 'public'` — the evidence is government reference text, and
   *   the applicant's own documents are structurally barred from reaching this
   *   prompt (kb_chunks can only come from an official source version). That is
   *   what keeps this task out of the sensitive-data retention regime.
   *
   *   `cacheable: false` — the answer depends on the CURRENT active source
   *   version, and a cache key cannot capture "the government has not changed
   *   this page since". A cached visa answer is a stale visa answer waiting to
   *   happen; the retrieval layer caches evidence instead, keyed by content
   *   hash, where staleness is detectable.
   */
  visa_knowledge_answer: {
    name: 'visa_knowledge_answer',
    purpose:
      'Answer a visa question strictly from retrieved official passages, with per-claim citations.',
    defaultTier: 'balanced',
    // Never falls back DOWN. A weaker model on this task produces confident
    // uncited prose, which grounding then discards wholesale — the user gets a
    // refusal rather than a worse answer, so escalating is the only fallback
    // that helps.
    fallbackTier: 'frontier',
    consumer: 'user',
    structured: true,
    latency: 'interactive',
    sensitivity: 'public',
    maxOutputTokens: 1_600,
    maxCostUsd: 0.05,
    timeoutMs: 45_000,
    retries: 1,
    cacheable: false,
    cacheTtlSeconds: 0,
    batchEligible: false,
    qualityThreshold: 0.95,
    promptVersion: 'v1',
  },
} as const satisfies Record<string, AiTaskSpec>;

export type AiTaskName = keyof typeof AI_TASKS;

export function getTask(name: AiTaskName): AiTaskSpec {
  return AI_TASKS[name];
}

export const AI_TASK_NAMES = Object.keys(AI_TASKS) as AiTaskName[];

import type { ModelTier } from './task-registry';

/**
 * The ONE place a concrete OpenAI model ID appears.
 *
 * Everything else in the codebase asks for a TIER. This file decides which
 * model satisfies a tier today. When OpenAI's lineup changes, this file
 * changes and nothing else does.
 *
 * VERIFIED AGAINST OFFICIAL DOCS ON 2026-08-20
 * (https://developers.openai.com/api/docs/models and
 *  https://developers.openai.com/api/docs/pricing — note platform.openai.com
 *  now 301s to developers.openai.com, and openai.com/api/pricing returns 403.)
 *
 * Current production family, per the docs' own heading "Frontier Models
 * (Recommended for Production)":
 *
 *   gpt-5.6-sol    frontier   $5.00 in / $0.50 cached / $30.00 out
 *   gpt-5.6-terra  balanced   $2.00 in / $0.20 cached / $12.00 out
 *   gpt-5.6-luna   cheap      $0.20 in / $0.02 cached / $1.20 out
 *
 * FOUR FACTS THAT SHAPED THIS MAPPING — each one is a place where the obvious
 * move would have been wrong:
 *
 * 1. THERE IS NO `gpt-5.6-nano`. The 5.6 family has three members; Luna is the
 *    bottom. The `nano` TIER still exists here because it means something
 *    different from `small` — it selects `reasoning.effort: 'none'`, which is
 *    where the saving actually comes from now that reasoning is a parameter
 *    rather than a model line.
 *
 * 2. `gpt-4o-mini` → Luna is a PRICE INCREASE on uncached tokens:
 *    $0.15/$0.60 becomes $0.20/$1.20. It only pays off through the cache
 *    ($0.075 → $0.02 per 1M, a 3.75× better read rate) and through `effort:
 *    'none'` suppressing reasoning tokens. Tasks currently on `gpt-4o-mini`
 *    are therefore NOT auto-migrated for cost reasons — they migrate because
 *    they clear their eval threshold, and the cost report states the delta
 *    honestly either way. See docs/ai/MODEL_ROUTING.md.
 *
 * 3. `gpt-4o` → Luna, where a task's evals allow it, is the real win:
 *    $2.50 → $0.20 input is 12.5×. Most VisaAI AI work is bounded
 *    classification and extraction that was on `gpt-4o` only because no
 *    routing layer existed to say otherwise.
 *
 * 4. ON GPT-5.6 CACHE WRITES ARE BILLED at 1.25× the uncached input rate — a
 *    line item that did not exist on 4o. A low-reuse prompt can cost MORE
 *    cached than uncached. `cacheMode: 'explicit'` exists for exactly this,
 *    and `ai-usage.pricing.ts` had to learn `cache_write_tokens` before any
 *    of this could be metered truthfully.
 */

/** Reasoning effort levels the 5.6 family accepts (docs, 2026-08-20). */
export type ReasoningEffort =
  | 'none'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh'
  | 'max';

export interface ModelChoice {
  model: string;
  reasoningEffort: ReasoningEffort;
  /**
   * 'implicit' lets the provider place its own cache breakpoint at the latest
   * message. 'explicit' (5.6+ only) disables that, so a stable prefix is
   * cached without the volatile suffix also being WRITTEN — which matters
   * because writes are billed now.
   */
  cacheMode: 'implicit' | 'explicit';
}

/**
 * Tier → concrete model. Overridable per environment: `AI_MODEL_<TIER>` lets
 * an operator pin or roll back a tier without a deploy, which is the whole
 * point of not spreading IDs through feature code.
 */
const DEFAULT_TIER_MODELS: Record<ModelTier, string> = {
  nano: 'gpt-5.6-luna',
  small: 'gpt-5.6-luna',
  balanced: 'gpt-5.6-terra',
  frontier: 'gpt-5.6-sol',
};

/**
 * Tier → reasoning effort. This is the real cost dial on the 5.6 family:
 * `none` suppresses reasoning tokens entirely, which is what makes Luna
 * cheaper than 4o-mini in practice despite the higher headline rate.
 */
const TIER_EFFORT: Record<ModelTier, ReasoningEffort> = {
  nano: 'none',
  small: 'low',
  balanced: 'medium',
  frontier: 'high',
};

/**
 * Above this many INPUT tokens, the 5.6 family bills the ENTIRE request at 2×
 * input and 1.5× output. Not a soft warning — one oversized applicant document
 * silently doubles the bill for that call. The gateway checks against this
 * before sending and trims or splits rather than paying the cliff.
 */
export const LONG_CONTEXT_THRESHOLD_TOKENS = 272_000;
export const LONG_CONTEXT_INPUT_MULTIPLIER = 2;
export const LONG_CONTEXT_OUTPUT_MULTIPLIER = 1.5;

/** Minimum stable prefix for a cache hit on 5.6+. Below this, caching does nothing. */
export const CACHE_MIN_PREFIX_TOKENS = 1_024;

/**
 * Models with no published cached-input rate. Asking for caching here spends
 * the write and never gets a discounted read.
 */
const NO_CACHE_DISCOUNT = new Set([
  'gpt-5.5-pro',
  'gpt-5.4-pro',
  'gpt-5.2-pro',
  'gpt-5-pro',
  'o1-pro',
  'o3-pro',
]);

export interface ModelPolicyOverrides {
  nano?: string;
  small?: string;
  balanced?: string;
  frontier?: string;
}

export function resolveModel(
  tier: ModelTier,
  overrides: ModelPolicyOverrides = {},
): ModelChoice {
  const model = overrides[tier] ?? DEFAULT_TIER_MODELS[tier];
  return {
    model,
    reasoningEffort: TIER_EFFORT[tier],
    // Only the 5.6 family accepts prompt_cache_options; sending it to an older
    // model is an API error, and older models bill no cache write anyway, so
    // implicit is both correct and free there.
    cacheMode: supportsExplicitCache(model) ? 'explicit' : 'implicit',
  };
}

/** `prompt_cache_options.mode` is documented as GPT-5.6 and later only. */
export function supportsExplicitCache(model: string): boolean {
  return /^gpt-5\.(6|[7-9]|\d{2})/.test(model);
}

export function hasCacheDiscount(model: string): boolean {
  return !NO_CACHE_DISCOUNT.has(model);
}

/**
 * Whether caching is worth enabling for a given prefix size and expected reuse.
 *
 * On 5.6 a write costs 1.25× input and a read costs 0.1× input, so a prefix
 * written once and read `n` more times costs `1.25 + 0.1n` versus `1 + n`
 * uncached. That crosses over at n > ~0.28 — i.e. caching pays from the second
 * request onward, but NOT for a genuinely one-shot prompt, which is the case
 * this guard exists to catch.
 */
export function cachingIsWorthIt(
  model: string,
  prefixTokens: number,
  expectedReuses: number,
): boolean {
  if (!hasCacheDiscount(model)) return false;
  if (prefixTokens < CACHE_MIN_PREFIX_TOKENS) return false;
  if (!supportsExplicitCache(model)) return true; // no write fee pre-5.6
  const cached = 1.25 + 0.1 * expectedReuses;
  const uncached = 1 + expectedReuses;
  return cached < uncached;
}

/** Tier ordering, for escalation and for reporting the distribution. */
export const TIER_ORDER: ModelTier[] = [
  'nano',
  'small',
  'balanced',
  'frontier',
];

export function isEscalation(from: ModelTier, to: ModelTier): boolean {
  return TIER_ORDER.indexOf(to) > TIER_ORDER.indexOf(from);
}

/** Every model ID this policy can currently emit. Used by the pricing-coverage test. */
export function knownModels(overrides: ModelPolicyOverrides = {}): string[] {
  return [...new Set(TIER_ORDER.map((t) => resolveModel(t, overrides).model))];
}

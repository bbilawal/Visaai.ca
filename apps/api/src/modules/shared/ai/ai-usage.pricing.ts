export type AiProviderName =
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'ocr'
  | 'search';

interface AiModelRate {
  in: number; // $ per 1M input tokens
  out: number; // $ per 1M output tokens
  /**
   * $ per 1M CACHED input tokens. Absent = this model publishes no cached
   * rate (every *-pro model), in which case cached tokens bill at `in` and
   * enabling prompt caching buys nothing.
   */
  cachedIn?: number;
  /**
   * $ per 1M tokens WRITTEN to the prompt cache. New with GPT-5.6: the docs
   * price a cache write at 1.25x the uncached input rate. Absent = the model
   * charges nothing to write (everything before 5.6, gpt-4o included).
   *
   * Omitting this was not a rounding error waiting to happen: on a workload
   * with a low cache hit rate, writes are up to 25% of input spend, and a
   * cost report that ignores them understates the bill precisely when
   * someone is deciding whether caching paid off.
   */
  cacheWrite?: number;
  perPage?: number; // $ per page (per-page OCR vendors)
}

/**
 * Per-model rates from 04 §1 (sourced 2026-06). Token *counts* are estimates, so
 * derived dollars are ESTIMATE. Today every real row is gpt-4o / gpt-4o-mini; the
 * rest are forward-looking (04 §0).
 *
 * SCHEMA FOLLOW-UP: the design (pricing-engine/10 §3.3) calls for these to live in
 * a DB lookup so a price change is config, not a deploy — promote when convenient.
 */
export const AI_MODEL_PRICES: Record<string, AiModelRate> = {
  // Current production family. Rates read from
  // https://developers.openai.com/api/docs/pricing on 2026-08-20.
  // cacheWrite = 1.25 x in, per the prompt-caching guide.
  'gpt-5.6-sol': { in: 5.0, cachedIn: 0.5, cacheWrite: 6.25, out: 30.0 },
  'gpt-5.6-terra': { in: 2.0, cachedIn: 0.2, cacheWrite: 2.5, out: 12.0 },
  'gpt-5.6-luna': { in: 0.2, cachedIn: 0.02, cacheWrite: 0.25, out: 1.2 },

  // Legacy, still in use until every callsite is migrated. NOT deprecated by
  // OpenAI as of 2026-08-20 (no announced shutdown), so these rows stay: a
  // metered call on an old model must still price correctly. Note the weaker
  // cache discount — 50% here vs 90% on the 5.6 family.
  'gpt-4o': { in: 2.5, cachedIn: 1.25, out: 10 },
  'gpt-4o-mini': { in: 0.15, cachedIn: 0.075, out: 0.6 },

  'azure-di': { in: 0, out: 0, perPage: 0.0015 },
  'aws-textract': { in: 0, out: 0, perPage: 0.0015 },
  'google-docai': { in: 0, out: 0, perPage: 0.0015 },
};

/**
 * Above this many input tokens the GPT-5.6 family bills the WHOLE request at
 * 2x input / 1.5x output. Priced here rather than guessed at, because a single
 * large document silently doubling a bill is exactly the kind of cost anomaly
 * the dashboards are supposed to explain.
 */
const LONG_CONTEXT_THRESHOLD = 272_000;
const LONG_CONTEXT_IN_MULT = 2;
const LONG_CONTEXT_OUT_MULT = 1.5;

function isLongContextModel(model: string): boolean {
  return model.startsWith('gpt-5.6');
}

const round6 = (n: number): number => Math.round(n * 1e6) / 1e6;

/** Token counts as the provider reports them. */
export interface UsageBreakdown {
  inputTokens: number;
  outputTokens: number;
  /**
   * Tokens served FROM the cache. A subset of inputTokens, not an addition to
   * it — the provider reports it that way (`usage.input_tokens_details.
   * cached_tokens` on Responses, `usage.prompt_tokens_details.cached_tokens`
   * on Chat Completions), and double-counting them would overstate every
   * cached call.
   */
  cachedInputTokens?: number;
  /** Tokens WRITTEN to the cache (`cache_write_tokens`, GPT-5.6+). Billed extra. */
  cacheWriteTokens?: number;
  /** Per-page units for page-priced OCR vendors. */
  units?: number;
}

/**
 * request_cost_usd =
 *     (uncached_input x in + cached_input x cachedIn
 *      + cache_write x cacheWrite + output x out) / 1e6
 *   + units x perPage
 *
 * Unknown model → 0 (never throws; metering must not break the AI call).
 */
export function priceUsageDetailed(model: string, u: UsageBreakdown): number {
  const r = AI_MODEL_PRICES[model];
  if (!r) return 0;

  const cached = Math.min(
    Math.max(u.cachedInputTokens ?? 0, 0),
    Math.max(u.inputTokens, 0),
  );
  const uncached = Math.max(u.inputTokens - cached, 0);
  const written = Math.max(u.cacheWriteTokens ?? 0, 0);

  // A model with no published cached rate bills cached tokens at the full
  // input rate. Falling back to `r.in` keeps that honest instead of silently
  // discounting them to zero.
  const cachedRate = r.cachedIn ?? r.in;
  const writeRate = r.cacheWrite ?? 0;

  let inMult = 1;
  let outMult = 1;
  if (isLongContextModel(model) && u.inputTokens > LONG_CONTEXT_THRESHOLD) {
    inMult = LONG_CONTEXT_IN_MULT;
    outMult = LONG_CONTEXT_OUT_MULT;
  }

  const tokenCost =
    (uncached * r.in * inMult +
      cached * cachedRate * inMult +
      written * writeRate * inMult +
      Math.max(u.outputTokens, 0) * r.out * outMult) /
    1_000_000;

  const pageCost = (r.perPage ?? 0) * (u.units ?? 0);
  return round6(tokenCost + pageCost);
}

/**
 * Positional form, kept because existing callers and their tests use it.
 * Delegates so there is one pricing implementation, not two that drift.
 */
export function priceUsage(
  model: string,
  inputTokens: number,
  outputTokens: number,
  units = 0,
): number {
  return priceUsageDetailed(model, { inputTokens, outputTokens, units });
}

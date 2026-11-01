import type { CallbackHandlerMethods } from '@langchain/core/callbacks/base';
import type { AiUsageMeter, AiUsageContext } from './ai-usage.meter';

/**
 * PRICE-8: meter LangGraph LLM calls that go through a `ChatOpenAI` instance.
 *
 * The document pipeline (narrative/prefill/vri/intake) called the model directly
 * and never metered, so `ai_usage_events` — and the `ai_cost_per_application`
 * matview the pricing engine reads — captured only a fraction of real spend.
 * Attaching this handler to a `ChatOpenAI` instance meters every `.invoke()`
 * through it, with zero per-node changes. Fire-and-forget (the meter swallows
 * its own errors); never affects the generation.
 */
export interface ExtractedTokens {
  input: number;
  output: number;
  /** Input tokens served from cache. A subset of `input`. */
  cachedInput: number;
  /** Tokens written to the cache. GPT-5.6+ only; billed. */
  cacheWrite: number;
}

/**
 * Pull token counts out of whichever shape the SDK handed back.
 *
 * The cache fields live in different places per API surface, and the provider
 * reports them as a BREAKDOWN of the input count, never as an addition:
 *   Responses API      usage.input_tokens_details.cached_tokens
 *   Chat Completions   usage.prompt_tokens_details.cached_tokens
 *   GPT-5.6+ adds      ...details.cache_write_tokens
 *
 * LangChain surfaces these inconsistently depending on the model and version,
 * so all four known shapes are probed. A shape that reports no cache detail
 * yields zeros, which prices identically to an uncached call — the correct
 * degradation, not a guess.
 */
export function extractTokens(output: unknown): ExtractedTokens {
  interface Details {
    cached_tokens?: number;
    cache_write_tokens?: number;
  }
  const o = output as {
    llmOutput?: {
      tokenUsage?: {
        promptTokens?: number;
        completionTokens?: number;
        promptTokensDetails?: Details;
        prompt_tokens_details?: Details;
      };
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        prompt_tokens_details?: Details;
        input_tokens_details?: Details;
      };
    };
    generations?: Array<
      Array<{
        message?: {
          usage_metadata?: {
            input_tokens?: number;
            output_tokens?: number;
            input_token_details?: {
              cache_read?: number;
              cache_creation?: number;
            };
          };
        };
      }>
    >;
  };

  const cacheOf = (
    ...ds: (Details | undefined)[]
  ): { r: number; w: number } => {
    for (const d of ds) {
      if (d && (d.cached_tokens != null || d.cache_write_tokens != null)) {
        return { r: d.cached_tokens ?? 0, w: d.cache_write_tokens ?? 0 };
      }
    }
    return { r: 0, w: 0 };
  };

  const tu = o?.llmOutput?.tokenUsage;
  if (tu && (tu.promptTokens != null || tu.completionTokens != null)) {
    const c = cacheOf(tu.promptTokensDetails, tu.prompt_tokens_details);
    return {
      input: tu.promptTokens ?? 0,
      output: tu.completionTokens ?? 0,
      cachedInput: c.r,
      cacheWrite: c.w,
    };
  }

  const usage = o?.llmOutput?.usage;
  if (
    usage &&
    (usage.prompt_tokens != null || usage.completion_tokens != null)
  ) {
    const c = cacheOf(usage.prompt_tokens_details, usage.input_tokens_details);
    return {
      input: usage.prompt_tokens ?? 0,
      output: usage.completion_tokens ?? 0,
      cachedInput: c.r,
      cacheWrite: c.w,
    };
  }

  const um = o?.generations?.[0]?.[0]?.message?.usage_metadata;
  if (um) {
    return {
      input: um.input_tokens ?? 0,
      output: um.output_tokens ?? 0,
      cachedInput: um.input_token_details?.cache_read ?? 0,
      cacheWrite: um.input_token_details?.cache_creation ?? 0,
    };
  }

  return { input: 0, output: 0, cachedInput: 0, cacheWrite: 0 };
}

export function makeMeteringCallback(
  meter: AiUsageMeter,
  ctx: AiUsageContext,
  model: string,
): CallbackHandlerMethods {
  return {
    handleLLMEnd(output: unknown): void {
      const {
        input,
        output: out,
        cachedInput,
        cacheWrite,
      } = extractTokens(output);
      if (input === 0 && out === 0) return;
      void meter.record({
        ...ctx,
        provider: 'openai',
        model,
        inputTokens: input,
        outputTokens: out,
        cachedInputTokens: cachedInput,
        cacheWriteTokens: cacheWrite,
      });
    },
  };
}

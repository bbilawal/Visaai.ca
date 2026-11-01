import { ChatOpenAI } from '@langchain/openai';
import type { AiUsageMeter, AiUsageContext } from './ai-usage.meter';
import { makeMeteringCallback } from './metering-callback';
import { resolveModel, type ModelPolicyOverrides } from './model-policy';
import { AI_TASKS, type AiTaskName, type ModelTier } from './task-registry';

/**
 * The single place a `ChatOpenAI` is constructed.
 *
 * Every LangGraph node previously built its own with a literal model name and
 * a literal token cap:
 *
 *   new ChatOpenAI({ model: 'gpt-4o', maxTokens: 1024, ... })
 *
 * Two bugs were latent in that shape, and both are structural rather than
 * accidental:
 *
 *   - The metering callback took the model name as a THIRD argument
 *     (`makeMeteringCallback(meter, ctx, 'gpt-4o')`), duplicating the literal.
 *     Change one and not the other and every call is metered against the wrong
 *     price — silently, since metering never throws.
 *   - `maxTokens: 1024` was copy-pasted regardless of whether the node emits a
 *     three-word label or a two-page letter. A bounded task with a generous cap
 *     is a bill nobody notices; a generative task with a tight one is a
 *     truncated document the user sees.
 *
 * Asking for a TASK instead of a model fixes both by construction: the model,
 * the cap, the timeout and the metering label all come from one registry entry.
 */

export interface TaskModelOptions {
  apiKey: string;
  meter?: AiUsageMeter;
  ctx?: Partial<AiUsageContext>;
  /** Per-environment tier pinning, from AI_MODEL_* config. */
  overrides?: ModelPolicyOverrides;
  /**
   * Force a tier, overriding the task's default. Used by the escalation path
   * and by the eval harness, which runs one task across every tier.
   */
  tier?: ModelTier;
}

/**
 * Build the chat model for a registered AI task.
 *
 * The reasoning effort is passed through `modelKwargs` because the LangChain
 * `ChatOpenAI` constructor has no first-class field for it, and it is sent
 * only for the GPT-5.x family — an operator who pins a tier back to `gpt-4o`
 * gets a working call, not a 400.
 *
 * THE PARAMETER NAME IS `reasoning_effort`, FLAT, AND NOT `reasoning.effort`.
 *
 * The nested `reasoning: { effort }` object belongs to the Responses API.
 * `/v1/chat/completions`, which is what ChatOpenAI calls, rejects it outright:
 *
 *   400 Unknown parameter: 'reasoning'.
 *
 * This shipped nested, so EVERY call through this factory failed — intake,
 * VRI, narrative, prefill and document field derivation all route through
 * here. Nothing caught it because no test exercises the live API and the eval
 * harness reported the 400s as model quality rather than as errors.
 *
 * Verified against the live API before changing: flat `reasoning_effort` with
 * effort 'none' returns 200; the nested form returns 400; omitting it entirely
 * returns 200.
 */
export function chatModelForTask(
  task: AiTaskName,
  opts: TaskModelOptions,
): ChatOpenAI {
  const spec = AI_TASKS[task];
  const tier = opts.tier ?? spec.defaultTier;
  const choice = resolveModel(tier, opts.overrides);

  const acceptsReasoningEffort = /^gpt-5\./.test(choice.model);

  return new ChatOpenAI({
    model: choice.model,
    apiKey: opts.apiKey,
    // Load-bearing for the cost report, not a style choice. A streamed call
    // (the intake question streams to the browser token by token) carries no
    // `usage` block unless OpenAI is asked for one, and `handleLLMEnd` would
    // then meter it as zero — the exact silent under-reporting this factory
    // exists to prevent. The library default is already true; stating it here
    // means a library default flip cannot quietly zero `ai_usage_events`.
    streamUsage: true,
    // From the task, not from a copy-pasted literal.
    maxTokens: spec.maxOutputTokens,
    timeout: spec.timeoutMs,
    maxRetries: spec.retries,
    ...(acceptsReasoningEffort
      ? { modelKwargs: { reasoning_effort: choice.reasoningEffort } }
      : {}),
    callbacks: opts.meter
      ? [
          makeMeteringCallback(
            opts.meter,
            // `operation` is the task name, so ai_usage_events groups by the
            // unit the cost report actually reasons about. Previously it was a
            // hand-written string per graph ('intake'), which could not
            // distinguish the expensive node from the cheap one in the same graph.
            { ...opts.ctx, operation: task },
            choice.model,
          ),
        ]
      : undefined,
  });
}

/** The model a task will actually use. For logging, evals and the cost report. */
export function modelForTask(
  task: AiTaskName,
  overrides?: ModelPolicyOverrides,
  tier?: ModelTier,
): string {
  return resolveModel(tier ?? AI_TASKS[task].defaultTier, overrides).model;
}

/**
 * Read tier pinning out of the environment.
 *
 * AI_MODEL_NANO / AI_MODEL_SMALL / AI_MODEL_BALANCED / AI_MODEL_FRONTIER.
 * Unset = the policy default. This is the rollback lever: if a new model
 * regresses, an operator pins the tier back and restarts, with no deploy and
 * no code change.
 */
export function overridesFromEnv(
  env: Record<string, string | undefined>,
): ModelPolicyOverrides {
  const pick = (k: string): string | undefined => {
    const v = env[k];
    return v && v.trim() ? v.trim() : undefined;
  };
  return {
    nano: pick('AI_MODEL_NANO'),
    small: pick('AI_MODEL_SMALL'),
    balanced: pick('AI_MODEL_BALANCED'),
    frontier: pick('AI_MODEL_FRONTIER'),
  };
}

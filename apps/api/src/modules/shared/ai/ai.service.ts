import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import type { Env } from '../../../config/configuration';
import { AiUsageMeter, type AiUsageContext } from './ai-usage.meter';
import type { AiProviderName } from './ai-usage.pricing';
import { AI_TELEMETRY, type AiTelemetrySink } from './ai-telemetry.port';
import { resolveModel, type ModelPolicyOverrides } from './model-policy';
import { overridesFromEnv } from './model-factory';
import type { ModelTier } from './task-registry';

/**
 * F4: multi-provider AI router with retry + fallback.
 *
 * The codebase was OpenAI-only with no resilience. This service adds:
 *   - a configurable provider chain (AI_PROVIDERS, e.g. "openai,anthropic")
 *   - per-attempt timeout + bounded retries
 *   - automatic fallback to the next provider when one fails or times out
 *   - optional usage metering (PRICE-7/10): when a call carries `meta`, the
 *     provider's token usage is priced and logged to ai_usage_events.
 *
 * Only the OpenAI provider is implemented (its SDK is already a dependency).
 * Anthropic / Gemini are declared slots that activate when their keys + SDKs
 * are added.
 */

export interface AiCompleteParams {
  system?: string;
  user: string;
  maxTokens?: number;
  json?: boolean;
  /** When present, the call's token usage is metered to ai_usage_events. */
  meta?: AiUsageContext;
  /** Capability tier. Omitted = 'balanced'. Never a model name. */
  tier?: ModelTier;
}

/** Provider result: the JSON content plus the token usage needed for metering. */
export interface AiCompletion {
  content: string;
  usage?: {
    model: string;
    inputTokens: number;
    outputTokens: number;
    /** Subset of inputTokens served from the prompt cache. */
    cachedInputTokens?: number;
  };
}

interface AiProvider {
  readonly name: string;
  readonly available: boolean;
  completeJSON(
    params: AiCompleteParams,
    signal: AbortSignal,
  ): Promise<AiCompletion>;
}

class OpenAiProvider implements AiProvider {
  readonly name = 'openai';
  readonly available: boolean;
  private client?: OpenAI;
  private readonly overrides: ModelPolicyOverrides;

  constructor(apiKey?: string, overrides: ModelPolicyOverrides = {}) {
    this.available = !!apiKey;
    this.overrides = overrides;
    if (apiKey) this.client = new OpenAI({ apiKey });
  }

  async completeJSON(
    params: AiCompleteParams,
    signal: AbortSignal,
  ): Promise<AiCompletion> {
    if (!this.client) throw new Error('openai provider not configured');
    // Callers of this generic entry point do not name a task, so it routes at
    // the balanced tier — the safe default for "some prompt, some JSON".
    // Task-aware callers should use chatModelForTask instead, which picks the
    // cheapest tier that clears that task's eval threshold.
    const model = resolveModel(params.tier ?? 'balanced', this.overrides).model;
    const res = await this.client.chat.completions.create(
      {
        model,
        max_tokens: params.maxTokens ?? 1024,
        ...(params.json ? { response_format: { type: 'json_object' } } : {}),
        messages: [
          ...(params.system
            ? [{ role: 'system' as const, content: params.system }]
            : []),
          { role: 'user' as const, content: params.user },
        ],
      },
      { signal },
    );
    return {
      content: res.choices[0]?.message?.content ?? '',
      usage: {
        model,
        inputTokens: res.usage?.prompt_tokens ?? 0,
        outputTokens: res.usage?.completion_tokens ?? 0,
        cachedInputTokens: res.usage?.prompt_tokens_details?.cached_tokens ?? 0,
      },
    };
  }
}

/** Placeholder providers: implemented when their SDK + key are added. */
class UnconfiguredProvider implements AiProvider {
  readonly available = false;
  constructor(readonly name: string) {}
  async completeJSON(): Promise<AiCompletion> {
    throw new Error(`${this.name} provider not implemented`);
  }
}

const TIMEOUT_MS = 30_000;
const RETRIES_PER_PROVIDER = 2;

@Injectable()
export class AiService {
  private readonly log = new Logger(AiService.name);
  private readonly chain: AiProvider[];

  constructor(
    config: ConfigService<Env>,
    private readonly meter: AiUsageMeter,
    @Optional()
    @Inject(AI_TELEMETRY)
    private readonly telemetry?: AiTelemetrySink,
  ) {
    const order = (config.get('AI_PROVIDERS', { infer: true }) ?? 'openai')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const registry: Record<string, AiProvider> = {
      openai: new OpenAiProvider(
        config.get('OPENAI_API_KEY', { infer: true }),
        overridesFromEnv(process.env),
      ),
      anthropic: new UnconfiguredProvider('anthropic'),
      gemini: new UnconfiguredProvider('gemini'),
    };

    this.chain = order
      .map((n) => registry[n])
      .filter((p): p is AiProvider => !!p && p.available);
    if (this.chain.length === 0 && registry.openai.available)
      this.chain = [registry.openai];
  }

  /** True when at least one AI provider is configured + available. */
  get available(): boolean {
    return this.chain.length > 0;
  }

  /**
   * Try each configured provider in order; within a provider, retry on transient
   * failure; fall through to the next provider on exhaustion. When `params.meta`
   * is set, the successful call's usage is metered (fire-and-forget).
   */
  async completeJSON(params: AiCompleteParams): Promise<string> {
    // Analytics: fired once per logical request, before the provider chain is
    // walked (not once per retry/fallback attempt). Non-PII only — no prompt
    // content, no completion text. NOTE: props.provider here = chain[0], the
    // INTENDED provider; on fallback the actual provider that succeeds may differ,
    // so ai.completed.provider can legitimately mismatch this — downstream joins
    // must treat that as a fallback, not an error.
    this.telemetry?.aiRequest({
      userId: params.meta?.userId ?? null,
      applicationId: params.meta?.applicationId ?? null,
      provider: this.chain[0]?.name ?? null,
      operation: params.meta?.operation ?? 'completeJSON',
    });

    let lastErr: unknown;
    for (const provider of this.chain) {
      for (let attempt = 1; attempt <= RETRIES_PER_PROVIDER; attempt++) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
        try {
          const result = await provider.completeJSON(params, controller.signal);
          if (params.meta && result.usage) {
            void this.meter.record({
              ...params.meta,
              provider: provider.name as AiProviderName,
              model: result.usage.model,
              inputTokens: result.usage.inputTokens,
              outputTokens: result.usage.outputTokens,
              cachedInputTokens: result.usage.cachedInputTokens ?? 0,
            });
          }
          this.telemetry?.aiCompleted({
            userId: params.meta?.userId ?? null,
            applicationId: params.meta?.applicationId ?? null,
            provider: provider.name,
            model: result.usage?.model ?? null,
            inputTokens: result.usage?.inputTokens ?? null,
            outputTokens: result.usage?.outputTokens ?? null,
          });
          return result.content;
        } catch (err) {
          lastErr = err;
          this.log.warn(
            `AI provider ${provider.name} attempt ${attempt} failed: ${err instanceof Error ? err.message : 'unknown'}`,
          );
        } finally {
          clearTimeout(timer);
        }
      }
    }
    throw new Error(
      `All AI providers failed: ${lastErr instanceof Error ? lastErr.message : 'unknown'}`,
    );
  }
}

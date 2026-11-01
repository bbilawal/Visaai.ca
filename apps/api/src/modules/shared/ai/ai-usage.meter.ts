import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { priceUsageDetailed, type AiProviderName } from './ai-usage.pricing';

export interface AiUsageContext {
  operation: string; // intake | prefill | narrative | ocr | research | messaging | ...
  applicationId?: string | null;
  userId?: string | null;
}

export interface AiUsageRecord extends AiUsageContext {
  provider: AiProviderName;
  model: string;
  inputTokens: number;
  outputTokens: number;
  /**
   * Input tokens served from the prompt cache. A SUBSET of inputTokens.
   * Absent when the provider does not report cache detail, which is not the
   * same as zero — but it prices identically, and a column that is summed in
   * dashboards is better off 0 than NULL.
   */
  cachedInputTokens?: number;
  /** Tokens written to the prompt cache. Billed on GPT-5.6+. */
  cacheWriteTokens?: number;
  units?: number;
}

/**
 * Writes one ai_usage_events row per metered AI call (PRICE-7/10). Service-role
 * insert (bypasses RLS, like every pricing system write). Fire-and-forget: metering
 * must NEVER block or fail the AI call, so every error is swallowed + logged.
 */
@Injectable()
export class AiUsageMeter {
  private readonly log = new Logger(AiUsageMeter.name);

  constructor(private readonly supabase: SupabaseService) {}

  async record(e: AiUsageRecord): Promise<void> {
    try {
      const units = e.units ?? 0;
      const cachedInputTokens = Math.min(
        Math.max(e.cachedInputTokens ?? 0, 0),
        Math.max(e.inputTokens, 0),
      );
      const cacheWriteTokens = Math.max(e.cacheWriteTokens ?? 0, 0);
      const request_cost_usd = priceUsageDetailed(e.model, {
        inputTokens: e.inputTokens,
        outputTokens: e.outputTokens,
        cachedInputTokens,
        cacheWriteTokens,
        units,
      });
      const { error } = await this.supabase.admin
        .from('ai_usage_events')
        .insert({
          application_id: e.applicationId ?? null,
          user_id: e.userId ?? null,
          provider: e.provider,
          model: e.model,
          operation: e.operation,
          input_tokens: e.inputTokens,
          output_tokens: e.outputTokens,
          cached_input_tokens: cachedInputTokens,
          cache_write_tokens: cacheWriteTokens,
          units,
          request_cost_usd,
        });
      if (error)
        this.log.warn(`ai_usage_events insert failed: ${error.message}`);
    } catch (err) {
      this.log.warn(
        `ai usage metering error: ${err instanceof Error ? err.message : 'unknown'}`,
      );
    }
  }
}
